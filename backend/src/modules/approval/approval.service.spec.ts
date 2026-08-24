import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import { ApprovalService } from './approval.service';

describe('ApprovalService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';
  const approvalId = '44444444-4444-4444-8444-444444444444';
  const plan = {
    executionPlanId,
    tenantId,
    campaignId,
    campaignPackageVersion: 2,
    planVersion: '1.0',
    correlationId: '55555555-5555-4555-8555-555555555555',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'draft',
    meta: {
      assetBindings: [],
      requiredCapabilities: ['CREATE_CAMPAIGN', 'CREATE_ADSET'],
    },
    objectsToCreate: [
      { internalObjectId: 'campaign', type: 'campaign', dependsOn: [], logicalConfig: {} },
      { internalObjectId: 'ad-set', type: 'ad_set', dependsOn: ['campaign'], logicalConfig: {} },
    ],
    readiness: [],
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 5000,
      maximumPlannedSpendMinor: 35000,
      calculation: '5000 x 7 days',
    },
    decisions: [],
    risks: [{
      code: 'financial_commitment_requires_approval',
      severity: 'high',
      meaning: 'Spend',
      mitigation: 'Approve',
      blocksExecution: true,
    }],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T08:00:00.000Z',
  } as ExecutionPlanV1;
  const pendingApproval: ApprovalV1 = {
    approvalId,
    tenantId,
    executionPlanId,
    campaignId,
    planVersion: '1.0',
    approvedPlanHash: plan.planHash,
    actionType: 'approve_campaign_plan',
    riskLevel: 'high',
    scope: [`campaign:${campaignId}`, `plan_hash:${plan.planHash}`],
    requestedBy: 'warison',
    expiresAt: '2099-08-25T08:00:00.000Z',
    status: 'pending',
    correlationId: '66666666-6666-4666-8666-666666666666',
    createdAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
  };
  let plans: jest.Mocked<ExecutionPlanRepository>;
  let approvals: jest.Mocked<ApprovalRepository>;
  let service: ApprovalService;

  beforeEach(() => {
    plans = {
      saveIdempotent: jest.fn(),
      latest: jest.fn().mockResolvedValue(plan),
      findById: jest.fn().mockResolvedValue(plan),
    };
    approvals = {
      request: jest.fn(async (approval: ApprovalV1, _event: AuditEvent) => approval),
      findById: jest.fn().mockResolvedValue(pendingApproval),
      approveIfCurrent: jest.fn(),
      transition: jest.fn(),
      expire: jest.fn().mockResolvedValue(null),
      invalidateIfStale: jest.fn().mockResolvedValue(null),
    };
    service = new ApprovalService(plans, approvals);
  });

  it('requests a hash-bound, time-limited approval for the current plan', async () => {
    const result = await service.request(
      tenantId,
      campaignId,
      executionPlanId,
      ' Warison ',
    );

    expect(result).toEqual(expect.objectContaining({
      tenantId,
      campaignId,
      executionPlanId,
      approvedPlanHash: plan.planHash,
      planVersion: '1.0',
      riskLevel: 'high',
      requestedBy: 'Warison',
      status: 'pending',
      expiresAt: expect.any(String),
    }));
    expect(result.scope).toEqual(expect.arrayContaining([
      `maximum_spend_minor:35000`,
      'currency:BRL',
      'objects:campaign,ad_set',
      'external_write:false',
    ]));
    expect(approvals.request).toHaveBeenCalledWith(
      result,
      expect.objectContaining({
        eventType: 'campaign_plan_approval_requested',
        actorType: 'user',
        actorId: 'Warison',
        objectId: result.approvalId,
      }),
    );
  });

  it('refuses approval requests for an obsolete plan', async () => {
    plans.latest.mockResolvedValueOnce({ ...plan, executionPlanId: approvalId });
    await expect(service.request(tenantId, campaignId, executionPlanId, 'Warison'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it('does not disclose a plan from another tenant or campaign', async () => {
    plans.findById.mockResolvedValueOnce(null);
    await expect(service.request(tenantId, campaignId, executionPlanId, 'Warison'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('approves only after refreshing expiry and plan hash', async () => {
    const approved = {
      ...pendingApproval,
      status: 'approved' as const,
      approvedBy: 'Warison',
      approvedAt: '2026-08-24T09:00:00.000Z',
    };
    approvals.approveIfCurrent.mockResolvedValueOnce(approved);

    await expect(service.approve(tenantId, approvalId, 'Warison')).resolves.toEqual(approved);
    expect(approvals.expire).toHaveBeenCalled();
    expect(approvals.invalidateIfStale).toHaveBeenCalled();
    expect(approvals.approveIfCurrent).toHaveBeenCalledWith(
      tenantId,
      approvalId,
      'Warison',
      expect.any(String),
      expect.objectContaining({ eventType: 'campaign_plan_approved' }),
    );
  });

  it('invalidates instead of approving if the plan changes concurrently', async () => {
    approvals.approveIfCurrent.mockResolvedValueOnce(null);
    approvals.invalidateIfStale
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...pendingApproval,
        status: 'invalidated',
        decisionReason: 'plan_hash_changed',
      });

    await expect(service.approve(tenantId, approvalId, 'Warison')).rejects
      .toBeInstanceOf(ConflictException);
  });

  it('returns an automatically expired approval and writes no user decision', async () => {
    const expired = {
      ...pendingApproval,
      status: 'expired' as const,
      decisionReason: 'approval_expired',
    };
    approvals.expire.mockResolvedValueOnce(expired);
    await expect(service.get(tenantId, approvalId)).resolves.toEqual(expired);
    expect(approvals.invalidateIfStale).not.toHaveBeenCalled();
  });

  it('rejects a pending plan with a required reason', async () => {
    const rejected = {
      ...pendingApproval,
      status: 'rejected' as const,
      decisionReason: 'Orçamento precisa ser revisto',
    };
    approvals.transition.mockResolvedValueOnce(rejected);

    await expect(service.reject(
      tenantId,
      approvalId,
      'Warison',
      ' Orçamento precisa ser revisto ',
    )).resolves.toEqual(rejected);
    expect(approvals.transition).toHaveBeenCalledWith(
      tenantId,
      approvalId,
      ['pending'],
      'rejected',
      expect.any(String),
      'Orçamento precisa ser revisto',
      expect.objectContaining({ eventType: 'campaign_plan_rejected' }),
    );
  });

  it('revokes only an approved plan authorization', async () => {
    approvals.findById.mockResolvedValueOnce({
      ...pendingApproval,
      status: 'approved',
      approvedBy: 'Warison',
    });
    const revoked = {
      ...pendingApproval,
      status: 'revoked' as const,
      decisionReason: 'Campanha suspensa pelo responsável',
    };
    approvals.transition.mockResolvedValueOnce(revoked);

    await expect(service.revoke(
      tenantId,
      approvalId,
      'Warison',
      'Campanha suspensa pelo responsável',
    )).resolves.toEqual(revoked);
  });

  it('rejects malformed identities and reasons before persistence', async () => {
    await expect(service.request(tenantId, campaignId, executionPlanId, 'x'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reject(tenantId, approvalId, 'Warison', 'no'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
