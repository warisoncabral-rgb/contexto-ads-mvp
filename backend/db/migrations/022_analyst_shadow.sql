create table if not exists analyst_snapshots (
  snapshot_id uuid primary key,
  snapshot_hash char(64) not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null,
  campaign_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  source text not null,
  payload jsonb not null,
  collected_at timestamptz not null,
  unique (tenant_id, campaign_id, snapshot_hash)
);

create index if not exists analyst_snapshots_campaign_latest_idx
  on analyst_snapshots (tenant_id, campaign_id, collected_at desc);

create table if not exists analyst_analyses (
  analysis_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  snapshot_id uuid not null references analyst_snapshots(snapshot_id) on delete cascade,
  recommended_action text not null,
  health_status text not null,
  confidence text not null,
  payload jsonb not null,
  generated_at timestamptz not null,
  unique (tenant_id, campaign_id, snapshot_id)
);

create index if not exists analyst_analyses_campaign_latest_idx
  on analyst_analyses (tenant_id, campaign_id, generated_at desc);
