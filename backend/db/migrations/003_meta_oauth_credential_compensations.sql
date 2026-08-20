create table if not exists meta_oauth_credential_compensations (
  compensation_id bigint generated always as identity primary key,
  tenant_id uuid not null,
  connection_id uuid not null,
  credential_ref text not null unique,
  reason text not null default 'connection_finalization_failed',
  created_at timestamptz not null,
  constraint fk_meta_oauth_compensations_tenant_connection
    foreign key (tenant_id, connection_id)
    references meta_connections (tenant_id, connection_id),
  constraint chk_meta_oauth_compensations_reason
    check (reason = 'connection_finalization_failed')
);

create index if not exists idx_meta_oauth_compensations_connection
on meta_oauth_credential_compensations (tenant_id, connection_id, created_at desc);
