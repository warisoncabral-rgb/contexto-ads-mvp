alter table capability_registry
drop constraint if exists capability_registry_connection_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_capability_registry_tenant_connection'
      and conrelid = 'capability_registry'::regclass
  ) then
    alter table capability_registry
    add constraint fk_capability_registry_tenant_connection
      foreign key (tenant_id, connection_id)
      references meta_connections (tenant_id, connection_id);
  end if;
end $$;
