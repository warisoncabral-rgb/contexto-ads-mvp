import { OperatorCampaignPackageController } from './operator-campaign-package.controller';

describe('OperatorCampaignPackageController', () => {
  it('authenticates tenant preparation before submitting a package', async () => {
    const access = {
      authorizeCampaignPreparation: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        membership: { role: 'owner' },
      })),
    };
    const handoff = {
      submit: jest.fn(async () => ({ package_id: '11111111-1111-4111-8111-111111111111' })),
    };
    const status = { get: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
    );

    const body = { package_id: '11111111-1111-4111-8111-111111111111' };
    await controller.submit(
      '22222222-2222-4222-8222-222222222222',
      body,
      'Bearer secret',
    );

    expect(access.authorizeCampaignPreparation).toHaveBeenCalledWith(
      'Bearer secret',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(handoff.submit).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      body,
      'operator:test',
    );
  });

  it('authenticates tenant preparation before returning package status', async () => {
    const access = {
      authorizeCampaignPreparation: jest.fn(async () => ({ operator: { subject: 'operator:test' } })),
    };
    const handoff = { submit: jest.fn() };
    const status = {
      get: jest.fn(async () => ({
        package_id: '11111111-1111-4111-8111-111111111111',
        next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      })),
    };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
    );

    const result = await controller.getStatus(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'Bearer secret',
    );

    expect(access.authorizeCampaignPreparation).toHaveBeenCalledTimes(1);
    expect(status.get).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.next_action).toBe('REVIEW_AND_APPROVE_CREATIVE_PACKAGE');
  });
});
