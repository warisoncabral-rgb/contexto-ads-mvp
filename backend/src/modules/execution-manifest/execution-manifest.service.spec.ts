import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { ExecutionSimulationReportV1 } from '../../domain/contracts/execution-simulation';
import { OperationalReadinessDecisionV1 } from '../../domain/contracts/operational-readiness';
import {
  ExecutionManifestRepository,
  ExecutionPlanRepository,
  ExecutionSimulationRepository,
} from '../../domain/ports/repositories';
import { OperationalReadinessService } from '../operational-readiness/operational-readiness.service';
import { ExecutionManifestService } from './execution-manifest.service';

describe('ExecutionManifestService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';
  const simulationId = '44444444-4444-4444-8444-444444444444';
  const readinessDecisionId = '55555555-5555-4555-8555-555555555555';
  const approvalId = '66666666-6666-4666-8666-666666666666';
  const campaignObjectId = '77777777-7777-4777-8777-777777777777';
  const adSetObjectId = '88888888-8888-4888-8888-888888888888';
  const plan: ExecutionPlanV1 = {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 3,
    planVersion: '1.0',
    correlationId: '99999999-9999-4999-8999-999999999999',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'approved',
    meta: { assetBindings: [], requiredCapabilities: [] },
    objectsToCreate: [
      {
        internalObjectId: campaignObjectId,
        type: 'campaign',
        dependsOn: [],
        logicalConfig: { objective: 'OUTCOME_TRAFFIC' },
      },
      {
        internalObjectId: adSetObjectId,
        type: 'ad_set',
        dependsOn: [campaignObjectId],
        logicalConfig: { dailyBudgetMinor: 1200 },
      },
    ],
    readiness: [],
    autonomy: { level: 'A0', approvalRequired: true, approvalId },
    financials: {
      currency: 'BRL', budgetMode: 'daily', configuredAmountMinor: 1200,
      maximumPlannedSpendMinor: 8400, calculation: '1200 x 7 days',
    },
    decisions: [],
    risks: [],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T12:00:00.000Z',
  };
  const simulation: ExecutionSimulationReportV1 = {
    simulationId,
    tenantId,
    campaignId,
    executionPlanId,
    planHash: plan.planHash,
    approvalId,
    status: 'ready_for_execution',
    checks: [],
    operations: [
      {
        order: 2, internalObjectId: adSetObjectId, objectType: 'ad_set',
        action: 'create_ad_set', dependsOn: [campaignObjectId],
        intendedLifecycleStatus: 'PAUSED', willExecute: false,
      },
      {
        order: 1, internalObjectId: campaignObjectId, objectType: 'campaign',
        action: 'create_campaign', dependsOn: [],
        intendedLifecycleStatus: 'PAUSED', willExecute: false,
      },
    ],
    blockers: [],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    generatedAt: '2026-08-24T12:30:00.000Z',
  };
  const decision: OperationalReadinessDecisionV1 = {
    readinessDecisionId,
    tenantId,
    campaignId,
    executionPlanId,
    planHash: plan.planHash,
    simulationId,
    decisionHash: 'c'.repeat(64),
    status: 'ready_for_executor_validation',
    headline: 'Pronto internamente',
    plainLanguageSummary: 'Não está publicado.',
    decisionBasis: [], blockers: [], nextAction: 'Validar executor real.',
    progress: {
      campaignPreparation: 'complete', metaEnvironmentValidation: 'complete',
      creativeApproval: 'complete', humanPlanApproval: 'complete',
      executorValidation: 'pending', publication: 'not_started',
      activation: 'not_started', delivery: 'not_started',
    },
    financialScope: {
      currency: 'BRL', maximumPlannedSpendMinor: 8400,
      calculation: '1200 x 7 days',
    },
    autonomy: { level: 'A0', humanApprovalRequired: true },
    boundaries: {
      campaignPublished: false, campaignActive: false,
      campaignDelivering: false, externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    generatedAt: '2026-08-24T12:31:00.000Z',
  };
  let readiness: jest.Mocked<OperationalReadinessService>;
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let simulations: jest.Mocked<ExecutionSimulationRepository>;
  let manifests: jest.Mocked<ExecutionManifestRepository>;
  let service: ExecutionManifestService;

  beforeEach(() => {
    readiness = {
      generate: jest.fn().mockResolvedValue(decision),
    } as unknown as jest.Mocked<OperationalReadinessService>;
    plans = {
      saveIdempotent: jest.fn(),
      latest: jest.fn().mockResolvedValue(plan),
      findById: jest.fn().mockResolvedValue(plan),
    };
    simulations = {
      save: jest.fn(),
      findById: jest.fn().mockResolvedValue(simulation),
      latestForPlan: jest.fn(),
    };
    manifests = {
      saveIdempotent: jest.fn(async (
        manifest: ExecutionManifestV1,
        _event: AuditEvent,
      ) => manifest),
      latestForPlan: jest.fn().mockResolvedValue(null),
    };
    service = new ExecutionManifestService(
      readiness, plans, simulations, manifests,
    );
  });

  it('prepares deterministic paused operations while keeping execution impossible', async () => {
    const result = await service.prepare(
      tenantId, campaignId, executionPlanId, approvalId,
    );

    expect(result.status).toBe('prepared_gate_closed');
    expect(result.executionGate).toEqual(expect.objectContaining({
      status: 'closed', reason: 'write_path_not_validated_or_enabled',
    }));
    expect(result.executionGate.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'specific_execution_approval', status: 'missing' }),
      expect.objectContaining({ key: 'real_meta_write_validation', status: 'missing' }),
      expect.objectContaining({ key: 'write_adapter_enabled', status: 'missing' }),
    ]));
    expect(result.boundaries).toEqual({
      executable: false, campaignPublished: false, campaignActive: false,
      campaignDelivering: false, externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
    expect(result.operations.map((operation) => operation.order)).toEqual([1, 2]);
    expect(result.operations.every((operation) =>
      operation.intendedLifecycleStatus === 'PAUSED'
      && operation.effectState === 'not_started'
      && operation.executionAllowed === false)).toBe(true);
    expect(result.operations[1].dependsOnOperationKeys).toEqual([
      result.operations[0].operationKey,
    ]);
  });

  it('defines fail-closed reconciliation and compensation for every future effect', async () => {
    const result = await service.prepare(tenantId, campaignId, executionPlanId);
    expect(result.reconciliationPolicy).toEqual({
      sourceOfTruth: 'meta_observed_state_with_internal_execution_record',
      unknownOutcome: 'stop_and_reconcile',
      retry: 'forbidden_until_previous_outcome_is_known',
      successEvidenceRequired: ['external_object_id', 'meta_response', 'observed_state'],
      automaticCorrection: 'only_when_safe_and_explicitly_authorized',
    });
    expect(result.operations.every((operation) =>
      operation.recovery.ambiguousOutcome === 'block_and_reconcile_before_retry'
      && operation.recovery.partialFailure === 'stop_dependents_and_preserve_evidence'
      && operation.recovery.compensation
        === 'manual_policy_required_before_any_external_change')).toBe(true);
  });

  it('produces stable operation and manifest hashes for the same evidence', async () => {
    const first = await service.prepare(tenantId, campaignId, executionPlanId);
    const second = await service.prepare(tenantId, campaignId, executionPlanId);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(second.operations.map(({ operationKey, idempotencyKey, requestFingerprint }) => ({
      operationKey, idempotencyKey, requestFingerprint,
    }))).toEqual(first.operations.map(({
      operationKey, idempotencyKey, requestFingerprint,
    }) => ({ operationKey, idempotencyKey, requestFingerprint })));
    const [, event] = manifests.saveIdempotent.mock.calls[0];
    expect(event).toEqual(expect.objectContaining({
      correlationId: plan.correlationId,
      eventType: 'execution_manifest_prepared',
    }));
  });

  it('blocks preparation when operational readiness is not ready', async () => {
    readiness.generate.mockResolvedValueOnce({
      ...decision, status: 'action_required', nextAction: 'Aprovar o plano.',
    });
    await expect(service.prepare(tenantId, campaignId, executionPlanId))
      .rejects.toBeInstanceOf(ConflictException);
    expect(simulations.findById).not.toHaveBeenCalled();
    expect(manifests.saveIdempotent).not.toHaveBeenCalled();
  });

  it('blocks stale plans and stale or missing simulation evidence', async () => {
    plans.latest.mockResolvedValueOnce({ ...plan, executionPlanId: readinessDecisionId });
    await expect(service.prepare(tenantId, campaignId, executionPlanId))
      .rejects.toBeInstanceOf(ConflictException);
    expect(readiness.generate).not.toHaveBeenCalled();

    plans.latest.mockResolvedValueOnce(plan);
    simulations.findById.mockResolvedValueOnce(null);
    await expect(service.prepare(tenantId, campaignId, executionPlanId))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose manifests across tenants and rejects malformed IDs', async () => {
    plans.findById.mockResolvedValueOnce(null);
    await expect(service.latest(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', executionPlanId,
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(manifests.latestForPlan).not.toHaveBeenCalled();

    await expect(service.prepare('bad', campaignId, executionPlanId))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
