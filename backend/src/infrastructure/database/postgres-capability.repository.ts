import { Pool, PoolClient } from 'pg';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { CapabilityRepository } from '../../domain/ports/repositories';

interface CapabilityRow {
  capability_id: string;
  tenant_id: string;
  connection_id: string;
  capability_type: CapabilityRecord['capabilityType'];
  asset_scope: string | null;
  required_permissions: string[];
  granted_permissions: string[];
  status: CapabilityRecord['status'];
  api_version: string | null;
  restrictions: string[];
  validation_source: CapabilityRecord['validationSource'];
  validated_at: Date;
}

export class PostgresCapabilityRepository implements CapabilityRepository {
  constructor(private readonly pool: Pool) {}

  async replaceForConnection(
    tenantId: string,
    connectionId: string,
    capabilities: CapabilityRecord[],
  ): Promise<void> {
    if (capabilities.some(
      (item) => item.tenantId !== tenantId || item.connectionId !== connectionId,
    )) {
      throw new Error('Capability scope mismatch');
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockConnection(client, tenantId, connectionId);
      await client.query(
        'delete from capability_registry where tenant_id = $1 and connection_id = $2',
        [tenantId, connectionId],
      );
      for (const capability of capabilities) {
        await client.query(
          `insert into capability_registry (
            capability_id, tenant_id, connection_id, capability_type,
            asset_scope, required_permissions, granted_permissions, status,
            api_version, restrictions, validation_source, validated_at
          ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb, $11, $12)`,
          [
            capability.capabilityId,
            tenantId,
            connectionId,
            capability.capabilityType,
            capability.assetScope ?? null,
            JSON.stringify(capability.requiredPermissions),
            JSON.stringify(capability.grantedPermissions),
            capability.status,
            capability.apiVersion ?? null,
            JSON.stringify(capability.restrictions),
            capability.validationSource,
            capability.validatedAt,
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

  async listForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<CapabilityRecord[]> {
    const result = await this.pool.query<CapabilityRow>(
      `select capability_id, tenant_id, connection_id, capability_type,
        asset_scope, required_permissions, granted_permissions, status,
        api_version, restrictions, validation_source, validated_at
      from capability_registry
      where tenant_id = $1 and connection_id = $2
      order by capability_type, coalesce(asset_scope, '')`,
      [tenantId, connectionId],
    );
    return result.rows.map((row) => ({
      capabilityId: row.capability_id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      capabilityType: row.capability_type,
      ...(row.asset_scope ? { assetScope: row.asset_scope } : {}),
      requiredPermissions: row.required_permissions,
      grantedPermissions: row.granted_permissions,
      status: row.status,
      ...(row.api_version ? { apiVersion: row.api_version } : {}),
      restrictions: row.restrictions,
      validationSource: row.validation_source,
      validatedAt: row.validated_at.toISOString(),
    }));
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
