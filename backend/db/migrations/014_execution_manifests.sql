do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_operational_readiness_tenant_campaign_plan_id'
      and conrelid = 'operational_readiness_decisions'::regclass
  ) then
    alter table operational_readiness_decisions
      add constraint uq_operational_readiness_tenant_campaign_plan_id
      unique (tenant_id, campaign_id, execution_plan_id, readiness_decision_id);
  end if;
end $$;

create table if not exists execution_manifests (
  execution_manifest_id uuid primary key,
  tenant_id uuid not null,
  campaign_id uuid not null,
  execution_plan_id uuid not null,
  readiness_decision_id uuid not null,
  simulation_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'prepared_gate_closed'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null,
  constraint fk_execution_manifest_plan
    foreign key (tenant_id, campaign_id, execution_plan_id)
    references execution_plans (tenant_id, campaign_id, execution_plan_id),
  constraint fk_execution_manifest_readiness
    foreign key (
      tenant_id, campaign_id, execution_plan_id, readiness_decision_id
    ) references operational_readiness_decisions (
      tenant_id, campaign_id, execution_plan_id, readiness_decision_id
    ),
  constraint fk_execution_manifest_simulation
    foreign key (tenant_id, campaign_id, execution_plan_id, simulation_id)
    references execution_simulation_reports (
      tenant_id, campaign_id, execution_plan_id, simulation_id
    ),
  constraint uq_execution_manifest_semantic
    unique (tenant_id, campaign_id, execution_plan_id, manifest_hash)
);

create index if not exists idx_execution_manifest_latest
on execution_manifests (
  tenant_id, execution_plan_id, generated_at desc, execution_manifest_id desc
);
