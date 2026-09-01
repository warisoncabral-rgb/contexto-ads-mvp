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
});
