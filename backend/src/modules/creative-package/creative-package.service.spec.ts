import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  CreativePackageV1,
  UnversionedCreativePackageV1,
} from '../../domain/contracts/creative-package';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  CreativePackageRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import { CreativePackageService } from './creative-package.service';

describe('CreativePackageService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';
  const sourcePlan: ExecutionPlanV1 = {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 1,
    planVersion: '1.0',
    correlationId: '44444444-4444-4444-8444-444444444444',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'draft',
    meta: { assetBindings: [], requiredCapabilities: ['CREATE_CREATIVE'] },
    objectsToCreate: [{
      internalObjectId: `${campaignId}:creative`,
      type: 'creative',
      dependsOn: [],
      logicalConfig: { copyStatus: 'requires_generation_and_approval' },
    }],
    readiness: [{
      key: 'creative_approval',
      status: 'pending',
      meaning: 'Pending',
      evidenceRefs: [],
      source: 'system',
    }],
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 1000,
      maximumPlannedSpendMinor: 7000,
      calculation: '1000 x 7 days',
    },
    decisions: [{
      decisionId: 'old-creative',
      category: 'creative_safety',
      ruleId: 'old',
      inputRefs: [],
      outcome: {},
      rationale: 'old',
    }],
    risks: [{
      code: 'creative_content_not_approved',
      severity: 'high',
      meaning: 'Pending',
      mitigation: 'Approve',
      blocksExecution: true,
    }],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T12:00:00.000Z',
  };
  const input = {
    copies: [{
      copyId: 'copy-1',
      primaryText: 'Produto premium com entrega por rota planejada.',
      headline: 'Conheça a coleção',
      description: 'Atendimento pelo WhatsApp.',
      whatsappMessage: 'Olá! Gostaria de conhecer os modelos disponíveis no atacado.',
      callToAction: 'SEND_WHATSAPP_MESSAGE',
    }],
    claims: [{
      claimId: 'claim-1',
      text: 'Entrega por rota planejada.',
      sourceRefs: ['campaign_context:offer'],
    }],
    assets: [{
      assetId: 'asset-1',
      storageRef: 'media://tenant/image-1',
      sha256: 'c'.repeat(64),
      mimeType: 'image/png',
      width: 1080,
      height: 1350,
    }],
    reviewChecklist: {
      claimsVerifiedAgainstSources: true,
      visualFidelityReviewed: true,
      safeAreaReviewed: true,
      requiredFieldsReviewed: true,
      automaticEnhancementsReviewed: true,
    },
  };
  let packages: jest.Mocked<CreativePackageRepository>;
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let approvals: jest.Mocked<ApprovalRepository>;
  let service: CreativePackageService;
  let savedPackage: CreativePackageV1 | undefined;

  beforeEach(() => {
    savedPackage = undefined;
    packages = {
      appendNext: jest.fn(async (
        value: UnversionedCreativePackageV1,
        _event: AuditEvent,
      ): Promise<CreativePackageV1 | null> => {
        savedPackage = { ...value, version: 1 };
        return savedPackage;
      }),
      latest: jest.fn(
        async (_tenant: string, _campaign: string): Promise<CreativePackageV1 | null> =>
          savedPackage ?? null,
      ),
      findVersion: jest.fn(
        async (_tenant: string, _campaign: string, _version: number):
        Promise<CreativePackageV1 | null> => savedPackage ?? null,
      ),
      approveLatest: jest.fn(async (
        _tenant: string,
        _campaign: string,
        _version: number,
        _hash: string,
        approvedBy: string,
        approvedAt: string,
        _event: AuditEvent,
      ): Promise<CreativePackageV1 | null> => savedPackage ? {
        ...savedPackage,
        status: 'approved' as const,
        approvedBy,
        approvedAt,
      } : null),
    } as unknown as jest.Mocked<CreativePackageRepository>;
    plans = {
      saveIdempotent: jest.fn(async (value) => value),
      latest: jest.fn().mockResolvedValue(sourcePlan),
      findById: jest.fn().mockResolvedValue(sourcePlan),
    };
    approvals = {
      request: jest.fn(),
      findById: jest.fn(),
      findCurrentForPlan: jest.fn(),
      approveIfCurrent: jest.fn(),
      transition: jest.fn(),
      expire: jest.fn(),
      invalidateIfStale: jest.fn(),
      invalidateForCampaignExceptHash: jest.fn().mockResolvedValue(1),
    };
    service = new CreativePackageService(packages, plans, approvals);
  });

  it('creates an immutable review version and a new blocked plan', async () => {
    const result = await service.appendVersion(
      tenantId, campaignId, executionPlanId, input, 'warison',
    );

    expect(result.creativePackage.version).toBe(1);
    expect(result.creativePackage.status).toBe('needs_review');
    expect(result.creativePackage.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.executionPlan.executionPlanId).not.toBe(executionPlanId);
    expect(result.executionPlan.planHash).not.toBe(sourcePlan.planHash);
    expect(result.executionPlan.externalEffects).toEqual({
      writesAllowed: false,
      writesPerformed: false,
    });
    expect(result.executionPlan.readiness).toContainEqual(expect.objectContaining({
      key: 'creative_approval',
      status: 'pending',
    }));
    expect(result.executionPlan.objectsToCreate[0].logicalConfig).toEqual(
      expect.objectContaining({
        copyStatus: 'requires_review',
        creativeContentHash: result.creativePackage.contentHash,
        copies: [expect.objectContaining({
          whatsappMessage: input.copies[0].whatsappMessage,
        })],
      }),
    );
    expect(approvals.invalidateForCampaignExceptHash).toHaveBeenCalledWith(
      tenantId,
      campaignId,
      result.executionPlan.planHash,
      result.executionPlan.createdAt,
    );
  });

  it('binds the exact approved content hash into a new plan', async () => {
    const draft = await service.appendVersion(
      tenantId, campaignId, executionPlanId, input, 'warison',
    );
    plans.latest.mockResolvedValueOnce(draft.executionPlan);

    const result = await service.approve(
      tenantId,
      campaignId,
      1,
      draft.creativePackage.contentHash,
      'warison',
    );

    expect(result.creativePackage.status).toBe('approved');
    expect(result.executionPlan.objectsToCreate[0].logicalConfig).toEqual(
      expect.objectContaining({
        copyStatus: 'approved',
        creativePackageVersion: 1,
        creativeContentHash: draft.creativePackage.contentHash,
      }),
    );
    expect(result.executionPlan.readiness).toContainEqual(expect.objectContaining({
      key: 'creative_approval',
      status: 'passed',
    }));
    expect(result.executionPlan.risks).not.toContainEqual(expect.objectContaining({
      code: 'creative_content_not_approved',
    }));
    expect(result.executionPlan.autonomy).toEqual({ level: 'A0', approvalRequired: true });
  });

  it('rejects approval when the submitted hash differs', async () => {
    await service.appendVersion(tenantId, campaignId, executionPlanId, input, 'warison');
    await expect(service.approve(
      tenantId, campaignId, 1, 'd'.repeat(64), 'warison',
    )).rejects.toMatchObject({ response: expect.objectContaining({
      code: 'creative_content_hash_mismatch',
    }) });
    expect(packages.approveLatest).not.toHaveBeenCalled();
  });

  it('keeps approval blocked while any review check is pending', async () => {
    const pendingInput = {
      ...input,
      reviewChecklist: { ...input.reviewChecklist, safeAreaReviewed: false },
    };
    const draft = await service.appendVersion(
      tenantId, campaignId, executionPlanId, pendingInput, 'warison',
    );
    expect(draft.creativePackage.validationIssues).toContain(
      'review_check_pending:safeAreaReviewed',
    );
    await expect(service.approve(
      tenantId, campaignId, 1, draft.creativePackage.contentHash, 'warison',
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires evidence for every declared claim', async () => {
    const invalid = {
      ...input,
      claims: [{ claimId: 'claim-1', text: 'Sem fonte', sourceRefs: [] }],
    };
    await expect(service.appendVersion(
      tenantId, campaignId, executionPlanId, invalid, 'warison',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an initial message for every WhatsApp creative', async () => {
    const invalid = {
      ...input,
      copies: [{ ...input.copies[0], whatsappMessage: undefined }],
    };
    await expect(service.appendVersion(
      tenantId, campaignId, executionPlanId, invalid, 'warison',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an immutable digest for every media asset', async () => {
    const invalid = {
      ...input,
      assets: [{ ...input.assets[0], sha256: 'not-a-digest' }],
    };
    await expect(service.appendVersion(
      tenantId, campaignId, executionPlanId, invalid, 'warison',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expands three paired variants into three paused ads', async () => {
    const completePlan: ExecutionPlanV1 = {
      ...sourcePlan,
      objectsToCreate: [{
        internalObjectId: `${campaignId}:campaign`, type: 'campaign', dependsOn: [],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      }, {
        internalObjectId: `${campaignId}:ad_set`, type: 'ad_set',
        dependsOn: [`${campaignId}:campaign`],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      }, {
        internalObjectId: `${campaignId}:creative`, type: 'creative', dependsOn: [],
        logicalConfig: { copyStatus: 'requires_generation_and_approval' },
      }, {
        internalObjectId: `${campaignId}:ad`, type: 'ad',
        dependsOn: [`${campaignId}:ad_set`, `${campaignId}:creative`],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      }],
    };
    plans.findById.mockResolvedValueOnce(completePlan);
    plans.latest.mockResolvedValueOnce(completePlan);
    const variants = {
      ...input,
      copies: [1, 2, 3].map((number) => ({
        ...input.copies[0], copyId: `copy-${number}`, headline: `Variação ${number}`,
      })),
      assets: [1, 2, 3].map((number) => ({
        ...input.assets[0], assetId: `asset-${number}`, sha256: `${number}`.repeat(64),
      })),
    };

    const result = await service.appendVersion(
      tenantId, campaignId, executionPlanId, variants, 'warison',
    );

    const creatives = result.executionPlan.objectsToCreate.filter(
      (object) => object.type === 'creative',
    );
    const ads = result.executionPlan.objectsToCreate.filter((object) => object.type === 'ad');
    expect(creatives).toHaveLength(3);
    expect(ads).toHaveLength(3);
    expect(result.executionPlan.objectsToCreate).toHaveLength(8);
    expect(ads.every((ad) => ad.logicalConfig.lifecycleStatus === 'PAUSED')).toBe(true);
    expect(ads.map((ad) => ad.dependsOn[1])).toEqual(
      creatives.map((creative) => creative.internalObjectId),
    );
  });

  it('blocks approval when copy and media variants cannot be paired exactly', async () => {
    const mismatch = { ...input, copies: [...input.copies, {
      ...input.copies[0], copyId: 'copy-2', headline: 'Variação 2',
    }] };
    const result = await service.appendVersion(
      tenantId, campaignId, executionPlanId, mismatch, 'warison',
    );
    expect(result.creativePackage.validationIssues).toContain(
      'creative_variant_pairing_mismatch',
    );
    await expect(service.approve(
      tenantId, campaignId, 1, result.creativePackage.contentHash, 'warison',
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects duplicate identifiers across copy, claim and asset records', async () => {
    const duplicate = {
      ...input,
      claims: [{ ...input.claims[0], claimId: 'copy-1' }],
    };
    const result = await service.appendVersion(
      tenantId, campaignId, executionPlanId, duplicate, 'warison',
    );
    expect(result.creativePackage.validationIssues).toContain('duplicate_item_identifier');
    await expect(service.approve(
      tenantId, campaignId, 1, result.creativePackage.contentHash, 'warison',
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale execution plan before accepting content', async () => {
    plans.latest.mockResolvedValueOnce({ ...sourcePlan, executionPlanId: randomUUID() });
    await expect(service.appendVersion(
      tenantId, campaignId, executionPlanId, input, 'warison',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(packages.appendNext).not.toHaveBeenCalled();
  });

  it('does not expose a creative package across tenants', async () => {
    packages.latest.mockResolvedValueOnce(null);
    await expect(service.latest(
      '99999999-9999-4999-8999-999999999999', campaignId,
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('produces the same content hash for identical semantic input', async () => {
    const first = await service.appendVersion(
      tenantId, campaignId, executionPlanId, input, 'warison',
    );
    plans.findById.mockResolvedValueOnce(first.executionPlan);
    plans.latest.mockResolvedValueOnce(first.executionPlan);
    packages.appendNext.mockImplementationOnce(async (value) => ({ ...value, version: 2 }));
    const second = await service.appendVersion(
      tenantId, campaignId, first.executionPlan.executionPlanId, input, 'warison',
    );
    expect(second.creativePackage.contentHash).toBe(first.creativePackage.contentHash);
  });
});
