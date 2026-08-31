create table if not exists analyst_tracking_registrations (
  registration_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  external_campaign_id text not null check (external_campaign_id ~ '^\d+$'),
  execution_plan_id uuid not null,
  execution_manifest_id uuid not null,
  meta_write_validation_protocol_id uuid not null,
  source text not null check (source in ('execution_operation','reconciled_operation')),
  registered_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, campaign_id),
  unique (tenant_id, external_campaign_id),
  foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  foreign key (tenant_id, execution_manifest_id)
    references execution_manifests (tenant_id, execution_manifest_id),
  foreign key (tenant_id, meta_write_validation_protocol_id)
    references meta_write_validation_protocols (tenant_id, meta_write_validation_protocol_id)
);

create index if not exists analyst_tracking_registrations_tenant_idx
  on analyst_tracking_registrations (tenant_id, registered_at desc);

-- Backfill historical campaigns that already completed controlled Meta validation.
-- The protocol id is a stable UUID and is reused as the registration id for the
-- one-time backfill; future registrations use application-generated UUIDs.
insert into analyst_tracking_registrations (
  registration_id, tenant_id, campaign_id, external_campaign_id,
  execution_plan_id, execution_manifest_id, meta_write_validation_protocol_id,
  source, registered_at, updated_at
)
select distinct on (p.tenant_id, p.campaign_id)
  p.meta_write_validation_protocol_id,
  p.tenant_id,
  p.campaign_id,
  operation.external_object_id,
  p.execution_plan_id,
  p.execution_manifest_id,
  p.meta_write_validation_protocol_id,
  operation.source,
  coalesce((p.payload->'execution'->>'completedAt')::timestamptz, p.prepared_at),
  coalesce((p.payload->'execution'->>'completedAt')::timestamptz, p.prepared_at)
from meta_write_validation_protocols p
cross join lateral (
  select
    item->>'externalObjectId' as external_object_id,
    'execution_operation'::text as source,
    1 as priority
  from jsonb_array_elements(coalesce(p.payload->'execution'->'operations', '[]'::jsonb)) item
  where item->>'objectType' = 'campaign'
    and item->>'status' = 'succeeded'
    and coalesce(item->>'externalObjectId','') ~ '^\d+$'
  union all
  select
    item->>'externalObjectId' as external_object_id,
    'reconciled_operation'::text as source,
    2 as priority
  from jsonb_array_elements(coalesce(p.payload->'reconciledOperations', '[]'::jsonb)) item
  where item->>'objectType' = 'campaign'
    and coalesce(item->>'externalObjectId','') ~ '^\d+$'
  order by priority
  limit 1
) operation
where p.status = 'external_validation_succeeded'
order by p.tenant_id, p.campaign_id, p.prepared_at desc
on conflict (tenant_id, campaign_id) do update set
  external_campaign_id = excluded.external_campaign_id,
  execution_plan_id = excluded.execution_plan_id,
  execution_manifest_id = excluded.execution_manifest_id,
  meta_write_validation_protocol_id = excluded.meta_write_validation_protocol_id,
  source = excluded.source,
  updated_at = excluded.updated_at;
