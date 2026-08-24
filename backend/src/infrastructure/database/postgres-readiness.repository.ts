import { Pool } from 'pg';
import { ReadinessSnapshot } from '../../domain/contracts/readiness';
import { ReadinessRepository } from '../../domain/ports/repositories';

interface ReadinessRow {
  snapshot_id: string;
  tenant_id: string;
  connection_id: string;
  correlation_id: string;
  checks: ReadinessSnapshot['checks'];
  blockers: string[];
  generated_at: Date;
}

export class PostgresReadinessRepository implements ReadinessRepository {
  constructor(private readonly pool: Pool) {}

  async save(snapshot: ReadinessSnapshot): Promise<void> {
    await this.pool.query(
      `insert into readiness_snapshots (
        snapshot_id, tenant_id, connection_id, correlation_id,
        checks, blockers, generated_at
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      on conflict (snapshot_id) do nothing`,
      [
        snapshot.snapshotId,
        snapshot.tenantId,
        snapshot.connectionId,
        snapshot.correlationId,
        JSON.stringify(snapshot.checks),
        JSON.stringify(snapshot.blockers),
        snapshot.generatedAt,
      ],
    );
  }

  async latestForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadinessSnapshot | null> {
    const result = await this.pool.query<ReadinessRow>(
      `select snapshot_id, tenant_id, connection_id, correlation_id,
        checks, blockers, generated_at
      from readiness_snapshots
      where tenant_id = $1 and connection_id = $2
      order by generated_at desc, snapshot_id desc
      limit 1`,
      [tenantId, connectionId],
    );
    const row = result.rows[0];
    return row ? {
      snapshotId: row.snapshot_id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      correlationId: row.correlation_id,
      checks: row.checks,
      blockers: row.blockers,
      generatedAt: row.generated_at.toISOString(),
    } : null;
  }
}
