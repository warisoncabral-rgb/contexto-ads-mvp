import { Pool, PoolClient } from 'pg';
import { MetaOAuthAttempt } from '../../domain/contracts/meta-oauth-attempt';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';

describe('PostgresMetaOAuthAttemptRepository', () => {
  const attempt: MetaOAuthAttempt = {
    attemptId: '33333333-3333-4333-8333-333333333333',
    tenantId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    stateHash: 'a'.repeat(64),
    requestedScopes: ['public_profile'],
    createdAt: '2026-08-19T02:00:00.000Z',
    expiresAt: '2026-08-19T02:10:00.000Z',
  };
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const poolQuery = jest.fn();
  const pool = { connect, query: poolQuery } as unknown as Pool;
  const repository = new PostgresMetaOAuthAttemptRepository(pool);

  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    release.mockReset();
    connect.mockClear();
    poolQuery.mockReset();
  });

  it('locks the tenant-scoped connection before replacing the active attempt', async () => {
    await repository.replaceActive(attempt);

    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('for update'),
      [attempt.tenantId, attempt.connectionId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      expect.stringContaining('set invalidated_at = now()'),
      [attempt.tenantId, attempt.connectionId],
    ]);
  });

  it('inserts the attempt with parameterized values and commits the transaction', async () => {
    await repository.replaceActive(attempt);

    expect(query.mock.calls[3]).toEqual([
      expect.stringContaining('insert into meta_oauth_attempts'),
      [
        attempt.attemptId,
        attempt.tenantId,
        attempt.connectionId,
        attempt.stateHash,
        attempt.requestedScopes,
        attempt.createdAt,
        attempt.expiresAt,
        null,
        null,
      ],
    ]);
    expect(query.mock.calls[0]).toEqual(['begin']);
    expect(query.mock.calls[4]).toEqual(['commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the client when persistence fails', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(repository.replaceActive(attempt)).rejects.toThrow('insert failed');
    expect(query).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back without invalidating or inserting when the tenant-scoped connection is not found', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(repository.replaceActive(attempt)).rejects.toThrow(
      'Tenant-scoped Meta connection not found',
    );

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]).toEqual(['begin']);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('for update'),
      [attempt.tenantId, attempt.connectionId],
    ]);
    expect(query.mock.calls[2]).toEqual(['rollback']);
    expect(query).not.toHaveBeenCalledWith('commit');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('atomically consumes only a valid active unexpired state', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{
      attempt_id: attempt.attemptId,
      tenant_id: attempt.tenantId,
      connection_id: attempt.connectionId,
      state_hash: attempt.stateHash,
      requested_scopes: attempt.requestedScopes,
      created_at: new Date(attempt.createdAt),
      expires_at: new Date(attempt.expiresAt),
      consumed_at: new Date('2026-08-19T02:01:00.000Z'),
      invalidated_at: null,
    }] });

    const result = await repository.consumeActive(attempt.stateHash);

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/set consumed_at = now\(\)[\s\S]*consumed_at is null[\s\S]*invalidated_at is null[\s\S]*expires_at > now\(\)[\s\S]*returning/),
      [attempt.stateHash],
    );
    expect(result).toEqual(expect.objectContaining({
      tenantId: attempt.tenantId,
      connectionId: attempt.connectionId,
      consumedAt: '2026-08-19T02:01:00.000Z',
    }));
  });

  it('returns null when state is expired, invalidated, consumed, or unknown', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    await expect(repository.consumeActive(attempt.stateHash)).resolves.toBeNull();
  });

  it('uses only the state hash as the consumption parameter', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    await repository.consumeActive(attempt.stateHash);
    expect(poolQuery.mock.calls[0][1]).toEqual([attempt.stateHash]);
    expect(JSON.stringify(poolQuery.mock.calls[0])).not.toContain(attempt.tenantId);
  });
});
