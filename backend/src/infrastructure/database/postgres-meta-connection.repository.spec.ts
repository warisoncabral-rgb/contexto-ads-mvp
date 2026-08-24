import { Pool, PoolClient } from 'pg';
import { MetaAssetBinding, MetaConnection } from '../../domain/contracts/meta-connection';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';

describe('PostgresMetaConnectionRepository', () => {
  const query = jest.fn();
  const clientQuery = jest.fn();
  const release = jest.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const pool = { query, connect } as unknown as Pool;
  const repository = new PostgresMetaConnectionRepository(pool);

  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    connect.mockClear();
    release.mockReset();
  });

  it('saves a connection without storing a token', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const connection: MetaConnection = {
      connectionId: 'connection-1',
      tenantId: 'tenant-1',
      provider: 'meta',
      status: 'authorization_pending',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    };

    await repository.save(connection);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('insert into meta_connections'), [
      'connection-1', 'tenant-1', 'meta', 'authorization_pending', null, null,
      connection.createdAt, connection.updatedAt,
    ]);
  });

  it('finds a connection only by tenantId and connectionId', async () => {
    query.mockResolvedValueOnce({ rows: [{
      connection_id: 'connection-1',
      tenant_id: 'tenant-1',
      provider: 'meta',
      status: 'authorization_pending',
      credential_ref: null,
      last_validated_at: null,
      created_at: new Date('2026-08-19T00:00:00.000Z'),
      updated_at: new Date('2026-08-19T00:00:00.000Z'),
    }] });

    const result = await repository.findById('tenant-1', 'connection-1');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('where tenant_id = $1 and connection_id = $2'), [
      'tenant-1', 'connection-1',
    ]);
    expect(result).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      connectionId: 'connection-1',
      status: 'authorization_pending',
    }));
  });

  it('returns null when the tenant-scoped connection is absent', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repository.findById('tenant-2', 'connection-1')).resolves.toBeNull();
  });

  it('marks only an authorization_pending tenant-scoped connection as connected', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(repository.markConnected(
      'tenant-1',
      'connection-1',
      'vault://credential-1',
      '2026-08-19T03:00:00.000Z',
    )).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/credential_ref = \$3[\s\S]*status = 'connected'[\s\S]*tenant_id = \$1 and connection_id = \$2[\s\S]*status = 'authorization_pending'/),
      ['tenant-1', 'connection-1', 'vault://credential-1', '2026-08-19T03:00:00.000Z'],
    );
  });

  it('reports failure when no matching pending tenant-scoped connection is updated', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(repository.markConnected(
      'tenant-2',
      'connection-1',
      'vault://credential-1',
      '2026-08-19T03:00:00.000Z',
    )).resolves.toBe(false);
  });

  it('replaces bindings inside a tenant-scoped transaction', async () => {
    const binding: MetaAssetBinding = {
      tenantId: 'tenant-1',
      connectionId: 'connection-1',
      assetType: 'ad_account',
      externalId: 'act_123',
      displayName: 'Main account',
      selected: false,
      observedAt: '2026-08-24T01:00:00.000Z',
    };

    await repository.replaceBindings('tenant-1', 'connection-1', [binding]);

    expect(clientQuery.mock.calls[0]).toEqual(['begin']);
    expect(clientQuery.mock.calls[1]).toEqual([
      expect.stringContaining('for update'),
      ['tenant-1', 'connection-1'],
    ]);
    expect(clientQuery.mock.calls[2]).toEqual([
      expect.stringContaining('delete from meta_asset_bindings'),
      ['tenant-1', 'connection-1'],
    ]);
    expect(clientQuery.mock.calls[3]).toEqual([
      expect.stringContaining('insert into meta_asset_bindings'),
      [
        'tenant-1', 'connection-1', 'ad_account', 'act_123',
        'Main account', false, binding.observedAt,
      ],
    ]);
    expect(clientQuery.mock.calls[4]).toEqual(['commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-scope binding before opening a transaction', async () => {
    await expect(repository.replaceBindings('tenant-1', 'connection-1', [{
      tenantId: 'tenant-2',
      connectionId: 'connection-1',
      assetType: 'business',
      externalId: 'business-1',
      selected: false,
      observedAt: '2026-08-24T01:00:00.000Z',
    }])).rejects.toThrow('Asset binding scope mismatch');
    expect(connect).not.toHaveBeenCalled();
  });

  it('rolls back a partial binding replacement', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(repository.replaceBindings('tenant-1', 'connection-1', [{
      tenantId: 'tenant-1',
      connectionId: 'connection-1',
      assetType: 'business',
      externalId: 'business-1',
      selected: false,
      observedAt: '2026-08-24T01:00:00.000Z',
    }])).rejects.toThrow('insert failed');
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('lists only tenant-scoped bindings', async () => {
    query.mockResolvedValueOnce({ rows: [{
      tenant_id: 'tenant-1',
      connection_id: 'connection-1',
      asset_type: 'facebook_page',
      external_id: 'page-1',
      display_name: 'Page',
      selected: false,
      observed_at: new Date('2026-08-24T01:00:00.000Z'),
    }] });

    await expect(repository.listBindings('tenant-1', 'connection-1')).resolves.toEqual([{
      tenantId: 'tenant-1',
      connectionId: 'connection-1',
      assetType: 'facebook_page',
      externalId: 'page-1',
      displayName: 'Page',
      selected: false,
      observedAt: '2026-08-24T01:00:00.000Z',
    }]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and connection_id = $2'),
      ['tenant-1', 'connection-1'],
    );
  });
});
