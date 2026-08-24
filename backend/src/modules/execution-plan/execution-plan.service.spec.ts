import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CampaignContextPackageV1 } from '../../domain/contracts/campaign-context';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  CampaignContextRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import { ExecutionPlanService } from './execution-plan.service';

describe('ExecutionPlanService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const recordedAt = '2026-08-24T06:00:00.000Z';
  const sourced = <T>(value: T) => ({
    value,
    source: 'user_input' as const,
    evidenceRefs: ['api:user_input'],
    recordedAt,
  });
  const readyContext: CampaignContextPackageV1 = {
    packageId: '33333333-3333-4333-8333-333333333333',
    tenantId,
    campaignId,
    version: 3,
    schemaVersion: '1.0',
    status: 'ready_for_generation',
    facts: {
      businessName: sourced('Contexto Ads'),
      offer: sourced('Gestão profissional de anúncios'),
      objective: sourced('leads'),
      audience: sourced('Empresas que precisam gerar demanda'),
      destination: sourced('whatsapp'),
      geography: sourced('Brasil'),
      budget: sourced({ mode: 'daily', amountMinor: 5000, currency: 'BRL' }),
      durationDays: sourced(7),
    },
    inferences: [],
    validationIssues: [],
    contentHash: 'a'.repeat(64),
    createdAt: recordedAt,
  };
  let contexts: jest.Mocked<CampaignContextRepository>;
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let service: ExecutionPlanService;

  beforeEach(() => {
    contexts = {
      create: jest.fn(),
      appendNext: jest.fn(),
      latest: jest.fn().mockResolvedValue(readyContext),
      findVersion: jest.fn().mockResolvedValue(readyContext),
    };
    plans = {
      saveIdempotent: jest.fn(async (plan: ExecutionPlanV1) => plan),
      latest: jest.fn(),
      findById: jest.fn(),
    };
    service = new ExecutionPlanService(contexts, plans);
  });

  it('generates a transparent draft without allowing external writes', async () => {
    const result = await service.generate(tenantId, campaignId);

    expect(result).toEqual(expect.objectContaining({
      tenantId,
      campaignId,
      campaignPackageVersion: 3,
      planVersion: '1.0',
      status: 'draft',
      planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      externalEffects: { writesAllowed: false, writesPerformed: false },
      autonomy: { level: 'A0', approvalRequired: true },
    }));
    expect(result.objectsToCreate).toHaveLength(4);
    expect(result.objectsToCreate.every(
      (object) => object.logicalConfig.lifecycleStatus === 'PAUSED'
        || object.type === 'creative',
    )).toBe(true);
    expect(plans.saveIdempotent).toHaveBeenCalledWith(result);
  });

  it('attaches operator audit evidence to authenticated generation', async () => {
    const result = await service.generate(tenantId, campaignId, 3, 'operator:warison');

    expect(plans.saveIdempotent).toHaveBeenCalledWith(result, expect.objectContaining({
      tenantId,
      actorId: 'operator:warison',
      eventType: 'operator_execution_plan_generated',
      newState: expect.objectContaining({
        contextVersion: 3,
        planHash: result.planHash,
        humanApprovalRequired: true,
        externalWritesAllowed: false,
      }),
    }));
  });

  it('maps only explicit facts and records every system decision', async () => {
    const result = await service.generate(tenantId, campaignId);

    expect(result.decisions).toHaveLength(6);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      decisionId: 'objective_mapping',
      ruleId: 'meta_objective_mapping_v1',
      outcome: { metaObjective: 'OUTCOME_LEADS' },
    }));
    expect(result.decisions).toContainEqual(expect.objectContaining({
      decisionId: 'audience_scope',
      outcome: {
        audienceDescription: 'Empresas que precisam gerar demanda',
        geography: 'Brasil',
      },
    }));
    const creative = result.objectsToCreate.find((object) => object.type === 'creative');
    expect(creative?.logicalConfig).toEqual(expect.objectContaining({
      copyStatus: 'requires_generation_and_approval',
      claimsPolicy: 'source_only',
    }));
  });

  it('calculates the maximum daily spend and exposes the formula', async () => {
    const result = await service.generate(tenantId, campaignId);
    expect(result.financials).toEqual({
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 5000,
      maximumPlannedSpendMinor: 35000,
      calculation: '5000 x 7 days',
    });
  });

  it('does not multiply a lifetime budget by campaign duration', async () => {
    contexts.latest.mockResolvedValueOnce({
      ...readyContext,
      facts: {
        ...readyContext.facts,
        budget: sourced({ mode: 'lifetime', amountMinor: 25000, currency: 'BRL' }),
      },
    });
    const result = await service.generate(tenantId, campaignId);
    expect(result.financials.maximumPlannedSpendMinor).toBe(25000);
    expect(result.financials.calculation).toBe('25000 lifetime total');
  });

  it('requires WhatsApp capability only for a WhatsApp destination', async () => {
    const whatsApp = await service.generate(tenantId, campaignId);
    expect(whatsApp.meta.requiredCapabilities).toContain('CLICK_TO_WHATSAPP');

    contexts.latest.mockResolvedValueOnce({
      ...readyContext,
      facts: { ...readyContext.facts, destination: sourced('website') },
    });
    const website = await service.generate(tenantId, campaignId);
    expect(website.meta.requiredCapabilities).not.toContain('CLICK_TO_WHATSAPP');
  });

  it('produces stable hashes and idempotency keys for the same context', async () => {
    const first = await service.generate(tenantId, campaignId);
    const second = await service.generate(tenantId, campaignId);

    expect(first.planHash).toBe(second.planHash);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.executionPlanId).not.toBe(second.executionPlanId);
  });

  it('pins generation to an explicitly requested context version', async () => {
    await service.generate(tenantId, campaignId, 3);
    expect(contexts.findVersion).toHaveBeenCalledWith(tenantId, campaignId, 3);
    expect(contexts.latest).not.toHaveBeenCalled();
  });

  it('rejects malformed context versions before storage', async () => {
    await expect(service.generate(tenantId, campaignId, 0)).rejects
      .toBeInstanceOf(BadRequestException);
    expect(plans.saveIdempotent).not.toHaveBeenCalled();
  });

  it('blocks incomplete context and returns its actionable evidence', async () => {
    contexts.latest.mockResolvedValueOnce({
      ...readyContext,
      status: 'needs_information',
      facts: {},
      validationIssues: [{
        code: 'required_fact_missing',
        field: 'offer',
        severity: 'blocker',
        message: 'Missing offer',
        nextAction: 'Provide offer',
      }],
    });

    await expect(service.generate(tenantId, campaignId)).rejects
      .toBeInstanceOf(ConflictException);
    expect(plans.saveIdempotent).not.toHaveBeenCalled();
  });

  it('fails closed if a context claims readiness but a fact is absent', async () => {
    contexts.latest.mockResolvedValueOnce({
      ...readyContext,
      facts: { ...readyContext.facts, budget: undefined },
    });
    await expect(service.generate(tenantId, campaignId)).rejects
      .toBeInstanceOf(ConflictException);
  });

  it('does not disclose plans across tenant scope', async () => {
    plans.latest.mockResolvedValueOnce(null);
    await expect(service.latest(tenantId, campaignId)).rejects
      .toBeInstanceOf(NotFoundException);
    expect(plans.latest).toHaveBeenCalledWith(tenantId, campaignId);
  });
});
