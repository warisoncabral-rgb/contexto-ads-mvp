create table if not exists campaigns (
  campaign_id uuid primary key,
  tenant_id uuid not null,
  created_at timestamptz not null,
  unique (tenant_id, campaign_id)
);

create index if not exists idx_campaigns_tenant_created
on campaigns (tenant_id, created_at desc, campaign_id);

create table if not exists campaign_context_versions (
  package_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  version integer not null check (version > 0),
  schema_version text not null check (schema_version = '1.0'),
  status text not null check (status in ('needs_information', 'ready_for_generation')),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  inferences jsonb not null default '[]'::jsonb
    check (jsonb_typeof(inferences) = 'array'),
  validation_issues jsonb not null
    check (jsonb_typeof(validation_issues) = 'array'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  constraint fk_campaign_context_tenant_campaign
    foreign key (tenant_id, campaign_id)
    references campaigns (tenant_id, campaign_id),
  unique (tenant_id, campaign_id, version)
);

create index if not exists idx_campaign_context_latest
on campaign_context_versions (tenant_id, campaign_id, version desc);
