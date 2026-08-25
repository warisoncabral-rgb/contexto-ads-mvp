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

  async consumeActive(stateHash: string): Promise<MetaOAuthAttempt | null> {
    const result = await this.pool.query<{
      attempt_id: string;
      tenant_id: string;
      connection_id: string;
      state_hash: string;
      requested_scopes: string[];
      created_at: Date;
      expires_at: Date;
      consumed_at: Date;
      invalidated_at: Date | null;
    }>(
      `update meta_oauth_attempts
      set consumed_at = now()
      where state_hash = $1
        and consumed_at is null
        and invalidated_at is null
        and expires_at > now()
      returning attempt_id, tenant_id, connection_id, state_hash,
        requested_scopes, created_at, expires_at, consumed_at, invalidated_at`,
      [stateHash],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      attemptId: row.attempt_id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      stateHash: row.state_hash,
      requestedScopes: row.requested_scopes,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      consumedAt: row.consumed_at.toISOString(),
      ...(row.invalidated_at
        ? { invalidatedAt: row.invalidated_at.toISOString() }
        : {}),
    };
  }

  async recordCredentialRevocationPending(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    createdAt: string,
  ): Promise<void> {
    await this.pool.query(
      `insert into meta_oauth_credential_compensations (
        tenant_id, connection_id, credential_ref, reason, created_at
      ) values ($1, $2, $3, 'connection_finalization_failed', $4)`,
      [tenantId, connectionId, credentialRef, createdAt],
    );
  }

  private async lockConnection(
    client: PoolClient,
    tenantId: string,
    connectionId: string,
  ): Promise<void> {
    const result = await client.query(
      `select connection_id
      from meta_connections
      where tenant_id = $1 and connection_id = $2
      for update`,
      [tenantId, connectionId],
    );

    if (result.rowCount !== 1) {
      throw new Error('Tenant-scoped Meta connection not found');
    }
  }
}
