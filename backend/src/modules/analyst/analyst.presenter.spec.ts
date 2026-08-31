import { AnalystAnalysisV1 } from '../../domain/contracts/analyst';
import { AnalystPresenter } from './analyst.presenter';

function analysis(overrides: Partial<AnalystAnalysisV1> = {}): AnalystAnalysisV1 {
  return {
    analysisId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '849547ce-645e-4c7b-a844-451182253fe6',
    snapshotId: '33333333-3333-4333-8333-333333333333',
    previousSnapshotId: null,
    observation: 'A campanha possui dados suficientes para continuar sem alteração.',
    diagnosis: 'Os resultados permanecem estáveis e não existe evidência atual que justifique intervenção.',
    hypotheses: ['A campanha está dentro da variação esperada.'],
    confidence: 'moderate',
    healthStatus: 'HEALTHY',
    recommendedAction: 'MANTER',
    reason: 'Alterar agora criaria risco de sobreotimização.',
    expectedImpact: 'none',
    risk: 'low',
    urgency: 'low',
    requiresApproval: false,
    nextReview: '2026-09-01T12:00:00.000Z',
    learning: null,
    dataMaturity: 'mature',
    evidence: [
      'campaign_status=ACTIVE',
      'campaign_age_hours=48',
      'impressions=3200',
      'spend_minor=4235',
      'results=14',
    ],
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

describe('AnalystPresenter', () => {
  const presenter = new AnalystPresenter();

  it('gives a non-specialist a direct operational north', () => {
    const brief = presenter.present(analysis());
    expect(brief.operationalState).toBe('RUNNING');
    expect(brief.situation).toBe('A campanha está saudável no momento.');
    expect(brief.recommendation).toBe('Mantenha a campanha como está.');
    expect(brief.nextStep).toContain('Nenhuma alteração é necessária agora');
    expect(brief.userActionRequired).toBe(false);
    expect(brief.userAction).toContain('Nenhuma alteração');
    expect(brief.confidence.label).toBe('Moderada');
    expect(brief.urgency.label).toBe('Sem urgência');
    expect(brief.simpleMessage.length).toBeLessThan(260);
    expect(brief.technicalDetailsAvailable).toBe(true);
  });

  it('makes waiting explicit when data is insufficient', () => {
    const brief = presenter.present(analysis({
      healthStatus: 'INSUFFICIENT_DATA',
      recommendedAction: 'AGUARDAR',
      confidence: 'low',
      dataMaturity: 'insufficient',
      diagnosis: 'Ainda não existe amostra suficiente para distinguir tendência de oscilação normal.',
    }));
    expect(brief.operationalState).toBe('RUNNING');
    expect(brief.situation).toContain('dados suficientes');
    expect(brief.recommendation).toContain('Não faça alterações agora');
    expect(brief.nextStep).toContain('Não altere público, criativo ou orçamento');
    expect(brief.userActionRequired).toBe(false);
    expect(brief.confidence.label).toBe('Baixa');
  });

  it('treats a paused campaign as an operational state instead of waiting for impossible new data', () => {
    const brief = presenter.present(analysis({
      healthStatus: 'INSUFFICIENT_DATA',
      recommendedAction: 'AGUARDAR',
      confidence: 'low',
      dataMaturity: 'insufficient',
      evidence: [
        'campaign_status=PAUSED',
        'campaign_age_hours=126',
        'impressions=0',
        'spend_minor=0',
        'results=0',
      ],
    }));
    expect(brief.operationalState).toBe('PAUSED');
    expect(brief.situation).toContain('pausada');
    expect(brief.interpretation).toContain('não surgirão novos dados');
    expect(brief.recommendation).toContain('Não avalie desempenho');
    expect(brief.nextStep).toContain('Se a pausa foi intencional');
    expect(brief.userAction).toContain('Confirme apenas se a pausa é intencional');
    expect(brief.decision).toBe('OBSERVAR');
    expect(brief.userActionRequired).toBe(false);
  });

  it('makes approval requirement impossible to miss', () => {
    const brief = presenter.present(analysis({
      healthStatus: 'INTERVENTION_RECOMMENDED',
      recommendedAction: 'AJUSTAR',
      urgency: 'medium',
      requiresApproval: true,
      expectedImpact: 'medium',
      risk: 'medium',
    }));
    expect(brief.userActionRequired).toBe(true);
    expect(brief.userAction).toContain('aprovar ou rejeitar');
    expect(brief.nextStep).toContain('antes de qualquer execução');
    expect(brief.urgency.label).toBe('Acompanhar');
  });

  it('does not assume a currency that is absent from the analysis contract', () => {
    const brief = presenter.present(analysis({
      evidence: ['spend_minor=4235', 'results=14'],
    }));
    expect(brief.primaryEvidence).toContain('42,35');
    expect(brief.primaryEvidence).toContain('moeda da conta');
    expect(brief.primaryEvidence).not.toContain('R$');
  });

  it('directs operational failures to correction before strategy changes', () => {
    const brief = presenter.present(analysis({
      healthStatus: 'OPERATIONAL_PROBLEM',
      recommendedAction: 'AJUSTAR',
      urgency: 'high',
      requiresApproval: true,
      evidence: ['campaign_status=NOT_DELIVERING'],
    }));
    expect(brief.operationalState).toBe('BLOCKED');
    expect(brief.situation).toContain('problema operacional');
    expect(brief.nextStep).toContain('Corrija primeiro o bloqueio operacional');
    expect(brief.urgency.label).toBe('Ação recomendada');
  });
});
