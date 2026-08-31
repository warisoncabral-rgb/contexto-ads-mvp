import { Pool, PoolClient } from 'pg';
import { AnalystAnalysisV1, AnalystSnapshotV1 } from '../../domain/contracts/analyst';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AnalystRepository } from '../../domain/ports/analyst.repository';
import { insertAuditEvent } from './postgres-audit.repository';

interface SnapshotRow { payload: AnalystSnapshotV1; }
interface AnalysisRow { payload: AnalystAnalysisV1; }

export class PostgresAnalystRepository implements AnalystRepository {
  constructor(private readonly pool: Pool) {}

  async saveSnapshot(
    snapshot: AnalystSnapshotV1,
    event: AuditEvent,
  ): Promise<AnalystSnapshotV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<SnapshotRow>(
        `insert into analyst_snapshots (
          snapshot_id, snapshot_hash, tenant_id, campaign_id, period_start,
          period_end, source, payload, collected_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
        on conflict (tenant_id, campaign_id, snapshot_hash)
        do nothing returning payload`,
        [
          snapshot.snapshotId,
          snapshot.snapshotHash,
          snapshot.tenantId,
          snapshot.campaignId,
          snapshot.periodStart,
          snapshot.periodEnd,
          snapshot.source,
          JSON.stringify(snapshot),
          snapshot.collectedAt,
        ],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<SnapshotRow>(
        `select payload from analyst_snapshots
         where tenant_id = $1 and campaign_id = $2 and snapshot_hash = $3
         limit 1`,
        [snapshot.tenantId, snapshot.campaignId, snapshot.snapshotHash],
      )).rows[0];
      if (!result) throw new Error('Analyst snapshot idempotency invariant failed');
      return result.payload;
    });
  }

  async latestSnapshot(tenantId: string, campaignId: string): Promise<AnalystSnapshotV1 | null> {
    const result = await this.pool.query<SnapshotRow>(
      `select payload from analyst_snapshots
       where tenant_id = $1 and campaign_id = $2
       order by collected_at desc, snapshot_id desc limit 1`,
      [tenantId, campaignId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async previousSnapshot(
    tenantId: string,
    campaignId: string,
    beforeCollectedAt: string,
  ): Promise<AnalystSnapshotV1 | null> {
    const result = await this.pool.query<SnapshotRow>(
      `select payload from analyst_snapshots
       where tenant_id = $1 and campaign_id = $2 and collected_at < $3
       order by collected_at desc, snapshot_id desc limit 1`,
      [tenantId, campaignId, beforeCollectedAt],
    );
    return result.rows[0]?.payload ?? null;
  }

  async saveAnalysis(
    analysis: AnalystAnalysisV1,
    event: AuditEvent,
  ): Promise<AnalystAnalysisV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<AnalysisRow>(
        `insert into analyst_analyses (
          analysis_id, tenant_id, campaign_id, snapshot_id,
          recommended_action, health_status, confidence, payload, generated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
        on conflict (tenant_id, campaign_id, snapshot_id)
        do nothing returning payload`,
        [
          analysis.analysisId,
          analysis.tenantId,
          analysis.campaignId,
          analysis.snapshotId,
          analysis.recommendedAction,
          analysis.healthStatus,
          analysis.confidence,
          JSON.stringify(analysis),
          analysis.generatedAt,
        ],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<AnalysisRow>(
        `select payload from analyst_analyses
         where tenant_id = $1 and campaign_id = $2 and snapshot_id = $3
         limit 1`,
        [analysis.tenantId, analysis.campaignId, analysis.snapshotId],
      )).rows[0];
      if (!result) throw new Error('Analyst analysis idempotency invariant failed');
      return result.payload;
    });
  }

  async latestAnalysis(tenantId: string, campaignId: string): Promise<AnalystAnalysisV1 | null> {
    const result = await this.pool.query<AnalysisRow>(
      `select payload from analyst_analyses
       where tenant_id = $1 and campaign_id = $2
       order by generated_at desc, analysis_id desc limit 1`,
      [tenantId, campaignId],
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
