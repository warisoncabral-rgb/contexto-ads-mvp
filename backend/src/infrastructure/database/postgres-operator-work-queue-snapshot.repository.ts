import { Pool } from 'pg';
import {
  OperatorWorkItemV1,
  OperatorWorkQueueSnapshotInputV1,
  OperatorWorkQueueSnapshotV1,
  OperatorWorkQueueStoredSnapshotV1,
} from '../../domain/contracts/operator-work-queue';
import { OperatorWorkQueueSnapshotRepository } from '../../domain/ports/repositories';
import { compareWorkQueueSnapshots } from '../../modules/operator-access/operator-work-queue-changes';

interface SnapshotRow {
  snapshot_id: string;
  tenant_id: string;
  queue_date: string | Date;
  snapshot_hash: string;
  items?: OperatorWorkItemV1[];
  source_decisions: OperatorWorkQueueSnapshotV1['sourceDecisions'];
  generated_at: string | Date;
  item_count: string;
}

export class PostgresOperatorWorkQueueSnapshotRepository
implements OperatorWorkQueueSnapshotRepository {
  constructor(private readonly pool: Pool) {}

  async saveDaily(snapshot: OperatorWorkQueueSnapshotInputV1,
    items: OperatorWorkItemV1[]): Promise<OperatorWorkQueueSnapshotV1> {
    const previous = await this.latestBefore(snapshot.tenantId, snapshot.queueDate);
    const result = await this.pool.query<SnapshotRow>(
      `insert into operator_work_queue_snapshots (
        snapshot_id, tenant_id, queue_date, snapshot_hash, items, source_decisions, generated_at
      ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
      on conflict (tenant_id, queue_date) do update set
        snapshot_hash = excluded.snapshot_hash,
        items = excluded.items,
        source_decisions = excluded.source_decisions,
        generated_at = excluded.generated_at
      where operator_work_queue_snapshots.snapshot_hash <> excluded.snapshot_hash
      returning snapshot_id, tenant_id, queue_date, snapshot_hash, source_decisions,
        generated_at, jsonb_array_length(items)::text as item_count`,
      [snapshot.snapshotId, snapshot.tenantId, snapshot.queueDate, snapshot.snapshotHash,
        JSON.stringify(items), JSON.stringify(snapshot.sourceDecisions), snapshot.generatedAt],
    );
    const row = result.rows[0] ?? (await this.pool.query<SnapshotRow>(
      `select snapshot_id, tenant_id, queue_date, snapshot_hash, source_decisions,
        generated_at, jsonb_array_length(items)::text as item_count
      from operator_work_queue_snapshots where tenant_id = $1 and queue_date = $2`,
      [snapshot.tenantId, snapshot.queueDate],
    )).rows[0];
    if (!row) throw new Error('Daily work queue snapshot idempotency invariant failed');
    const comparison = compareWorkQueueSnapshots(snapshot.queueDate, items, previous);
    return { ...this.toSnapshot(row), comparison: {
      baselineAvailable: comparison.baselineAvailable,
      previousQueueDate: previous?.queueDate ?? null,
      changes: comparison.changes,
    } };
  }

  async latestBefore(tenantId: string, queueDate: string): Promise<OperatorWorkQueueStoredSnapshotV1 | null> {
    const row = (await this.pool.query<SnapshotRow>(
      `select snapshot_id, tenant_id, queue_date, snapshot_hash, items, source_decisions,
        generated_at, jsonb_array_length(items)::text as item_count
      from operator_work_queue_snapshots
      where tenant_id = $1 and queue_date < $2
      order by queue_date desc
      limit 1`,
      [tenantId, queueDate],
    )).rows[0];
    if (!row) return null;
    return { ...this.toSnapshot(row), items: row.items ?? [] };
  }

  private toSnapshot(row: SnapshotRow): OperatorWorkQueueSnapshotInputV1 {
    return { snapshotId: row.snapshot_id, tenantId: row.tenant_id,
      queueDate: row.queue_date instanceof Date
        ? row.queue_date.toISOString().slice(0, 10) : String(row.queue_date).slice(0, 10),
      calendarBasis: 'UTC', snapshotHash: row.snapshot_hash,
      itemCount: Number(row.item_count), sourceDecisions: row.source_decisions,
      generatedAt: row.generated_at instanceof Date
        ? row.generated_at.toISOString() : row.generated_at };
  }
}
