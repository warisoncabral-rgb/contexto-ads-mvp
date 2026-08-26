import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { ExecutionSimulationReportV1 } from '../../domain/contracts/execution-simulation';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  CreativePackageRepository,
  ExecutionPlanRepository,
  ExecutionSimulationRepository,
} from '../../domain/ports/repositories';
import { ApprovalService } from '../approval/approval.service';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { ExecutionSimulationService } from './execution-simulation.service';

describe('ExecutionSimulationService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';
  const connectionId = '44444444-4444-4444-8444-444444444444';
  const approvalId = '55555555-5555-4555-8555-555555555555';
  const adAccountId = 'act_123';
  const plan = {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 1,
    planVersion: '1.0',
    correlationId: '66666666-6666-4666-8666-666666666666',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'draft',
    meta: {
      assetBindings: [],
      requiredCapabilities: ['CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_CREATIVE', 'CREATE_AD'],
    },
    objectsToCreate: [
      {
        internalObjectId: `${campaignId}:campaign`,
        type: 'campaign',
        dependsOn: [],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      },
      {
        internalObjectId: `${campaignId}:ad_set`,
        type: 'ad_set',
        dependsOn: [`${campaignId}:campaign`],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      },
      {
        internalObjectId: `${campaignId}:creative`,
        type: 'creative',
        dependsOn: [],
        logicalConfig: { copyStatus: 'requires_generation_and_approval' },
      },
      {
        internalObjectId: `${campaignId}:ad`,
        type: 'ad',
        dependsOn: [`${campaignId}:ad_set`, `${campaignId}:creative`],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      },
    ],
    readiness: [
      {
        key: 'campaign_context',
        status: 'passed',
        meaning: 'Ready',
        evidenceRefs: ['context:1'],
        source: 'campaign_package',
      },
      {
        key: 'meta_execution_target',
        status: 'pending',
        meaning: 'Missing',
        evidenceRefs: [],
        source: 'system',
      },
      {
        key: 'meta_write_capabilities',
        status: 'pending',
        meaning: 'Missing',
        evidenceRefs: [],
        source: 'system',
      },
      {
        key: 'creative_approval',
        status: 'pending',
        meaning: 'Missing',
        evidenceRefs: [],
        source: 'system',
      },
    ],
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 5000,
      maximumPlannedSpendMinor: 35000,
      calculation: '5000 x 7 days',
    },
    decisions: [],
    risks: [
      {
        code: 'meta_target_not_selected',
        severity: 'high',
        meaning: 'Target missing',
        mitigation: 'Bind target',
        blocksExecution: true,
      },
      {
        code: 'write_capabilities_not_validated',
        severity: 'high',
        meaning: 'Capabilities missing',
        mitigation: 'Validate',
        blocksExecution: true,
      },
    ],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T12:00:00.000Z',
  } as ExecutionPlanV1;
  const boundPlan: ExecutionPlanV1 = {
    ...plan,
    meta: {
      ...plan.meta,
      connectionId,
      adAccountId,
      assetBindings: [`ad_account:${adAccountId}`],
    },
  };
  const approved: ApprovalV1 = {
    approvalId,
    tenantId,
    executionPlanId,
    campaignId,
    planVersion: '1.0',
    approvedPlanHash: boundPlan.planHash,
    actionType: 'approve_campaign_plan',
    riskLevel: 'high',
    scope: [
      'maximum_spend_minor:35000',
      'currency:BRL',
      'external_write:false',
    ],
    requestedBy: 'warison',
    approvedBy: 'warison',
    approvedAt: '2026-08-24T12:30:00.000Z',
    expiresAt: '2099-08-25T12:00:00.000Z',
    status: 'approved',
    correlationId: '77777777-7777-4777-8777-777777777777',
    createdAt: '2026-08-24T12:00:00.000Z',
    updatedAt: '2026-08-24T12:30:00.000Z',
  };
  let connections: jest.Mocked<MetaConnectionService>;
  let capabilities: jest.Mocked<CapabilityRegistryService>;
  let approvalService: jest.Mocked<ApprovalService>;
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let approvals: jest.Mocked<ApprovalRepository>;
  let simulations: jest.Mocked<ExecutionSimulationRepository>;
  let creativePackages: jest.Mocked<CreativePackageRepository>;
  let service: ExecutionSimulationService;

  beforeEach(() => {
    connections = {
      getConnection: jest.fn().mockResolvedValue({
        tenantId,
        connectionId,
        provider: 'meta',
        status: 'connected',
        credentialRef: 'postgres-vault://secret-ref',
        createdAt: '2026-08-24T10:00:00.000Z',
        updatedAt: '2026-08-24T10:00:00.000Z',
      }),
      listAssets: jest.fn().mockResolvedValue([{
        tenantId,
        connectionId,
        assetType: 'ad_account',
        externalId: adAccountId,
        displayName: 'Main account',
        selected: false,
        observedAt: '2026-08-24T11:00:00.000Z',
      }]),
    } as unknown as jest.Mocked<MetaConnectionService>;
    capabilities = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CapabilityRegistryService>;
    approvalService = {
      get: jest.fn().mockResolvedValue(approved),
    } as unknown as jest.Mocked<ApprovalService>;
    plans = {
      saveIdempotent: jest.fn(async (value: ExecutionPlanV1) => value),
      latest: jest.fn().mockResolvedValue(plan),
      findById: jest.fn().mockResolvedValue(plan),
    };
    approvals = {
      request: jest.fn(),
      findById: jest.fn(),
      approveIfCurrent: jest.fn(),
      transition: jest.fn(),
      expire: jest.fn(),
      invalidateIfStale: jest.fn(),
      invalidateForCampaignExceptHash: jest.fn().mockResolvedValue(0),
    };
    simulations = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      latestForPlan: jest.fn(),
    };
    creativePackages = {
      appendNext: jest.fn(),
      latest: jest.fn().mockResolvedValue(null),
      findVersion: jest.fn(),
      approveLatest: jest.fn(),
    };
    service = new ExecutionSimulationService(
      connections,
      capabilities,
      approvalService,
      plans,
      approvals,
      simulations,
      creativePackages,
    );
  });

  it('binds only a discovered tenant account and creates a new immutable plan', async () => {
    const result = await service.bindTarget(
      tenantId,
      campaignId,
      executionPlanId,
      connectionId,
      adAccountId,
    );

    expect(result.executionPlanId).not.toBe(executionPlanId);
    expect(result.planHash).not.toBe(plan.planHash);
    expect(result.meta).toEqual(expect.objectContaining({
      connectionId,
      adAccountId,
      assetBindings: [`ad_account:${adAccountId}`],
    }));
    expect(result.risks).not.toContainEqual(expect.objectContaining({
      code: 'meta_target_not_selected',
    }));
    expect(result.readiness).toContainEqual(expect.objectContaining({
      key: 'meta_execution_target',
      status: 'passed',
    }));
    expect(result.decisions).toContainEqual(expect.objectContaining({
      category: 'execution_target',
      ruleId: 'discovered_tenant_asset_only_v1',
    }));
    expect(result.externalEffects).toEqual({ writesAllowed: false, writesPerformed: false });
    expect(JSON.stringify(result)).not.toContain('secret-ref');
    expect(approvals.invalidateForCampaignExceptHash).toHaveBeenCalledWith(
      tenantId,
      campaignId,
      result.planHash,
      result.createdAt,
    );
  });

  it('rejects an arbitrary ad account absent from discovery', async () => {
    await expect(service.bindTarget(
      tenantId,
      campaignId,
      executionPlanId,
      connectionId,
      'act_999',
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(plans.saveIdempotent).not.toHaveBeenCalled();
  });

  it('rejects target binding on an obsolete plan', async () => {
    plans.latest.mockResolvedValueOnce({ ...plan, executionPlanId: approvalId });
    await expect(service.bindTarget(
      tenantId,
      campaignId,
      executionPlanId,
      connectionId,
      adAccountId,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(connections.getConnection).not.toHaveBeenCalled();
  });

  it('returns an already-bound current plan idempotently', async () => {
    plans.findById.mockResolvedValueOnce(boundPlan);
    plans.latest.mockResolvedValueOnce(boundPlan);
    await expect(service.bindTarget(
      tenantId,
      campaignId,
      executionPlanId,
      connectionId,
      adAccountId,
    )).resolves.toEqual(boundPlan);
    expect(plans.saveIdempotent).not.toHaveBeenCalled();
  });

  it('persists a blocked dry-run with exact dependency order and no writes', async () => {
    const result = await service.simulate(tenantId, campaignId, executionPlanId);

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'meta_connection',
      'ad_account_binding',
      'write_capabilities',
      'plan_approval',
      'creative_approval',
    ]));
    expect(result.operations.map((operation) => operation.objectType)).toEqual([
      'campaign', 'creative', 'ad_set', 'ad',
    ]);
    expect(result.operations.every((operation) => !operation.willExecute)).toBe(true);
    expect(result.externalEffects).toEqual({ writesAllowed: false, writesPerformed: false });
    expect(simulations.save).toHaveBeenCalledWith(result);
    expect(connections.getConnection).not.toHaveBeenCalled();
  });

  it('explains when the current token lacks ads_management without changing permissions', async () => {
    plans.findById.mockResolvedValueOnce(boundPlan);
    plans.latest.mockResolvedValueOnce(boundPlan);
    capabilities.list.mockResolvedValueOnce(
      boundPlan.meta.requiredCapabilities.map((capabilityType, index): CapabilityRecord => ({
        capabilityId: `88888888-8888-4888-8888-88888888888${index}`,
        tenantId,
        connectionId,
        capabilityType,
        assetScope: adAccountId,
        requiredPermissions: ['ads_management'],
        grantedPermissions: [],
        status: 'permission_missing',
        validationSource: 'meta_api',
        restrictions: ['missing_permission:ads_management'],
        validatedAt: '2026-08-24T12:00:00.000Z',
      })),
    );

    const result = await service.simulate(
      tenantId,
      campaignId,
      boundPlan.executionPlanId,
      approvalId,
    );
    const check = result.checks.find((value) => value.key === 'write_capabilities');

    expect(check).toEqual(expect.objectContaining({
      status: 'blocked',
      nextAction: expect.stringContaining('não concedeu ads_management'),
      evidenceRefs: expect.arrayContaining([
        'capability:88888888-8888-4888-8888-888888888880',
      ]),
    }));
    expect(result.externalEffects).toEqual({ writesAllowed: false, writesPerformed: false });
  });

  it('becomes ready only when target, capabilities, approval and creative all pass', async () => {
    const creativePackageId = '99999999-9999-4999-8999-999999999999';
    const creativeContentHash = 'c'.repeat(64);
    const readyPlan: ExecutionPlanV1 = {
      ...boundPlan,
      objectsToCreate: boundPlan.objectsToCreate.map((object) => object.type === 'creative'
        ? { ...object, logicalConfig: {
          ...object.logicalConfig,
          copyStatus: 'approved',
          creativePackageId,
          creativePackageVersion: 1,
          creativeContentHash,
        } }
        : object),
    };
    creativePackages.latest.mockResolvedValueOnce({
      creativePackageId,
      tenantId,
      campaignId,
      sourceExecutionPlanId: executionPlanId,
      sourcePlanHash: readyPlan.planHash,
      version: 1,
      schemaVersion: '1.0',
      status: 'approved',
      copies: [],
      claims: [],
      assets: [],
      reviewChecklist: {
        claimsVerifiedAgainstSources: true,
        visualFidelityReviewed: true,
        safeAreaReviewed: true,
        requiredFieldsReviewed: true,
        automaticEnhancementsReviewed: true,
      },
      validationIssues: [],
      contentHash: creativeContentHash,
      approvedBy: 'warison',
      approvedAt: '2026-08-24T12:00:00.000Z',
      createdAt: '2026-08-24T11:00:00.000Z',
    });
    plans.findById.mockResolvedValueOnce(readyPlan);
    plans.latest.mockResolvedValueOnce(readyPlan);
    approvalService.get.mockResolvedValueOnce({
      ...approved,
      executionPlanId: readyPlan.executionPlanId,
      approvedPlanHash: readyPlan.planHash,
    });
    capabilities.list.mockResolvedValueOnce(
      readyPlan.meta.requiredCapabilities.map((capabilityType, index): CapabilityRecord => ({
        capabilityId: `88888888-8888-4888-8888-88888888888${index}`,
        tenantId,
        connectionId,
        capabilityType,
        assetScope: adAccountId,
        requiredPermissions: ['ads_management'],
        grantedPermissions: ['ads_management'],
        status: 'available',
        validationSource: 'meta_api',
        restrictions: [],
        validatedAt: '2026-08-24T12:00:00.000Z',
      })),
    );

    const result = await service.simulate(
      tenantId,
      campaignId,
      readyPlan.executionPlanId,
      approvalId,
    );

    expect(result.status).toBe('ready_for_execution');
    expect(result.blockers).toEqual([]);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(result.operations.every((operation) => operation.willExecute === false)).toBe(true);
  });

  it('blocks malformed dependency graphs instead of guessing an order', async () => {
    const invalid = {
      ...plan,
      objectsToCreate: [{
        ...plan.objectsToCreate[0],
        dependsOn: ['missing-object'],
      }],
    };
    plans.findById.mockResolvedValueOnce(invalid);
    plans.latest.mockResolvedValueOnce(invalid);
    const result = await service.simulate(tenantId, campaignId, executionPlanId);
    expect(result.blockers).toContain('dependency_graph');
    expect(result.operations).toEqual([]);
  });

  it('loads the latest persisted simulation only after tenant plan validation', async () => {
    const report = {
      simulationId: approvalId,
      tenantId,
      campaignId,
      executionPlanId,
      planHash: plan.planHash,
      status: 'blocked',
      checks: [],
      operations: [],
      blockers: [],
      externalEffects: { writesAllowed: false, writesPerformed: false },
      generatedAt: '2026-08-24T13:00:00.000Z',
    } as ExecutionSimulationReportV1;
    simulations.latestForPlan.mockResolvedValueOnce(report);
    await expect(service.latestSimulation(tenantId, executionPlanId)).resolves.toEqual(report);
  });

  it('rejects malformed identifiers before any repository access', async () => {
    await expect(service.simulate(tenantId, campaignId, 'plan-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(plans.findById).not.toHaveBeenCalled();
  });
});
