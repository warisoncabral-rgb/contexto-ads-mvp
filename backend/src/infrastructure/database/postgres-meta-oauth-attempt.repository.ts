import { Pool, PoolClient } from 'pg';
import { MetaOAuthAttempt } from '../../domain/contracts/meta-oauth-attempt';
import { MetaOAuthAttemptStore } from '../../domain/ports/repositories';

export class PostgresMetaOAuthAttemptRepository implements MetaOAuthAttemptStore {
  constructor(private readonly pool: Pool) {}

  async replaceActive(attempt: MetaOAuthAttempt): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockConnection(client, attempt.tenantId, attempt.connectionId);
      await client.query(
        `update meta_oauth_attempts
        set invalidated_at = now()
        where tenant_id = $1 and connection_id = $2
          and consumed_at is null and invalidated_at is null`,
        [attempt.tenantId, attempt.connectionId],
      );
      await client.query(
        `insert into meta_oauth_attempts (
          attempt_id, tenant_id, connection_id, state_hash, requested_scopes,
          created_at, expires_at, consumed_at, invalidated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          attempt.attemptId,
          attempt.tenantId,
          attempt.connectionId,
          attempt.stateHash,
          attempt.requestedScopes,
          attempt.createdAt,
          attempt.expiresAt,
          attempt.consumedAt ?? null,
          attempt.invalidatedAt ?? null,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockConnection(
    client: PoolClient,
    tenantId: string,
    connectionId: string,
  ): Promise<void> {
    await client.query(
      `select connection_id
      from meta_connections
      where tenant_id = $1 and connection_id = $2
      for update`,
      [tenantId, connectionId],
    );
  }
}
