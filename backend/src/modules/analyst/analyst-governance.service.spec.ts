import { AnalystAnalysisV1 } from '../../domain/contracts/analyst';
import { AnalystGovernanceService } from './analyst-governance.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '849547ce-645e-4c7b-a844-451182253fe6';

function analysis(overrides: Partial<AnalystAnalysisV1> = {}): AnalystAnalysisV1 {
  return {
    analysisId: '11111111-1111-4111-8111-111111111111',
    tenantId: TENANT_ID,
    campaignId: CAMPAIGN_ID,
    snapshotId: '33333333-3333-4333-8333-333333333333',
    previousSnapshotId: null,
    observation: 'Há evidência suficiente para uma recomendação.',
    diagnosis: 'Uma hipótese controlada deve ser avaliada.',
    hypotheses: ['O criativo pode precisar de nova variação.'],
    confidence: 'moderate',
    healthStatus: 'INTERVENTION_RECOMMENDED',
    recommendedAction: 'GERAR_NOVA_VARIACAO',
    reason: 'Teste uma variável por vez.',
    expectedImpact: 'medium',
    risk: 'medium',
    urgency: 'medium',
    requiresApproval: true,
    nextReview: '2026-09-01T12:00:00.000Z',
    learning: null,
    dataMaturity: 'mature',
    evidence: ['campaign_status=ACTIVE', 'impressions=3200', 'results=8'],
    generatedAt: '2026-08-31T12:00:00.000Z',
    boundaries: {
      shadowMode: true,
      metaWritePerformed: false,
      externalWritesAllowed: false,
      recommendationAutoExecuted: false,
      financialActionAuthorized: false,
    },
    ...overrides,
  };
}

function setup(current: AnalystAnalysisV1 | null = analysis(), decisionRows: any[] = []) {
  const analyst = {
    latest: jest.fn().mockResolvedValue({ snapshot: null, analysis: current }),
  } as any;
  const presenter = {
    present: jest.fn().mockImplementation((item: AnalystAnalysisV1) => ({
      operationalState: item.evidence.some((x) => x === 'campaign_status=PAUSED') ? 'PAUSED' : 'RUNNING',
      situation: item.healthStatus === 'OPERATIONAL_PROBLEM'
        ? 'Existe um problema operacional que precisa ser resolvido antes da otimização.'
        : 'A campanha está em observação.',
      recommendation: 'Revise a recomendação.',
      nextStep: 'Revise o próximo passo.',
    })),
  } as any;
  const audit = { append: jest.fn().mockResolvedValue(undefined) } as any;
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: decisionRows }),
  } as any;
  return {
    service: new AnalystGovernanceService(analyst, presenter, audit, pool),
    analyst,
    presenter,
    audit,
    pool,
  };
}

describe('AnalystGovernanceService', () => {
  it('records approval but never turns it into execution authorization', async () => {
    const { service, audit } = setup();
    const result = await service.decideLatest(
      TENANT_ID,
      CAMPAIGN_ID,
      'approve',
      'operator:test',
      'Aprovar apenas a nova variação para revisão.',
    );

    expect(result.actionStatus).toBe('APPROVED_RECOMMENDATION');
    expect(result.handoffTarget).toBe('generator');
    expect(result.boundaries.decisionIsExecutionAuthorization).toBe(false);
    expect(result.boundaries.executionAuthorized).toBe(false);
    expect(result.boundaries.metaWritePerformed).toBe(false);
    expect(result.boundaries.externalWritesAllowed).toBe(false);
    expect(audit.append).toHaveBeenCalledTimes(1);
    const event = audit.append.mock.calls[0][0];
    expect(event.eventType).toBe('analyst_recommendation_approved');
    expect(event.newState.executionAuthorized).toBe(false);
  });

  it('records rejection without creating a handoff', async () => {
    const { service, audit } = setup();
    const result = await service.decideLatest(
      TENANT_ID,
      CAMPAIGN_ID,
      'reject',
      'operator:test',
      'Manter a campanha como está por enquanto.',
    );
    expect(result.actionStatus).toBe('REJECTED_RECOMMENDATION');
    expect(result.handoffTarget).toBeNull();
    expect(result.boundaries.recommendationAutoExecuted).toBe(false);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it('does not ask for approval when the current recommendation does not require it', async () => {
    const { service, audit } = setup(analysis({
      recommendedAction: 'MANTER',
      healthStatus: 'HEALTHY',
      requiresApproval: false,
    }));
    const result = await service.decideLatest(
      TENANT_ID,
      CAMPAIGN_ID,
      'approve',
      'operator:test',
    );
    expect(result.actionStatus).toBe('NO_APPROVAL_REQUIRED');
    expect(result.boundaries.executionAuthorized).toBe(false);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('makes paused campaigns informational instead of urgent', async () => {
    const { service } = setup(analysis({
      healthStatus: 'INSUFFICIENT_DATA',
      recommendedAction: 'AGUARDAR',
      requiresApproval: false,
      evidence: ['campaign_status=PAUSED', 'impressions=0', 'results=0'],
    }));
    const result = await service.essentialAlert(TENANT_ID, CAMPAIGN_ID);
    expect(result.level).toBe('info');
    expect(result.title).toBe('Campanha pausada');
    expect(result.userActionRequired).toBe(false);
    expect(result.boundaries.alertIsExecutionCommand).toBe(false);
  });

  it('raises a critical alert for an operational problem', async () => {
    const { service } = setup(analysis({
      healthStatus: 'OPERATIONAL_PROBLEM',
      recommendedAction: 'AJUSTAR',
      urgency: 'high',
      requiresApproval: true,
      evidence: ['campaign_status=NOT_DELIVERING'],
    }));
    const result = await service.essentialAlert(TENANT_ID, CAMPAIGN_ID);
    expect(result.level).toBe('critical');
    expect(result.userActionRequired).toBe(true);
    expect(result.boundaries.metaWritePerformed).toBe(false);
  });

  it('returns the stored latest decision idempotently', async () => {
    const row = {
      event_type: 'analyst_recommendation_approved',
      actor_id: 'operator:test',
      new_state: {
        decision: 'approve',
        reason: 'Aprovado.',
        handoffTarget: 'generator',
      },
      created_at: new Date('2026-08-31T14:00:00.000Z'),
    };
    const { service, audit } = setup(analysis(), [row]);
    const result = await service.decideLatest(
      TENANT_ID,
      CAMPAIGN_ID,
      'approve',
      'operator:test',
      'Aprovado.',
    );
    expect(result.actionStatus).toBe('APPROVED_RECOMMENDATION');
    expect(result.decidedAt).toBe('2026-08-31T14:00:00.000Z');
    expect(audit.append).not.toHaveBeenCalled();
  });
});
