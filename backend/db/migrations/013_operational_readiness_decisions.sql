do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_execution_simulation_tenant_campaign_plan_id'
      and conrelid = 'execution_simulation_reports'::regclass
  ) then
    alter table execution_simulation_reports
      add constraint uq_execution_simulation_tenant_campaign_plan_id
      unique (tenant_id, campaign_id, execution_plan_id, simulation_id);
  end if;
end $$;

create table if not exists operational_readiness_decisions (
  readiness_decision_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  simulation_id uuid not null,
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in ('blocked', 'action_required', 'ready_for_executor_validation')
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null,
  constraint fk_operational_readiness_plan
    foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint fk_operational_readiness_simulation
    foreign key (tenant_id, campaign_id, execution_plan_id, simulation_id)
    references execution_simulation_reports (
      tenant_id, campaign_id, execution_plan_id, simulation_id
    ),
  constraint uq_operational_readiness_semantic_decision
    unique (tenant_id, campaign_id, execution_plan_id, decision_hash)
);

create index if not exists idx_operational_readiness_latest
on operational_readiness_decisions (
  tenant_id, execution_plan_id, generated_at desc, readiness_decision_id desc
);
