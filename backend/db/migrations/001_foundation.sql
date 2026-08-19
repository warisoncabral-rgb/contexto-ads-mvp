create extension if not exists pgcrypto;

create table if not exists meta_connections (
  connection_id uuid primary key,
  tenant_id uuid not null,
  provider text not null default 'meta',
  status text not null,
  credential_ref text,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_connections_tenant on meta_connections(tenant_id);

create table if not exists meta_asset_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null references meta_connections(connection_id),
  asset_type text not null,
  external_id text not null,
  display_name text,
  selected boolean not null default false,
  observed_at timestamptz not null,
  unique (tenant_id, connection_id, asset_type, external_id)
);

create table if not exists capability_registry (
  capability_id uuid primary key,
  tenant_id uuid not null,
  connection_id uuid not null references meta_connections(connection_id),
  capability_type text not null,
  asset_scope text,
  required_permissions jsonb not null default '[]'::jsonb,
  granted_permissions jsonb not null default '[]'::jsonb,
  status text not null,
  api_version text,
  restrictions jsonb not null default '[]'::jsonb,
  validation_source text not null,
  validated_at timestamptz not null,
  unique (tenant_id, connection_id, capability_type, coalesce(asset_scope, ''))
);

create table if not exists audit_events (
  audit_event_id uuid primary key,
  tenant_id uuid not null,
  correlation_id uuid not null,
  actor_type text not null,
  actor_id text,
  event_type text not null,
  object_type text,
  object_id text,
  previous_state jsonb,
  new_state jsonb,
  result text not null,
  normalized_error text,
  created_at timestamptz not null
);
create index if not exists idx_audit_tenant_corr on audit_events(tenant_id, correlation_id, created_at);

create table if not exists readiness_snapshots (
  snapshot_id uuid primary key,
  tenant_id uuid not null,
  connection_id uuid not null,
  correlation_id uuid not null,
  checks jsonb not null,
  blockers jsonb not null,
  generated_at timestamptz not null
);
