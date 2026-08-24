create table if not exists execution_plans (
  execution_plan_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  campaign_package_version integer not null check (campaign_package_version > 0),
  plan_version text not null check (plan_version = '1.0'),
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in ('draft', 'pending', 'blocked', 'ready_for_approval', 'approved', 'executing')
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null,
  constraint fk_execution_plan_context_version
    foreign key (tenant_id, campaign_id, campaign_package_version)
    references campaign_context_versions (tenant_id, campaign_id, version),
  unique (idempotency_key),
  unique (tenant_id, campaign_id, plan_hash)
);

create index if not exists idx_execution_plans_latest
on execution_plans (tenant_id, campaign_id, created_at desc, execution_plan_id desc);
