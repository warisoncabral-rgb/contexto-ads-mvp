do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_execution_manifests_tenant_id'
      and conrelid = 'execution_manifests'::regclass
  ) then
    alter table execution_manifests
      add constraint uq_execution_manifests_tenant_id
      unique (tenant_id, execution_manifest_id);
  end if;
end $$;

create table if not exists execution_authorizations (
  execution_authorization_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  execution_manifest_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  action_type text not null check (action_type = 'authorize_controlled_paused_creation'),
  risk_level text not null check (risk_level = 'high'),
  scope jsonb not null check (jsonb_typeof(scope) = 'array'),
  requested_by text not null,
  approved_by text,
  approved_at timestamptz,
  decision_reason text,
  status text not null check (
    status in ('pending','approved','rejected','revoked','expired','invalidated')
  ),
  expires_at timestamptz not null,
  correlation_id uuid not null,
  boundaries jsonb not null check (jsonb_typeof(boundaries) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fk_execution_authorization_manifest
    foreign key (tenant_id, execution_manifest_id)
    references execution_manifests (tenant_id, execution_manifest_id),
  constraint fk_execution_authorization_plan
    foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint uq_execution_authorizations_tenant_id
    unique (tenant_id, execution_authorization_id)
);

create unique index if not exists uq_execution_authorization_active
on execution_authorizations (tenant_id, execution_manifest_id, manifest_hash)
where status in ('pending','approved');

create index if not exists idx_execution_authorization_lookup
on execution_authorizations (tenant_id, execution_authorization_id, status);

create table if not exists execution_preflights (
  execution_preflight_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  execution_manifest_id uuid not null,
  execution_authorization_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  preflight_hash text not null check (preflight_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'blocked_before_attempt'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null,
  constraint fk_execution_preflight_authorization
    foreign key (tenant_id, execution_authorization_id)
    references execution_authorizations (tenant_id, execution_authorization_id),
  constraint fk_execution_preflight_manifest
    foreign key (tenant_id, execution_manifest_id)
    references execution_manifests (tenant_id, execution_manifest_id),
  constraint uq_execution_preflight_semantic
    unique (tenant_id, execution_manifest_id, execution_authorization_id, preflight_hash)
);
