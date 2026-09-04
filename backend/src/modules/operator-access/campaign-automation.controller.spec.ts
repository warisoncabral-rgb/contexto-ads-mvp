import { CampaignAutomationController } from './campaign-automation.controller';

describe('CampaignAutomationController', () => {
  const makeController = (
    automation: any,
    access: any = {},
    status: any = {},
    selectivePublication: any = {},
  ) => new CampaignAutomationController(automation, access, status, selectivePublication);

  it('auto-completes automaticEnhancementsReviewed for exact attached media ingestion', async () => {
    const automation = {
      prepareCreative: jest.fn().mockResolvedValue({ action_status: 'READY_FOR_REVIEW' }),
    } as any;
    const controller = makeController(automation);
    const body = {
      package_id: '0fc65970-05f1-4258-a28e-a6c411e9f676',
      campaign_id: '0fc65970-05f1-4258-a28e-a6c411e9f676',
      reviewChecklist: {
        claimsVerifiedAgainstSources: true,
        visualFidelityReviewed: true,
        safeAreaReviewed: true,
        requiredFieldsReviewed: true,
        automaticEnhancementsReviewed: false,
      },
    };

    await controller.prepareCreative(body, 'Bearer valid-token');

    expect(automation.prepareCreative).toHaveBeenCalledTimes(1);
    expect(automation.prepareCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewChecklist: expect.objectContaining({
          claimsVerifiedAgainstSources: true,
          visualFidelityReviewed: true,
          safeAreaReviewed: true,
          requiredFieldsReviewed: true,
          automaticEnhancementsReviewed: true,
        }),
      }),
      'Bearer valid-token',
    );
    expect(body.reviewChecklist.automaticEnhancementsReviewed).toBe(false);
  });

  it('exposes the authenticated controlled pause command', async () => {
    const automation = {
      pauseCampaign: jest.fn().mockResolvedValue({ action_status: 'PAUSED' }),
    } as any;
    const controller = makeController(automation);
    const body = {
      package_id: '0fc65970-05f1-4258-a28e-a6c411e9f676',
      confirmation: 'PAUSE_CAMPAIGN',
      reason: 'Alerta crítico',
    };

    await expect(controller.pause(body, 'Bearer valid-token')).resolves.toEqual({
      action_status: 'PAUSED',
    });
    expect(automation.pauseCampaign).toHaveBeenCalledWith(body, 'Bearer valid-token');
  });

  it('routes selective publication through the existing publish action without changing budget', async () => {
    const tenantId = '2dffda96-f552-4f07-bd13-734c42b1e8ee';
    const executionPlanId = '2d22cbca-3e22-49d0-8cce-082077c4631c';
    const packageId = '0fc65970-05f1-4258-a28e-a6c411e9f676';
    const automation = {
      publishCampaign: jest.fn(),
    } as any;
    const access = {
      listTenants: jest.fn().mockResolvedValue({
        tenants: [{ tenantId, permissions: ['manage_campaign_preparation'] }],
      }),
      authorizeCampaignPreparation: jest.fn().mockResolvedValue({
        operator: { subject: 'operator-user' },
      }),
    } as any;
    const status = {
      get: jest.fn().mockResolvedValue({
        creative: { status: 'approved' },
        plan_approval: { status: 'approved' },
        execution_plan: { execution_plan_id: executionPlanId },
      }),
    } as any;
    const selectivePublication = {
      publishSelected: jest.fn().mockResolvedValue({
        status: 'PUBLISHED_SELECTED_ADS',
        budget_change_authorized: false,
      }),
    } as any;
    const controller = makeController(automation, access, status, selectivePublication);
    const body = {
      package_id: packageId,
      confirmation: 'PUBLISH_SELECTED_ADS',
      active_ad_ids: ['120253450451150359'],
      paused_ad_ids: ['120253450450440359'],
    };

    const result = await controller.publish(body, 'Bearer valid-token');

    expect(result).toEqual(expect.objectContaining({
      action_status: 'PUBLISHED_SELECTED_ADS',
      boundaries: expect.objectContaining({
        budget_change_authorized: false,
        unselected_ads_activation_authorized: false,
      }),
    }));
    expect(selectivePublication.publishSelected).toHaveBeenCalledWith(
      tenantId,
      executionPlanId,
      'operator-user',
      ['120253450451150359'],
      ['120253450450440359'],
    );
    expect(automation.publishCampaign).not.toHaveBeenCalled();
  });
});
