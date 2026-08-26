import { CampaignPackageStatusService } from './campaign-package-status.service';

const tenantId = '22222222-2222-4222-8222-222222222222';
const packageId = '11111111-1111-4111-8111-111111111111';

function build(overrides?: {
  creativeStatus?: 'needs_review' | 'approved';
  targetBound?: boolean;
  approvalStatus?: 'pending' | 'approved' | null;
}) {
  const context = {
    packageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version: 1,
    status: 'ready_for_generation',
    contentHash: 'a'.repeat(64),
  };
  const creative = {
    creativePackageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    version: 1,
    status: overrides?.creativeStatus ?? 'needs_review',
    contentHash: 'b'.repeat(64),
  };
  const plan = {
    executionPlanId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    planHash: 'c'.repeat(64),
    status: 'draft',
    meta: overrides?.targetBound
      ? { connectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', adAccountId: 'act_1' }
      : {},
    financials: { maximumPlannedSpendMinor: 7000, currency: 'BRL' },
    externalEffects: { writesAllowed: false, writesPerformed: false },
  };
  const approval = overrides?.approvalStatus ? {
    approvalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    status: overrides.approvalStatus,
    approvedPlanHash: plan.planHash,
    expiresAt: '2026-08-27T21:00:00.000Z',
  } : null;
  const service = new CampaignPackageStatusService(
    { latest: jest.fn(async () => context) } as any,
    { latest: jest.fn(async () => plan) } as any,
    { latest: jest.fn(async () => creative) } as any,
    { findCurrentForPlan: jest.fn(async () => approval) } as any,
  );
  return { service };
}

describe('CampaignPackageStatusService', () => {
  it('returns a conversationally reusable status without raw technical logs', async () => {
    const { service } = build();
    const result = await service.get(tenantId, packageId);

    expect(result.package_id).toBe(packageId);
    expect(result.creative?.status).toBe('needs_review');
    expect(result.execution_plan.target_binding_status).toBe('PENDING_RESOLUTION');
    expect(result.next_action).toBe('REVIEW_AND_APPROVE_CREATIVE_PACKAGE');
    expect(result.boundaries).toEqual({
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
      plan_approval_is_execution_authorization: false,
    });
  });

  it('asks to request plan approval after creative approval and target binding', async () => {
    const { service } = build({ creativeStatus: 'approved', targetBound: true });
    const result = await service.get(tenantId, packageId);

    expect(result.next_action).toBe('REQUEST_EXECUTION_PLAN_APPROVAL');
    expect(result.execution_plan.target_binding_status).toBe('BOUND');
    expect(result.plan_approval).toBeNull();
  });

  it('surfaces a pending exact-plan approval for a human decision', async () => {
    const { service } = build({
      creativeStatus: 'approved',
      targetBound: true,
      approvalStatus: 'pending',
    });
    const result = await service.get(tenantId, packageId);

    expect(result.next_action).toBe('DECIDE_EXECUTION_PLAN_APPROVAL');
    expect(result.plan_approval?.status).toBe('pending');
  });

  it('stops the V1 Action at the separate execution gate after plan approval', async () => {
    const { service } = build({
      creativeStatus: 'approved',
      targetBound: true,
      approvalStatus: 'approved',
    });
    const result = await service.get(tenantId, packageId);

    expect(result.next_action).toBe('EXECUTION_GATE_SEPARATE');
    expect(result.plan_approval?.status).toBe('approved');
    expect(result.boundaries.plan_approval_is_execution_authorization).toBe(false);
  });
});
