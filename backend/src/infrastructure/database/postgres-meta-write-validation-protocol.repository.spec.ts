import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import { PostgresMetaWriteValidationProtocolRepository } from './postgres-meta-write-validation-protocol.repository';

describe('PostgresMetaWriteValidationProtocolRepository', () => {
  const protocol = {
    metaWriteValidationProtocolId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    executionManifestId: '55555555-5555-4555-8555-555555555555',
    planHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    protocolHash: 'c'.repeat(64),
    status: 'prepared_external_validation_required',
    preparedAt: '2026-08-24T16:00:00.000Z',
  } as MetaWriteValidationProtocolV1;
  const event = {
    auditEventId: '66666666-6666-4666-8666-666666666666',
    tenantId: protocol.tenantId,
    correlationId: '77777777-7777-4777-8777-777777777777',
    actorType: 'user',
    eventType: 'meta_write_validation_protocol_prepared',
    result: 'success',
    createdAt: protocol.preparedAt,
  } as AuditEvent;
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const repository = new PostgresMetaWriteValidationProtocolRepository({
    connect,
    query,
  } as unknown as Pool);

  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    connect.mockClear();
  });

  it('persists protocol and audit atomically', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ payload: protocol }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await expect(repository.saveIdempotent(protocol, event)).resolves.toEqual(protocol);
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(' ')[0]))
      .toEqual(['begin', 'insert', 'insert', 'commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reuses the semantic protocol without duplicating audit', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ payload: protocol }] })
      .mockResolvedValueOnce({});
    await expect(repository.saveIdempotent(protocol, event)).resolves.toEqual(protocol);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into audit_events')))
      .toBe(false);
  });

  it('loads latest protocol only inside tenant and manifest', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: protocol }] });
    await expect(repository.latestForManifest(
      protocol.tenantId,
      protocol.executionManifestId,
    )).resolves.toEqual(protocol);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_manifest_id = $2'),
      [protocol.tenantId, protocol.executionManifestId],
    );
  });
});
