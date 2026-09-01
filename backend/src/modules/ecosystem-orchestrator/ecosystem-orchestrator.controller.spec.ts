import { EcosystemOrchestratorController } from './ecosystem-orchestrator.controller';

describe('EcosystemOrchestratorController', () => {
  it('accepts the stable custom operator header for overview', async () => {
    const orchestrator = {
      overview: jest.fn().mockResolvedValue({ actionStatus: 'OK' }),
      campaign: jest.fn(),
      advanceAllSafe: jest.fn(),
      advanceSafe: jest.fn(),
    } as any;
    const controller = new EcosystemOrchestratorController(orchestrator);

    await controller.overview(undefined, 'stable-operator-key-with-at-least-thirty-two-chars');

    expect(orchestrator.overview).toHaveBeenCalledWith(
      'Bearer stable-operator-key-with-at-least-thirty-two-chars',
    );
  });

  it('prefers Authorization when both auth modes are present', async () => {
    const orchestrator = {
      overview: jest.fn(),
      campaign: jest.fn(),
      advanceAllSafe: jest.fn().mockResolvedValue({ actionStatus: 'SAFE_BATCH_COMPLETED' }),
      advanceSafe: jest.fn(),
    } as any;
    const controller = new EcosystemOrchestratorController(orchestrator);

    await controller.advanceAllSafe('Bearer primary-token', 'secondary-token');

    expect(orchestrator.advanceAllSafe).toHaveBeenCalledWith('Bearer primary-token');
  });

  it('returns a human-only overview without technical identifiers', async () => {
    const orchestrator = {
      overview: jest.fn().mockResolvedValue({
        headline: 'Ecossistema funcionando. Nenhuma ação sua é necessária agora.',
        simpleMessage: 'Contexto Ads, Gerador e Analista estão funcionando como um único fluxo.',
        userActionRequired: false,
        campaigns: [{
          tenantId: 'tenant-secret-id',
          campaignId: 'campaign-secret-id',
          activeModule: 'analyst',
          stage: 'MONITORING',
          progressPercent: 100,
          headline: 'A campanha está pausada e segura.',
          simpleMessage: 'O Analista está acompanhando. Nada está rodando ou gastando.',
          whatSystemDid: 'A campanha foi preparada, vinculada e colocada em acompanhamento.',
          nextStep: 'Continuar acompanhando até existir dado novo ou uma decisão necessária.',
          userActionRequired: false,
          userAction: 'Nenhuma ação sua é necessária agora.',
          technicalDetails: { executionPlanId: 'plan-secret-id' },
          boundaries: { publicationAuthorized: false },
        }],
      }),
      campaign: jest.fn(),
      advanceAllSafe: jest.fn(),
      advanceSafe: jest.fn(),
    } as any;
    const controller = new EcosystemOrchestratorController(orchestrator);

    const result = await controller.humanStatus('Bearer primary-token');
    const serialized = JSON.stringify(result);

    expect(result.campaigns[0]).toEqual({
      whoIsWorking: 'Analista Ads',
      progress: '100%',
      status: 'A campanha está pausada e segura.',
      message: 'O Analista está acompanhando. Nada está rodando ou gastando.',
      whatAlreadyHappened: 'A campanha foi preparada, vinculada e colocada em acompanhamento.',
      whatHappensNow: 'Continuar acompanhando até existir dado novo ou uma decisão necessária.',
      needsYourDecision: false,
      yourAction: 'Nenhuma ação sua é necessária agora.',
    });
    expect(serialized).not.toContain('tenant-secret-id');
    expect(serialized).not.toContain('campaign-secret-id');
    expect(serialized).not.toContain('plan-secret-id');
    expect(serialized).not.toContain('MONITORING');
  });
});
