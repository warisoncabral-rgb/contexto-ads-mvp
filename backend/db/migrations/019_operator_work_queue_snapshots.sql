create table if not exists operator_work_queue_snapshots (
  snapshot_id uuid primary key,
  tenant_id uuid not null references tenant_profiles(tenant_id),
  queue_date date not null,
  snapshot_hash char(64) not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  source_decisions jsonb not null check (jsonb_typeof(source_decisions) = 'array'),
  generated_at timestamptz not null,
  constraint uq_operator_work_queue_snapshot_day unique (tenant_id, queue_date)
);

create index if not exists idx_operator_work_queue_snapshots_tenant_date
on operator_work_queue_snapshots (tenant_id, queue_date desc);
