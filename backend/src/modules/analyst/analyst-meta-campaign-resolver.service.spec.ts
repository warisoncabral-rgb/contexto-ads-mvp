import { AnalystTrackingRegistrationV1 } from '../../domain/contracts/analyst-tracking';
import { AnalystMetaCampaignResolverService } from './analyst-meta-campaign-resolver.service';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '849547ce-645e-4c7b-a844-451182253fe6';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const MANIFEST_ID = '33333333-3333-4333-8333-333333333333';
const PROTOCOL_ID = '44444444-4444-4444-8444-444444444444';

const registration: AnalystTrackingRegistrationV1 = {
  registrationId: '55555555-5555-4555-8555-555555555555',
  tenantId: TENANT_ID,
  campaignId: CAMPAIGN_ID,
  externalCampaignId: '120999888777',
  executionPlanId: PLAN_ID,
  executionManifestId: MANIFEST_ID,
  metaWriteValidationProtocolId: PROTOCOL_ID,
  source: 'execution_operation',
  registeredAt: '2026-08-31T22:00:00.000Z',
  updatedAt: '2026-08-31T22:00:00.000Z',
  boundaries: {
    trackingOnly: true,
    executionAuthorized: false,
    metaWritePerformed: false,
    externalWritesAllowed: false,
    recommendationAutoExecuted: false,
  },
};

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
  const tracking = {
    find: jest.fn().mockResolvedValue(null),
    ensureFromProtocol: jest.fn().mockResolvedValue(null),
  } as any;
  return {
    service: new AnalystMetaCampaignResolverService(plans, manifests, protocols, tracking),
    plans,
    manifests,
    protocols,
    tracking,
  };
}

describe('AnalystMetaCampaignResolverService', () => {
  it('uses the explicit tracking registration before scanning execution history', async () => {
    const { service, tracking, plans, manifests, protocols } = setup();
    tracking.find.mockResolvedValueOnce(registration);

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toEqual({
      externalCampaignId: '120999888777',
      executionPlanId: PLAN_ID,
      executionManifestId: MANIFEST_ID,
      protocolId: PROTOCOL_ID,
      source: 'execution_operation',
    });
    expect(plans.latest).not.toHaveBeenCalled();
    expect(manifests.latestForPlan).not.toHaveBeenCalled();
    expect(protocols.latestForManifest).not.toHaveBeenCalled();
  });

  it('automatically registers a confirmed historical execution on first resolution', async () => {
    const protocol = {
      status: 'external_validation_succeeded',
      metaWriteValidationProtocolId: PROTOCOL_ID,
    };
    const { service, tracking } = setup(protocol);
    tracking.ensureFromProtocol.mockResolvedValueOnce(registration);

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toEqual({
      externalCampaignId: '120999888777',
      executionPlanId: PLAN_ID,
      executionManifestId: MANIFEST_ID,
      protocolId: PROTOCOL_ID,
      source: 'execution_operation',
    });
    expect(tracking.ensureFromProtocol).toHaveBeenCalledWith(protocol);
  });

  it('does not enroll before controlled Meta validation succeeds', async () => {
    const { service, tracking } = setup({
      status: 'external_validation_failed',
      metaWriteValidationProtocolId: PROTOCOL_ID,
      execution: {
        operations: [
          { objectType: 'campaign', status: 'succeeded', externalObjectId: '120999888777' },
        ],
      },
    });

    await expect(service.resolve(TENANT_ID, CAMPAIGN_ID)).resolves.toBeNull();
    expect(tracking.ensureFromProtocol).not.toHaveBeenCalled();
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
