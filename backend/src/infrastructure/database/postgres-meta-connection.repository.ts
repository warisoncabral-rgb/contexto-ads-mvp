import { Pool } from 'pg';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaConnectionStore } from '../../domain/ports/repositories';

interface MetaConnectionRow {
  connection_id: string;
  tenant_id: string;
  provider: 'meta';
  status: MetaConnection['status'];
  credential_ref: string | null;
  last_validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresMetaConnectionRepository implements MetaConnectionStore {
  constructor(private readonly pool: Pool) {}

  async save(connection: MetaConnection): Promise<void> {
    await this.pool.query(
      `insert into meta_connections (
        connection_id, tenant_id, provider, status, credential_ref,
        last_validated_at, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        connection.connectionId,
        connection.tenantId,
        connection.provider,
        connection.status,
        connection.credentialRef ?? null,
        connection.lastValidatedAt ?? null,
        connection.createdAt,
        connection.updatedAt,
      ],
    );
  }

  async findById(tenantId: string, connectionId: string): Promise<MetaConnection | null> {
    const result = await this.pool.query<MetaConnectionRow>(
      `select connection_id, tenant_id, provider, status, credential_ref,
        last_validated_at, created_at, updated_at
      from meta_connections
      where tenant_id = $1 and connection_id = $2`,
      [tenantId, connectionId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      connectionId: row.connection_id,
      tenantId: row.tenant_id,
      provider: row.provider,
      status: row.status,
      ...(row.credential_ref ? { credentialRef: row.credential_ref } : {}),
      ...(row.last_validated_at ? { lastValidatedAt: row.last_validated_at.toISOString() } : {}),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async markConnected(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    updatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update meta_connections
      set credential_ref = $3, status = 'connected', updated_at = $4
      where tenant_id = $1 and connection_id = $2
        and status = 'authorization_pending'`,
      [tenantId, connectionId, credentialRef, updatedAt],
    );

    return result.rowCount === 1;
  }
}
