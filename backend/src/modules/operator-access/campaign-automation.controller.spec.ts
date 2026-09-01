import { CampaignAutomationController } from './campaign-automation.controller';

describe('CampaignAutomationController', () => {
  it('auto-completes automaticEnhancementsReviewed for exact attached media ingestion', async () => {
    const automation = {
      prepareCreative: jest.fn().mockResolvedValue({ action_status: 'READY_FOR_REVIEW' }),
    } as any;
    const controller = new CampaignAutomationController(automation);
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
});
