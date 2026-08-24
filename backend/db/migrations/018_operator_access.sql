create table if not exists tenant_profiles (
  tenant_id uuid primary key,
  display_name text not null check (char_length(display_name) between 2 and 200),
  status text not null check (status in ('active','suspended')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists operator_tenant_memberships (
  membership_id uuid primary key,
  operator_subject text not null
    check (char_length(operator_subject) between 3 and 200),
  tenant_id uuid not null references tenant_profiles(tenant_id),
  role text not null check (role in ('owner','operator','viewer')),
  status text not null check (status in ('active','revoked')),
  created_at timestamptz not null,
  revoked_at timestamptz,
  constraint ck_operator_membership_revocation check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  constraint uq_operator_tenant_membership unique (operator_subject, tenant_id)
);

create index if not exists idx_operator_memberships_subject_active
on operator_tenant_memberships (operator_subject, tenant_id)
where status = 'active';
