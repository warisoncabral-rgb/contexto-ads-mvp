import { AnalystMetaCampaignResolverService } from './analyst-meta-campaign-resolver.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '849547ce-645e-4c7b-a844-451182253fe6';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const MANIFEST_ID = '33333333-3333-4333-8333-333333333333';
const PROTOCOL_ID = '44444444-4444-4444-8444-444444444444';

function setup(protocol: any = null) {
  const plans = {
    latest: jest.fn().mockResolvedValue({
      executionPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      campaignId: CAMPAIGN_ID,
    }),
  } as any;
  const manifests = {
    latestForPlan: jest.fn().mockResolvedValue({
      executionManifestId: MANIFEST_ID,
      executionPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      campaignId: CAMPAIGN_ID,
    }),
  } as any;
  const protocols = {
    latestForManifest: jest.fn().mockResolvedValue(protocol),
  } as any;
  return {
    service: new AnalystMetaCampaignResolverService(plans, manifests, protocols),
    plans,
    manifests,
    protocols,
  };
}

describe('AnalystMetaCampaignResolverService', () => {
  it('resolves a successful Meta campaign operation from execution history', async () => {
    const { service } = setup({
      metaWriteValidationProtocolId: PROTOCOL_ID,
      execution: {
        operations: [
          { objectType: 'campaign', status: 'succeeded', externalObjectId: '120999888777' },
          { objectType: 'adset', status: 'succeeded', externalObjectId: '120999888778' },
        ],
      },
    });

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toEqual({
      externalCampaignId: '120999888777',
      executionPlanId: PLAN_ID,
      executionManifestId: MANIFEST_ID,
      protocolId: PROTOCOL_ID,
      source: 'execution_operation',
    });
  });

  it('uses reconciled campaign evidence when the execution record is not sufficient', async () => {
    const { service } = setup({
      metaWriteValidationProtocolId: PROTOCOL_ID,
      execution: {
        operations: [
          { objectType: 'campaign', status: 'uncertain', externalObjectId: '120999888777' },
        ],
      },
      reconciledOperations: [
        {
          objectType: 'campaign',
          externalObjectId: '120999888777',
          observedStatus: 'PAUSED',
          operationKey: 'campaign:create',
        },
      ],
    });

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toEqual(
      expect.objectContaining({
        externalCampaignId: '120999888777',
        source: 'reconciled_operation',
      }),
    );
  });

  it('returns null instead of guessing when no confirmed external campaign exists', async () => {
    const { service } = setup({
      metaWriteValidationProtocolId: PROTOCOL_ID,
      execution: {
        operations: [
          { objectType: 'campaign', status: 'failed', externalObjectId: '120999888777' },
          { objectType: 'campaign', status: 'succeeded', externalObjectId: '../invalid' },
        ],
      },
      reconciledOperations: [],
    });

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toBeNull();
  });

  it('stops cleanly when the campaign has no execution plan', async () => {
    const { service, plans, manifests, protocols } = setup();
    plans.latest.mockResolvedValueOnce(null);

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toBeNull();
    expect(manifests.latestForPlan).not.toHaveBeenCalled();
    expect(protocols.latestForManifest).not.toHaveBeenCalled();
  });

  it('stops cleanly when the plan has no manifest or protocol', async () => {
    const first = setup();
    first.manifests.latestForPlan.mockResolvedValueOnce(null);
    await expect(first.service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toBeNull();
    expect(first.protocols.latestForManifest).not.toHaveBeenCalled();

    const second = setup(null);
    await expect(second.service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toBeNull();
  });
});
