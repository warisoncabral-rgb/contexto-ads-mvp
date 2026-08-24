create table if not exists creative_package_versions (
  creative_package_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  source_execution_plan_id uuid not null,
  source_plan_hash text not null check (source_plan_hash ~ '^[0-9a-f]{64}$'),
  version integer not null check (version > 0),
  schema_version text not null check (schema_version = '1.0'),
  status text not null check (status in ('needs_review', 'approved', 'superseded')),
  copies jsonb not null check (jsonb_typeof(copies) = 'array'),
  claims jsonb not null check (jsonb_typeof(claims) = 'array'),
  assets jsonb not null check (jsonb_typeof(assets) = 'array'),
  review_checklist jsonb not null check (jsonb_typeof(review_checklist) = 'object'),
  validation_issues jsonb not null check (jsonb_typeof(validation_issues) = 'array'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null,
  constraint uq_creative_package_version unique (tenant_id, campaign_id, version),
  constraint uq_creative_package_semantic_input unique (
    tenant_id, campaign_id, source_plan_hash, content_hash
  ),
  constraint fk_creative_package_campaign
    foreign key (tenant_id, campaign_id)
    references campaigns (tenant_id, campaign_id),
  constraint fk_creative_package_source_plan
    foreign key (tenant_id, campaign_id, source_execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint ck_creative_package_approval_fields check (
    (status in ('approved', 'superseded') and approved_by is not null and approved_at is not null)
    or (status = 'needs_review' and approved_by is null and approved_at is null)
  )
);

create unique index if not exists uq_creative_package_approved_campaign
on creative_package_versions (tenant_id, campaign_id)
where status = 'approved';

create index if not exists idx_creative_package_latest
on creative_package_versions (tenant_id, campaign_id, version desc);
