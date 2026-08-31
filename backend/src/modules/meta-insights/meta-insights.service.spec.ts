import { BadRequestException, ConflictException } from '@nestjs/common';
import { MetaInsightsService } from './meta-insights.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '673dbb65-e187-4d80-8751-772d6e0156b3';

function setup(selectedAccounts = ['act_929361834160386']) {
  const insights = {
    readCampaignInsights: jest.fn().mockResolvedValue({
      success: true,
      observedAt: '2026-08-31T00:00:00Z',
      retryable: false,
      data: { campaignId: '123456' },
    }),
  } as any;
  const readonlyMeta = {
    readAdAccount: jest.fn().mockResolvedValue({
      success: true,
      observedAt: '2026-08-31T00:00:00Z',
      retryable: false,
      data: { id: 'act_929361834160386', currency: 'BRL' },
    }),
  } as any;
  const connections = {
    latestReadyForTenant: jest.fn().mockResolvedValue({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      credentialRef: 'postgres-vault://credential',
      status: 'ready',
    }),
    listBindings: jest.fn().mockResolvedValue(selectedAccounts.map((externalId) => ({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      assetType: 'ad_account',
      externalId,
      selected: true,
      observedAt: '2026-08-31T00:00:00Z',
    }))),
  } as any;
  return {
    service: new MetaInsightsService(insights, readonlyMeta, connections),
    insights,
    readonlyMeta,
    connections,
  };
}

describe('MetaInsightsService', () => {
  it('reads only through the single selected ad account and server credential', async () => {
    const { service, insights, readonlyMeta } = setup();
    await service.readSelectedCampaign(TENANT_ID, '123456', '2026-08-30', '2026-08-31');

    expect(readonlyMeta.readAdAccount).toHaveBeenCalledWith(
      TENANT_ID,
      'postgres-vault://credential',
      'act_929361834160386',
    );
    expect(insights.readCampaignInsights).toHaveBeenCalledWith(
      TENANT_ID,
      'postgres-vault://credential',
      'act_929361834160386',
      '123456',
      '2026-08-30',
      '2026-08-31',
      'BRL',
    );
  });

  it('rejects invalid user input before account or Meta reads', async () => {
    const { service, insights, readonlyMeta, connections } = setup();
    await expect(service.readSelectedCampaign(
      TENANT_ID,
      '../123',
      '2026-01-01',
      '2026-08-31',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(connections.latestReadyForTenant).not.toHaveBeenCalled();
    expect(readonlyMeta.readAdAccount).not.toHaveBeenCalled();
    expect(insights.readCampaignInsights).not.toHaveBeenCalled();
  });

  it('fails closed when more than one ad account is selected', async () => {
    const { service, insights, readonlyMeta } = setup(['act_1', 'act_2']);
    await expect(service.readSelectedCampaign(
      TENANT_ID,
      '123456',
      '2026-08-30',
      '2026-08-31',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(readonlyMeta.readAdAccount).not.toHaveBeenCalled();
    expect(insights.readCampaignInsights).not.toHaveBeenCalled();
  });

  it('does not request insights if the selected account read fails', async () => {
    const { service, insights, readonlyMeta } = setup();
    readonlyMeta.readAdAccount.mockResolvedValueOnce({
      success: false,
      observedAt: '2026-08-31T00:00:00Z',
      retryable: false,
      normalizedError: 'AUTH_PERMISSION',
    });
    await expect(service.readSelectedCampaign(
      TENANT_ID,
      '123456',
      '2026-08-31',
      '2026-08-31',
    )).resolves.toEqual(expect.objectContaining({ success: false }));
    expect(insights.readCampaignInsights).not.toHaveBeenCalled();
  });
});
