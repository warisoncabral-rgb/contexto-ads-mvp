import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionManifestRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface ManifestRow { payload: ExecutionManifestV1 }

export class PostgresExecutionManifestRepository
implements ExecutionManifestRepository {
  constructor(private readonly pool: Pool) {}

  async saveIdempotent(
    manifest: ExecutionManifestV1,
    event: AuditEvent,
  ): Promise<ExecutionManifestV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<ManifestRow>(
        `insert into execution_manifests (
          execution_manifest_id, tenant_id, campaign_id, execution_plan_id,
          readiness_decision_id, simulation_id, plan_hash, manifest_hash,
          status, payload, generated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
        on conflict (tenant_id, campaign_id, execution_plan_id, manifest_hash)
        do nothing returning payload`,
        [manifest.executionManifestId, manifest.tenantId, manifest.campaignId,
          manifest.executionPlanId, manifest.readinessDecisionId,
          manifest.simulationId, manifest.planHash, manifest.manifestHash,
          manifest.status, JSON.stringify(manifest), manifest.generatedAt],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<ManifestRow>(
        `select payload from execution_manifests
        where tenant_id = $1 and campaign_id = $2 and execution_plan_id = $3
          and manifest_hash = $4 limit 1`,
        [manifest.tenantId, manifest.campaignId, manifest.executionPlanId,
          manifest.manifestHash],
      )).rows[0];
      if (!result) throw new Error('Execution manifest idempotency invariant failed');
      return result.payload;
    });
  }

  async latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionManifestV1 | null> {
    const result = await this.pool.query<ManifestRow>(
      `select payload from execution_manifests
      where tenant_id = $1 and execution_plan_id = $2
      order by generated_at desc, execution_manifest_id desc limit 1`,
      [tenantId, executionPlanId],
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
