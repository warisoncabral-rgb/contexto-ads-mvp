create table if not exists kill_switch_states (
  kill_switch_state_id uuid primary key,
  tenant_id uuid not null,
  scope text not null check (scope in ('tenant','campaign')),
  campaign_id uuid,
  version integer not null check (version > 0),
  status text not null check (status in ('engaged','released')),
  reason text not null check (char_length(reason) between 3 and 1000),
  changed_by text not null check (char_length(changed_by) between 2 and 200),
  correlation_id uuid not null,
  changed_at timestamptz not null,
  constraint ck_kill_switch_scope_target check (
    (scope = 'tenant' and campaign_id is null)
    or (scope = 'campaign' and campaign_id is not null)
  ),
  constraint fk_kill_switch_campaign
    foreign key (tenant_id, campaign_id)
    references campaigns (tenant_id, campaign_id)
);

create unique index if not exists uq_kill_switch_scope_version
on kill_switch_states (
  tenant_id, scope,
  coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version
);

create index if not exists idx_kill_switch_latest
on kill_switch_states (
  tenant_id, scope,
  coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version desc
);
