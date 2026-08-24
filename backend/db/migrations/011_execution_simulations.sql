do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_execution_plans_tenant_campaign_id'
      and conrelid = 'execution_plans'::regclass
  ) then
    alter table execution_plans
      add constraint uq_execution_plans_tenant_campaign_id
      unique (tenant_id, campaign_id, execution_plan_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_plan_approvals_tenant_id'
      and conrelid = 'plan_approvals'::regclass
  ) then
    alter table plan_approvals
      add constraint uq_plan_approvals_tenant_id
      unique (tenant_id, approval_id);
  end if;
end $$;

create table if not exists execution_simulation_reports (
  simulation_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  approval_id uuid,
  status text not null check (status in ('blocked', 'ready_for_execution')),
  checks jsonb not null check (jsonb_typeof(checks) = 'array'),
  operations jsonb not null check (jsonb_typeof(operations) = 'array'),
  blockers jsonb not null check (jsonb_typeof(blockers) = 'array'),
  external_effects jsonb not null check (jsonb_typeof(external_effects) = 'object'),
  generated_at timestamptz not null,
  constraint fk_execution_simulation_plan
    foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint fk_execution_simulation_approval
    foreign key (tenant_id, approval_id)
    references plan_approvals (tenant_id, approval_id)
);

create index if not exists idx_execution_simulation_latest
on execution_simulation_reports (
  tenant_id, execution_plan_id, generated_at desc, simulation_id desc
);
