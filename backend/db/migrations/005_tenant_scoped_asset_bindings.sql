alter table meta_asset_bindings
drop constraint if exists meta_asset_bindings_connection_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_meta_asset_bindings_tenant_connection'
      and conrelid = 'meta_asset_bindings'::regclass
  ) then
    alter table meta_asset_bindings
    add constraint fk_meta_asset_bindings_tenant_connection
      foreign key (tenant_id, connection_id)
      references meta_connections (tenant_id, connection_id);
  end if;
end $$;
