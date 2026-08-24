import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import { MetaWriteValidationProtocolRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface ProtocolRow { payload: MetaWriteValidationProtocolV1 }

export class PostgresMetaWriteValidationProtocolRepository
implements MetaWriteValidationProtocolRepository {
  constructor(private readonly pool: Pool) {}

  async saveIdempotent(
    protocol: MetaWriteValidationProtocolV1,
    event: AuditEvent,
  ): Promise<MetaWriteValidationProtocolV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<ProtocolRow>(
        `insert into meta_write_validation_protocols (
          meta_write_validation_protocol_id, tenant_id, campaign_id,
          execution_plan_id, execution_manifest_id, plan_hash, manifest_hash,
          protocol_hash, status, payload, prepared_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
        on conflict (
          tenant_id, execution_manifest_id, manifest_hash, protocol_hash
        ) do nothing returning payload`,
        [protocol.metaWriteValidationProtocolId, protocol.tenantId,
          protocol.campaignId, protocol.executionPlanId,
          protocol.executionManifestId, protocol.planHash, protocol.manifestHash,
          protocol.protocolHash, protocol.status, JSON.stringify(protocol),
          protocol.preparedAt],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<ProtocolRow>(
        `select payload from meta_write_validation_protocols
        where tenant_id = $1 and execution_manifest_id = $2
          and manifest_hash = $3 and protocol_hash = $4 limit 1`,
        [protocol.tenantId, protocol.executionManifestId,
          protocol.manifestHash, protocol.protocolHash],
      )).rows[0];
      if (!result) throw new Error('Meta write validation protocol invariant failed');
      return result.payload;
    });
  }

  async latestForManifest(
    tenantId: string,
    executionManifestId: string,
  ): Promise<MetaWriteValidationProtocolV1 | null> {
    const result = await this.pool.query<ProtocolRow>(
      `select payload from meta_write_validation_protocols
      where tenant_id = $1 and execution_manifest_id = $2
      order by prepared_at desc, meta_write_validation_protocol_id desc limit 1`,
      [tenantId, executionManifestId],
    );
    return result.rows[0]?.payload ?? null;
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
