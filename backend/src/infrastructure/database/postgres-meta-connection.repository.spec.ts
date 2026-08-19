import { Pool } from 'pg';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';

describe('PostgresMetaConnectionRepository', () => {
  const query = jest.fn();
  const pool = { query } as unknown as Pool;
  const repository = new PostgresMetaConnectionRepository(pool);

  beforeEach(() => query.mockReset());

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
});
