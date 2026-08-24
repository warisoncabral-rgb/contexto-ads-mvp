import { Pool } from 'pg';
import { ExecutionSimulationReportV1 } from '../../domain/contracts/execution-simulation';
import { ExecutionSimulationRepository } from '../../domain/ports/repositories';

interface SimulationRow {
  simulation_id: string;
  tenant_id: string;
  campaign_id: string;
  execution_plan_id: string;
  plan_hash: string;
  approval_id: string | null;
  status: ExecutionSimulationReportV1['status'];
  checks: ExecutionSimulationReportV1['checks'];
  operations: ExecutionSimulationReportV1['operations'];
  blockers: string[];
  external_effects: ExecutionSimulationReportV1['externalEffects'];
  generated_at: Date;
}

export class PostgresExecutionSimulationRepository
implements ExecutionSimulationRepository {
  constructor(private readonly pool: Pool) {}

  async save(report: ExecutionSimulationReportV1): Promise<void> {
    await this.pool.query(
      `insert into execution_simulation_reports (
        simulation_id, tenant_id, campaign_id, execution_plan_id, plan_hash,
        approval_id, status, checks, operations, blockers, external_effects, generated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
        $11::jsonb, $12)`,
      [
        report.simulationId,
        report.tenantId,
        report.campaignId,
        report.executionPlanId,
        report.planHash,
        report.approvalId ?? null,
        report.status,
        JSON.stringify(report.checks),
        JSON.stringify(report.operations),
        JSON.stringify(report.blockers),
        JSON.stringify(report.externalEffects),
        report.generatedAt,
      ],
    );
  }

  async latestForPlan(
    tenantId: string,
    executionPlanId: string,
  ): Promise<ExecutionSimulationReportV1 | null> {
    return this.findOne(
      `where tenant_id = $1 and execution_plan_id = $2
      order by generated_at desc, simulation_id desc limit 1`,
      [tenantId, executionPlanId],
    );
  }

  async findById(
    tenantId: string,
    executionPlanId: string,
    simulationId: string,
  ): Promise<ExecutionSimulationReportV1 | null> {
    return this.findOne(
      `where tenant_id = $1 and execution_plan_id = $2 and simulation_id = $3
      limit 1`,
      [tenantId, executionPlanId, simulationId],
    );
  }

  private async findOne(where: string, values: string[]): Promise<ExecutionSimulationReportV1 | null> {
    const result = await this.pool.query<SimulationRow>(
      `select simulation_id, tenant_id, campaign_id, execution_plan_id, plan_hash,
        approval_id, status, checks, operations, blockers, external_effects, generated_at
      from execution_simulation_reports
      ${where}`,
      values,
    );
    const row = result.rows[0];
    return row ? {
      simulationId: row.simulation_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      executionPlanId: row.execution_plan_id,
      planHash: row.plan_hash,
      ...(row.approval_id ? { approvalId: row.approval_id } : {}),
      status: row.status,
      checks: row.checks,
      operations: row.operations,
      blockers: row.blockers,
      externalEffects: row.external_effects,
      generatedAt: row.generated_at.toISOString(),
    } : null;
  }
}
