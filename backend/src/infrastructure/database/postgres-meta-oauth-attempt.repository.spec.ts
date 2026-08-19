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
  const pool = { connect } as unknown as Pool;
  const repository = new PostgresMetaOAuthAttemptRepository(pool);

  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    release.mockReset();
    connect.mockClear();
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.replaceActive(attempt)).rejects.toThrow('insert failed');
    expect(query).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
