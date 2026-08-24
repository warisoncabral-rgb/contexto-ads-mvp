do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_readiness_snapshots_tenant_connection'
      and conrelid = 'readiness_snapshots'::regclass
  ) then
    alter table readiness_snapshots
    add constraint fk_readiness_snapshots_tenant_connection
      foreign key (tenant_id, connection_id)
      references meta_connections (tenant_id, connection_id);
  end if;
end $$;

create index if not exists idx_readiness_snapshots_latest
on readiness_snapshots (tenant_id, connection_id, generated_at desc, snapshot_id desc);

create table if not exists meta_smoke_test_reports (
  smoke_test_id uuid primary key,
  tenant_id uuid not null,
  connection_id uuid not null,
  passed boolean not null,
  steps jsonb not null,
  blockers jsonb not null,
  generated_at timestamptz not null,
  constraint fk_meta_smoke_reports_tenant_connection
    foreign key (tenant_id, connection_id)
    references meta_connections (tenant_id, connection_id)
);

create index if not exists idx_meta_smoke_test_reports_latest
on meta_smoke_test_reports (
  tenant_id,
  connection_id,
  generated_at desc,
  smoke_test_id desc
);
