import { Pool } from 'pg';
import { ExecutionSimulationReportV1 } from '../../domain/contracts/execution-simulation';
import { PostgresExecutionSimulationRepository } from './postgres-execution-simulation.repository';

describe('PostgresExecutionSimulationRepository', () => {
  const report: ExecutionSimulationReportV1 = {
    simulationId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    planHash: 'a'.repeat(64),
    status: 'blocked',
    checks: [],
    operations: [],
    blockers: ['creative_approval'],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    generatedAt: '2026-08-24T13:00:00.000Z',
  };
  const query = jest.fn();
  const repository = new PostgresExecutionSimulationRepository({ query } as unknown as Pool);

  beforeEach(() => query.mockReset());

  it('persists the complete immutable dry-run report', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repository.save(report);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into execution_simulation_reports'),
      [
        report.simulationId,
        report.tenantId,
        report.campaignId,
        report.executionPlanId,
        report.planHash,
        null,
        report.status,
        JSON.stringify(report.checks),
        JSON.stringify(report.operations),
        JSON.stringify(report.blockers),
        JSON.stringify(report.externalEffects),
        report.generatedAt,
      ],
    );
  });

  it('loads only the latest tenant-scoped report for a plan', async () => {
    query.mockResolvedValueOnce({ rows: [{
      simulation_id: report.simulationId,
      tenant_id: report.tenantId,
      campaign_id: report.campaignId,
      execution_plan_id: report.executionPlanId,
      plan_hash: report.planHash,
      approval_id: null,
      status: report.status,
      checks: report.checks,
      operations: report.operations,
      blockers: report.blockers,
      external_effects: report.externalEffects,
      generated_at: new Date(report.generatedAt),
    }] });
    await expect(repository.latestForPlan(report.tenantId, report.executionPlanId))
      .resolves.toEqual(report);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_plan_id = $2'),
      [report.tenantId, report.executionPlanId],
    );
  });
});
