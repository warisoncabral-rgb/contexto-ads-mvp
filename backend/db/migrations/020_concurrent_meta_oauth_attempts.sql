drop index if exists uq_meta_oauth_attempts_active;

create index if not exists idx_meta_oauth_attempts_active_connection
on meta_oauth_attempts (tenant_id, connection_id, expires_at desc)
where consumed_at is null and invalidated_at is null;
