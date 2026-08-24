import { Pool, PoolClient } from 'pg';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { PostgresCapabilityRepository } from './postgres-capability.repository';

describe('PostgresCapabilityRepository', () => {
  const query = jest.fn();
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn().mockResolvedValue({ query: clientQuery, release } as unknown as PoolClient);
  const pool = { query, connect } as unknown as Pool;
  const repository = new PostgresCapabilityRepository(pool);
  const capability: CapabilityRecord = {
    capabilityId: '33333333-3333-4333-8333-333333333333',
    tenantId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    capabilityType: 'READ_AD_ACCOUNT',
    assetScope: 'act_123',
    requiredPermissions: ['ads_read'],
    grantedPermissions: ['ads_read'],
    status: 'available',
    apiVersion: 'v26.0',
    restrictions: [],
    validationSource: 'meta_api',
    validatedAt: '2026-08-24T02:00:00.000Z',
  };

  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    connect.mockClear();
    release.mockReset();
  });

  it('replaces a capability snapshot transactionally', async () => {
    await repository.replaceForConnection(
      capability.tenantId,
      capability.connectionId,
      [capability],
    );

    expect(clientQuery.mock.calls[0]).toEqual(['begin']);
    expect(clientQuery.mock.calls[1]).toEqual([
      expect.stringContaining('for update'),
      [capability.tenantId, capability.connectionId],
    ]);
    expect(clientQuery.mock.calls[2][0]).toContain('delete from capability_registry');
    expect(clientQuery.mock.calls[3]).toEqual([
      expect.stringContaining('insert into capability_registry'),
      [
        capability.capabilityId,
        capability.tenantId,
        capability.connectionId,
        capability.capabilityType,
        capability.assetScope,
        JSON.stringify(capability.requiredPermissions),
        JSON.stringify(capability.grantedPermissions),
        capability.status,
        capability.apiVersion,
        JSON.stringify(capability.restrictions),
        capability.validationSource,
        capability.validatedAt,
      ],
    ]);
    expect(clientQuery.mock.calls[4]).toEqual(['commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-scope capability before starting a transaction', async () => {
    await expect(repository.replaceForConnection(
      capability.tenantId,
      capability.connectionId,
      [{ ...capability, tenantId: '44444444-4444-4444-8444-444444444444' }],
    )).rejects.toThrow('Capability scope mismatch');
    expect(connect).not.toHaveBeenCalled();
  });

  it('rolls back partial replacement failures', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(repository.replaceForConnection(
      capability.tenantId,
      capability.connectionId,
      [capability],
    )).rejects.toThrow('insert failed');
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('lists only tenant-scoped capability evidence', async () => {
    query.mockResolvedValueOnce({ rows: [{
      capability_id: capability.capabilityId,
      tenant_id: capability.tenantId,
      connection_id: capability.connectionId,
      capability_type: capability.capabilityType,
      asset_scope: capability.assetScope,
      required_permissions: capability.requiredPermissions,
      granted_permissions: capability.grantedPermissions,
      status: capability.status,
      api_version: capability.apiVersion,
      restrictions: capability.restrictions,
      validation_source: capability.validationSource,
      validated_at: new Date(capability.validatedAt),
    }] });

    await expect(repository.listForConnection(
      capability.tenantId,
      capability.connectionId,
    )).resolves.toEqual([capability]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and connection_id = $2'),
      [capability.tenantId, capability.connectionId],
    );
  });
});
