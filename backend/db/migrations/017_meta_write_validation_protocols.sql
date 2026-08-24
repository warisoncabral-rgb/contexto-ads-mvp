create table if not exists meta_write_validation_protocols (
  meta_write_validation_protocol_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  execution_manifest_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  protocol_hash text not null check (protocol_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'prepared_external_validation_required'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  prepared_at timestamptz not null,
  constraint fk_meta_write_validation_manifest
    foreign key (tenant_id, execution_manifest_id)
    references execution_manifests (tenant_id, execution_manifest_id),
  constraint fk_meta_write_validation_plan
    foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint uq_meta_write_validation_protocol_tenant_id
    unique (tenant_id, meta_write_validation_protocol_id),
  constraint uq_meta_write_validation_protocol_semantic
    unique (tenant_id, execution_manifest_id, manifest_hash, protocol_hash)
);

create index if not exists idx_meta_write_validation_protocol_latest
on meta_write_validation_protocols (
  tenant_id, execution_manifest_id, prepared_at desc,
  meta_write_validation_protocol_id desc
);
