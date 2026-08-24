import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { OperationalReadinessDecisionV1 } from '../../domain/contracts/operational-readiness';
import { ExecutionSimulationReportV1 } from '../../domain/contracts/execution-simulation';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ExecutionPlanRepository,
  OperationalReadinessRepository,
} from '../../domain/ports/repositories';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';
import { OperationalReadinessService } from './operational-readiness.service';

describe('OperationalReadinessService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';
  const simulationId = '44444444-4444-4444-8444-444444444444';
  const approvalId = '55555555-5555-4555-8555-555555555555';
  const plan: ExecutionPlanV1 = {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 1,
    planVersion: '1.0',
    correlationId: '66666666-6666-4666-8666-666666666666',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'draft',
    meta: { assetBindings: [], requiredCapabilities: [] },
    objectsToCreate: [],
    readiness: [],
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 1200,
      maximumPlannedSpendMinor: 8400,
      calculation: '1200 x 7 days',
    },
    decisions: [],
    risks: [],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T12:00:00.000Z',
  };
  const passedChecks: ExecutionSimulationReportV1['checks'] = [
    'plan_current', 'dependency_graph', 'meta_connection', 'ad_account_binding',
    'write_capabilities', 'plan_approval', 'creative_approval', 'external_write_guard',
  ].map((key) => ({
    key: key as ExecutionSimulationReportV1['checks'][number]['key'],
    status: 'passed',
    meaning: `${key} passou`,
    evidenceRefs: [`evidence:${key}`],
  }));
  const readySimulation: ExecutionSimulationReportV1 = {
    simulationId,
    tenantId,
    campaignId,
    executionPlanId,
    planHash: plan.planHash,
    approvalId,
    status: 'ready_for_execution',
    checks: passedChecks,
    operations: [],
    blockers: [],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    generatedAt: '2026-08-24T12:30:00.000Z',
  };
  let simulations: jest.Mocked<ExecutionSimulationService>;
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let decisions: jest.Mocked<OperationalReadinessRepository>;
  let service: OperationalReadinessService;

  beforeEach(() => {
    simulations = {
      latestSimulation: jest.fn().mockResolvedValue(null),
      simulate: jest.fn().mockResolvedValue(readySimulation),
    } as unknown as jest.Mocked<ExecutionSimulationService>;
    plans = {
      saveIdempotent: jest.fn(),
      latest: jest.fn().mockResolvedValue(plan),
      findById: jest.fn().mockResolvedValue(plan),
    };
    decisions = {
      saveIdempotent: jest.fn(async (
        decision: OperationalReadinessDecisionV1,
        _event: AuditEvent,
      ) => decision),
      latestForPlan: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<OperationalReadinessRepository>;
    service = new OperationalReadinessService(simulations, plans, decisions);
  });

  it('reports internal readiness without claiming publication, activation or delivery', async () => {
    const result = await service.generate(
      tenantId, campaignId, executionPlanId, approvalId,
    );

    expect(result.status).toBe('ready_for_executor_validation');
    expect(result.headline).toContain('falta validar o executor real');
    expect(result.plainLanguageSummary).toContain(
      'não significa publicado, ativo ou entregando',
    );
    expect(result.progress).toEqual(expect.objectContaining({
      campaignPreparation: 'complete',
      executorValidation: 'pending',
      publication: 'not_started',
      activation: 'not_started',
      delivery: 'not_started',
    }));
    expect(result.boundaries).toEqual({
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
  });

  it('re-runs the safe simulation with the explicit approval', async () => {
    await service.generate(tenantId, campaignId, executionPlanId, approvalId);
    expect(simulations.simulate).toHaveBeenCalledWith(
      tenantId, campaignId, executionPlanId, approvalId,
    );
    expect(simulations.latestSimulation).not.toHaveBeenCalled();
  });

  it('reuses the latest approval reference when none is supplied', async () => {
    simulations.latestSimulation.mockResolvedValueOnce(readySimulation);
    await service.generate(tenantId, campaignId, executionPlanId);
    expect(simulations.simulate).toHaveBeenCalledWith(
      tenantId, campaignId, executionPlanId, approvalId,
    );
  });

  it('returns action required for operator and Meta environment pending items', async () => {
    simulations.simulate.mockResolvedValueOnce({
      ...readySimulation,
      status: 'blocked',
      checks: passedChecks.map((check) =>
        ['write_capabilities', 'creative_approval', 'plan_approval'].includes(check.key)
          ? { ...check, status: 'blocked' as const, nextAction: `resolver ${check.key}` }
          : check),
      blockers: ['write_capabilities', 'creative_approval', 'plan_approval'],
    });

    const result = await service.generate(tenantId, campaignId, executionPlanId);
    expect(result.status).toBe('action_required');
    expect(result.blockers.map((blocker) => blocker.owner)).toEqual([
      'meta_environment', 'operator', 'operator',
    ]);
    expect(result.nextAction).toBe('resolver write_capabilities');
    expect(result.progress.metaEnvironmentValidation).toBe('pending');
    expect(result.progress.creativeApproval).toBe('pending');
    expect(result.progress.humanPlanApproval).toBe('pending');
  });

  it('reports blocked when an internal safety invariant fails', async () => {
    simulations.simulate.mockResolvedValueOnce({
      ...readySimulation,
      status: 'blocked',
      checks: passedChecks.map((check) => check.key === 'external_write_guard'
        ? { ...check, status: 'blocked' as const, nextAction: 'restaurar trava' }
        : check),
      blockers: ['external_write_guard'],
    });

    const result = await service.generate(tenantId, campaignId, executionPlanId);
    expect(result.status).toBe('blocked');
    expect(result.blockers[0]).toEqual(expect.objectContaining({
      code: 'external_write_guard',
      owner: 'system',
    }));
    expect(result.nextAction).toBe('restaurar trava');
  });

  it('orders the next action by safety dependency instead of input order', async () => {
    const blocked = passedChecks.map((check) =>
      ['plan_approval', 'meta_connection', 'dependency_graph'].includes(check.key)
        ? { ...check, status: 'blocked' as const, nextAction: `resolver ${check.key}` }
        : check);
    simulations.simulate.mockResolvedValueOnce({
      ...readySimulation,
      status: 'blocked',
      checks: blocked.reverse(),
      blockers: ['plan_approval', 'meta_connection', 'dependency_graph'],
    });

    const result = await service.generate(tenantId, campaignId, executionPlanId);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'dependency_graph', 'meta_connection', 'plan_approval',
    ]);
    expect(result.nextAction).toBe('resolver dependency_graph');
  });

  it('shows the exact financial ceiling and autonomy level', async () => {
    const result = await service.generate(tenantId, campaignId, executionPlanId);
    expect(result.financialScope).toEqual({
      currency: 'BRL',
      maximumPlannedSpendMinor: 8400,
      calculation: '1200 x 7 days',
    });
    expect(result.autonomy).toEqual({ level: 'A0', humanApprovalRequired: true });
    expect(result.decisionBasis).toContainEqual(expect.objectContaining({
      decision: 'Limite financeiro: 8400 unidades mínimas de BRL.',
    }));
  });

  it('creates a deterministic semantic hash and atomic audit request', async () => {
    const first = await service.generate(tenantId, campaignId, executionPlanId);
    const second = await service.generate(tenantId, campaignId, executionPlanId);
    expect(second.decisionHash).toBe(first.decisionHash);
    expect(decisions.saveIdempotent).toHaveBeenCalledTimes(2);
    const [, event] = decisions.saveIdempotent.mock.calls[0];
    expect(event).toEqual(expect.objectContaining({
      eventType: 'operational_readiness_decided',
      objectType: 'operational_readiness_decision',
    }));
  });

  it('does not expose decisions across tenants', async () => {
    plans.findById.mockResolvedValueOnce(null);
    await expect(service.latest(
      '99999999-9999-4999-8999-999999999999', executionPlanId,
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(decisions.latestForPlan).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers before any repository access', async () => {
    await expect(service.generate('bad', campaignId, executionPlanId))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(plans.findById).not.toHaveBeenCalled();
    expect(simulations.simulate).not.toHaveBeenCalled();
  });
});
