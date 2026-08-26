alter table meta_write_validation_protocols
  drop constraint if exists meta_write_validation_protocols_status_check;

alter table meta_write_validation_protocols
  add constraint meta_write_validation_protocols_status_check check (
    status in (
      'prepared_external_validation_required',
      'external_validation_running',
      'external_validation_failed',
      'external_validation_succeeded'
    )
  );

create unique index if not exists uq_meta_write_validation_running
on meta_write_validation_protocols (tenant_id, execution_manifest_id)
where status = 'external_validation_running';
