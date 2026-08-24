create table if not exists credential_vault_secrets (
  credential_id uuid primary key,
  tenant_id uuid not null,
  ciphertext bytea not null,
  initialization_vector bytea not null,
  authentication_tag bytea not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint chk_credential_vault_ciphertext_not_empty
    check (octet_length(ciphertext) > 0),
  constraint chk_credential_vault_iv_length
    check (octet_length(initialization_vector) = 12),
  constraint chk_credential_vault_auth_tag_length
    check (octet_length(authentication_tag) = 16),
  constraint chk_credential_vault_key_version
    check (key_version > 0)
);

create index if not exists idx_credential_vault_active_tenant
on credential_vault_secrets (tenant_id, credential_id)
where revoked_at is null;
