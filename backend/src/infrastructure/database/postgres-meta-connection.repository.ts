import { Pool, PoolClient } from 'pg';
import {
  MetaAssetBinding,
  MetaAssetSelection,
  MetaConnection,
} from '../../domain/contracts/meta-connection';
import {
  MetaAssetBindingStore,
  MetaConnectionStore,
} from '../../domain/ports/repositories';

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

interface MetaAssetBindingRow {
  tenant_id: string;
  connection_id: string;
  asset_type: MetaAssetBinding['assetType'];
  external_id: string;
  display_name: string | null;
  selected: boolean;
  observed_at: Date;
}

export class PostgresMetaConnectionRepository
implements MetaConnectionStore, MetaAssetBindingStore {
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
    return result.rows[0] ? this.toConnection(result.rows[0]) : null;
  }

  async latestReadyForTenant(tenantId: string): Promise<MetaConnection | null> {
    const result = await this.pool.query<MetaConnectionRow>(
      `select connection_id, tenant_id, provider, status, credential_ref,
        last_validated_at, created_at, updated_at
      from meta_connections
      where tenant_id = $1 and status in ('connected', 'ready')
        and credential_ref is not null
      order by updated_at desc, connection_id desc
      limit 1`,
      [tenantId],
    );
    return result.rows[0] ? this.toConnection(result.rows[0]) : null;
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

  async replaceBindings(
    tenantId: string,
    connectionId: string,
    bindings: MetaAssetBinding[],
  ): Promise<void> {
    if (bindings.some(
      (binding) => binding.tenantId !== tenantId || binding.connectionId !== connectionId,
    )) {
      throw new Error('Asset binding scope mismatch');
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockConnection(client, tenantId, connectionId);
      const selected = await client.query<Pick<MetaAssetBindingRow, 'asset_type' | 'external_id'>>(
        `select asset_type, external_id from meta_asset_bindings
        where tenant_id = $1 and connection_id = $2 and selected = true
        for update`,
        [tenantId, connectionId],
      );
      const selectedKeys = new Set(selected.rows.map(
        (row) => `${row.asset_type}:${row.external_id}`,
      ));
      await client.query(
        'delete from meta_asset_bindings where tenant_id = $1 and connection_id = $2',
        [tenantId, connectionId],
      );
      for (const binding of bindings) {
        await client.query(
          `insert into meta_asset_bindings (
            tenant_id, connection_id, asset_type, external_id,
            display_name, selected, observed_at
          ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            connectionId,
            binding.assetType,
            binding.externalId,
            binding.displayName ?? null,
            binding.selected || selectedKeys.has(`${binding.assetType}:${binding.externalId}`),
            binding.observedAt,
          ],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBindings(
    tenantId: string,
    connectionId: string,
  ): Promise<MetaAssetBinding[]> {
    const result = await this.pool.query<MetaAssetBindingRow>(
      `select tenant_id, connection_id, asset_type, external_id,
        display_name, selected, observed_at
      from meta_asset_bindings
      where tenant_id = $1 and connection_id = $2
      order by asset_type, external_id`,
      [tenantId, connectionId],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      assetType: row.asset_type,
      externalId: row.external_id,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      selected: row.selected,
      observedAt: row.observed_at.toISOString(),
    }));
  }

  async selectBindings(
    tenantId: string,
    connectionId: string,
    selections: MetaAssetSelection[],
  ): Promise<MetaAssetBinding[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockConnection(client, tenantId, connectionId);
      await client.query(
        `update meta_asset_bindings set selected = false
        where tenant_id = $1 and connection_id = $2`,
        [tenantId, connectionId],
      );
      for (const selection of selections) {
        const updated = await client.query(
          `update meta_asset_bindings set selected = true
          where tenant_id = $1 and connection_id = $2
            and asset_type = $3 and external_id = $4`,
          [tenantId, connectionId, selection.assetType, selection.externalId],
        );
        if (updated.rowCount !== 1) throw new Error('Discovered Meta asset not found');
      }
      const result = await client.query<MetaAssetBindingRow>(
        `select tenant_id, connection_id, asset_type, external_id,
          display_name, selected, observed_at
        from meta_asset_bindings
        where tenant_id = $1 and connection_id = $2
        order by asset_type, external_id`,
        [tenantId, connectionId],
      );
      await client.query('commit');
      return result.rows.map((row) => this.toBinding(row));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private toBinding(row: MetaAssetBindingRow): MetaAssetBinding {
    return {
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      assetType: row.asset_type,
      externalId: row.external_id,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      selected: row.selected,
      observedAt: row.observed_at.toISOString(),
    };
  }

  private toConnection(row: MetaConnectionRow): MetaConnection {
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

  private async lockConnection(
    client: PoolClient,
    tenantId: string,
    connectionId: string,
  ): Promise<void> {
    const result = await client.query(
      `select connection_id from meta_connections
      where tenant_id = $1 and connection_id = $2
      for update`,
      [tenantId, connectionId],
    );
    if (result.rowCount !== 1) {
      throw new Error('Tenant-scoped Meta connection not found');
    }
  }
}
