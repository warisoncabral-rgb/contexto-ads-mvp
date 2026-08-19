create table if not exists meta_oauth_attempts (
  attempt_id uuid primary key,
  tenant_id uuid not null,
  connection_id uuid not null references meta_connections(connection_id),
  state_hash text not null unique,
  requested_scopes text[] not null default '{}',
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists idx_meta_oauth_attempts_connection
on meta_oauth_attempts (tenant_id, connection_id, created_at desc);

create unique index if not exists uq_meta_oauth_attempts_active
on meta_oauth_attempts (tenant_id, connection_id)
where consumed_at is null and invalidated_at is null;
