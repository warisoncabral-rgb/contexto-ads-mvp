do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_execution_plans_tenant_id'
      and conrelid = 'execution_plans'::regclass
  ) then
    alter table execution_plans
      add constraint uq_execution_plans_tenant_id
      unique (tenant_id, execution_plan_id);
  end if;
end $$;

create table if not exists plan_approvals (
  approval_id uuid primary key,
  tenant_id uuid not null,
  execution_plan_id uuid not null,
  campaign_id uuid not null,
  plan_version text not null,
  approved_plan_hash text not null check (approved_plan_hash ~ '^[0-9a-f]{64}$'),
  action_type text not null check (action_type = 'approve_campaign_plan'),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  scope jsonb not null check (jsonb_typeof(scope) = 'array'),
  requested_by text not null,
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz not null,
  decision_reason text,
  status text not null check (
    status in ('pending', 'approved', 'rejected', 'expired', 'revoked', 'invalidated')
  ),
  correlation_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fk_plan_approval_execution_plan
    foreign key (tenant_id, execution_plan_id)
    references execution_plans (tenant_id, execution_plan_id)
);

create unique index if not exists uq_plan_approval_active
on plan_approvals (tenant_id, execution_plan_id, approved_plan_hash)
where status in ('pending', 'approved');

create index if not exists idx_plan_approvals_lookup
on plan_approvals (tenant_id, approval_id, status);

create index if not exists idx_plan_approvals_campaign
on plan_approvals (tenant_id, campaign_id, created_at desc);
