import { Pool } from 'pg';
import { ReadOnlySmokeTestReport } from '../../domain/contracts/readiness';
import { SmokeTestReportRepository } from '../../domain/ports/repositories';

interface SmokeTestReportRow {
  smoke_test_id: string;
  tenant_id: string;
  connection_id: string;
  passed: boolean;
  steps: ReadOnlySmokeTestReport['steps'];
  blockers: string[];
  generated_at: Date;
}

export class PostgresSmokeTestReportRepository implements SmokeTestReportRepository {
  constructor(private readonly pool: Pool) {}

  async save(report: ReadOnlySmokeTestReport): Promise<void> {
    await this.pool.query(
      `insert into meta_smoke_test_reports (
        smoke_test_id, tenant_id, connection_id, passed,
        steps, blockers, generated_at
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      on conflict (smoke_test_id) do nothing`,
      [
        report.smokeTestId,
        report.tenantId,
        report.connectionId,
        report.passed,
        JSON.stringify(report.steps),
        JSON.stringify(report.blockers),
        report.generatedAt,
      ],
    );
  }

  async latestForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadOnlySmokeTestReport | null> {
    const result = await this.pool.query<SmokeTestReportRow>(
      `select smoke_test_id, tenant_id, connection_id, passed,
        steps, blockers, generated_at
      from meta_smoke_test_reports
      where tenant_id = $1 and connection_id = $2
      order by generated_at desc, smoke_test_id desc
      limit 1`,
      [tenantId, connectionId],
    );
    const row = result.rows[0];
    return row ? {
      smokeTestId: row.smoke_test_id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      passed: row.passed,
      steps: row.steps,
      blockers: row.blockers,
      generatedAt: row.generated_at.toISOString(),
    } : null;
  }
}
