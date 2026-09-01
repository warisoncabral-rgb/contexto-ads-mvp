import { EcosystemOrchestratorService } from './ecosystem-orchestrator.service';

const TENANT = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = 'b8f16916-cf4c-4e80-894e-dcc56fbd9564';
const PLAN = '90e39a0f-3cbc-4405-80c0-31045af22550';

function packageStatus(nextAction = 'REQUEST_EXECUTION_PLAN_APPROVAL') {
  return {
    package_id: CAMPAIGN,
    campaign_id: CAMPAIGN,
    context: { internal_package_id: 'ctx', version: 2, status: 'ready_for_generation', content_hash: 'hash' },
    creative: { creative_package_id: 'creative', version: 1, status: 'approved', content_hash: 'creative-hash' },
    execution_plan: {
      execution_plan_id: PLAN,
      plan_hash: 'plan-hash',
      status: 'draft',
      target_binding_status: 'BOUND',
      maximum_planned_spend_minor: 14000,
      currency: 'BRL',
    },
    plan_approval: null,
    next_action: nextAction,
    boundaries: {
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
      plan_approval_is_execution_authorization: false,
    },
  } as any;
}

function setup() {
  const access = {
    portfolio: jest.fn().mockResolvedValue({
      items: [{ tenantId: TENANT, campaignId: CAMPAIGN, executionPlanId: PLAN }],
    }),
    bindExecutionTarget: jest.fn(),
    requestPlanApproval: jest.fn().mockResolvedValue({ approvalId: 'approval-1', status: 'pending' }),
  } as any;
  const packages = { get: jest.fn().mockResolvedValue(packageStatus()) } as any;
  const analyst = { latest: jest.fn().mockResolvedValue({ analysis: null }) } as any;
  const presenter = { present: jest.fn() } as any;
  const tracking = { find: jest.fn().mockResolvedValue(null) } as any;
  const connections = {
    selectedExecutionTarget: jest.fn().mockResolvedValue({
      connectionId: '673dbb65-e187-4d80-8751-772d6e0156b3',
      adAccountId: 'act_929361834160386',
    }),
  } as any;
  return {
    service: new EcosystemOrchestratorService(
      access, packages, analyst, presenter, tracking, connections,
    ),
    access,
    packages,
    analyst,
    presenter,
    tracking,
    connections,
  };
}

describe('EcosystemOrchestratorService', () => {
  it('presents a tracked campaign as one simple Analyst flow', async () => {
    const { service, analyst, presenter, tracking } = setup();
    tracking.find.mockResolvedValueOnce({ campaignId: CAMPAIGN });
    analyst.latest.mockResolvedValueOnce({ analysis: { requiresApproval: false } });
    presenter.present.mockReturnValueOnce({
      situation: 'A campanha está pausada e não está gerando nova entrega.',
      simpleMessage: 'A campanha está pausada. Não há entrega nova para avaliar agora.',
      nextStep: 'Se a pausa foi intencional, mantenha como está.',
      userActionRequired: false,
      userAction: 'Nenhuma ação sua é necessária agora.',
      decision: 'OBSERVAR',
      operationalState: 'PAUSED',
    });

    const result = await service.overview('Bearer test');

    expect(result.actionStatus).toBe('OK');
    expect(result.campaigns[0]).toEqual(expect.objectContaining({
      activeModule: 'analyst',
      stage: 'MONITORING',
      progressPercent: 100,
      userActionRequired: false,
    }));
    expect(result.campaigns[0].technicalDetails).toEqual(expect.objectContaining({
      trackingRegistered: true,
      analystDecision: 'OBSERVAR',
      analystOperationalState: 'PAUSED',
    }));
    expect(result.boundaries.publicationAuthorized).toBe(false);
  });

  it('automatically prepares an internal plan approval without external execution', async () => {
    const { service, access } = setup();

    const result = await service.advanceSafe('Bearer test', CAMPAIGN);

    expect(access.requestPlanApproval).toHaveBeenCalledWith(
      'Bearer test', TENANT, CAMPAIGN, PLAN,
    );
    expect(result).toEqual(expect.objectContaining({
      actionStatus: 'SAFE_STEP_COMPLETED',
      userActionRequired: true,
    }));
    expect(result.boundaries).toEqual(expect.objectContaining({
      publicationAuthorized: false,
      activationAuthorized: false,
      externalWritesAllowed: false,
      financialActionAuthorized: false,
    }));
  });

  it('stops for real creative review instead of auto-approving visual fidelity', async () => {
    const { service, packages, access } = setup();
    packages.get.mockResolvedValueOnce({
      ...packageStatus('REVIEW_AND_APPROVE_CREATIVE_PACKAGE'),
      creative: { creative_package_id: 'creative', version: 1, status: 'needs_review' },
    });

    const result = await service.advanceSafe('Bearer test', CAMPAIGN);

    expect(result.actionStatus).toBe('USER_DECISION_REQUIRED');
    expect(result.userActionRequired).toBe(true);
    expect(access.requestPlanApproval).not.toHaveBeenCalled();
    expect(access.bindExecutionTarget).not.toHaveBeenCalled();
  });
});
