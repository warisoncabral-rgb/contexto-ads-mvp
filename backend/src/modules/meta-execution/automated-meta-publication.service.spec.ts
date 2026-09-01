import { ConfigService } from '@nestjs/config';
import { AutomatedMetaPublicationService } from './automated-meta-publication.service';

describe('AutomatedMetaPublicationService', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const planId = '33333333-3333-4333-8333-333333333333';
  const manifestId = '44444444-4444-4444-8444-444444444444';

  const manifests = {
    latestForPlan: jest.fn(),
    findById: jest.fn(),
  } as any;
  const plans = {
    findById: jest.fn(),
    latest: jest.fn(),
  } as any;
  const connections = {
    findById: jest.fn(),
    listBindings: jest.fn(),
  } as any;
  const protocols = {
    latestForManifest: jest.fn(),
    beginExecution: jest.fn(),
    updateExecution: jest.fn(),
  } as any;
  const authorizations = { get: jest.fn() } as any;
  const killSwitch = {
    effective: jest.fn(),
    changeCampaign: jest.fn(),
  } as any;
  const adapter = {
    enabled: jest.fn(() => true),
    read: jest.fn(),
    updateStatus: jest.fn(),
    create: jest.fn(),
    searchCity: jest.fn(),
  } as any;
  const service = new AutomatedMetaPublicationService(
    manifests,
    plans,
    connections,
    protocols,
    authorizations,
    killSwitch,
    adapter,
    new ConfigService({ META_CITY_RADIUS_KM: '40' }),
  );

  beforeEach(() => jest.clearAllMocks());

  it('parses João Pessoa and Recife as two city targets with their approved radii', async () => {
    adapter.searchCity.mockImplementation(async (_tenant: string, _credential: string, city: string) => ({
      success: true,
      data: { key: city === 'João Pessoa' ? '101' : '202', name: city },
      observedAt: new Date().toISOString(),
      retryable: false,
    }));
    const plan = {
      objectsToCreate: [{
        type: 'ad_set',
        logicalConfig: {
          geography: 'Incluir João Pessoa, PB, Brazil (40 km); Incluir Recife, PE, Brazil (40 km)',
        },
      }],
    } as any;
    await expect((service as any).cityKeys(tenantId, 'vault:1', plan)).resolves.toEqual([
      { key: '101', radius: 40, distance_unit: 'kilometer' },
      { key: '202', radius: 40, distance_unit: 'kilometer' },
    ]);
    expect(adapter.searchCity.mock.calls.map((call: any[]) => call[2])).toEqual(['João Pessoa', 'Recife']);
  });

  it('builds a native Meta video creative when an MP4 has been uploaded', () => {
    const request = (service as any).requestFor(
      {
        objectType: 'creative',
        idempotencyKey: 'abcdef1234567890',
        internalObjectId: `${campaignId}:creative:variant_1`,
        dependsOnOperationKeys: [],
      },
      {
        copy: {
          primaryText: 'Texto aprovado',
          headline: 'Headline aprovada',
        },
        asset: {
          mimeType: 'video/mp4',
          storageRef: 'https://api.example.test/v1/public/media/1/2',
        },
      },
      {} as any,
      {},
      '12345',
      '67890',
      [],
      '99999',
    );
    expect(request.edge).toBe('adcreatives');
    expect(request.params.object_story_spec.video_data.video_id).toBe('99999');
    expect(request.params.object_story_spec.video_data.call_to_action.type).toBe('WHATSAPP_MESSAGE');
  });

  it('validates ACTIVE then returns every lifecycle object to PAUSED in roundtrip mode', async () => {
    const plan = {
      tenantId,
      campaignId,
      executionPlanId: planId,
      planHash: 'a'.repeat(64),
      meta: { connectionId: '55555555-5555-4555-8555-555555555555' },
    } as any;
    plans.findById.mockResolvedValue(plan);
    plans.latest.mockResolvedValue(plan);
    manifests.latestForPlan.mockResolvedValue({
      executionManifestId: manifestId,
      planHash: plan.planHash,
    });
    protocols.latestForManifest.mockResolvedValue({
      status: 'external_validation_succeeded',
      execution: {
        operations: [
          { objectType: 'campaign', externalObjectId: '10001' },
          { objectType: 'ad_set', externalObjectId: '10002' },
          { objectType: 'ad', externalObjectId: '10003' },
          { objectType: 'ad', externalObjectId: '10004' },
        ],
      },
    });
    killSwitch.effective.mockResolvedValue({
      tenant: { status: 'released' },
      campaign: { status: 'released' },
    });
    connections.findById.mockResolvedValue({ credentialRef: 'vault:1' });
    adapter.read.mockResolvedValue({
      success: true,
      data: { id: '10001', configuredStatus: 'PAUSED' },
      observedAt: new Date().toISOString(),
      retryable: false,
    });
    adapter.updateStatus.mockImplementation(async (
      _tenant: string,
      _credential: string,
      id: string,
      status: 'ACTIVE' | 'PAUSED',
    ) => ({
      success: true,
      data: { id, configuredStatus: status },
      observedAt: new Date().toISOString(),
      retryable: false,
    }));

    const result = await service.publish(tenantId, planId, 'operator:warison', true);
    expect(result.status).toBe('ACTIVATION_ROUNDTRIP_PASSED');
    expect(result.campaign_active).toBe(false);
    const transitions = adapter.updateStatus.mock.calls.map((call: any[]) => [call[2], call[3]]);
    expect(transitions).toEqual([
      ['10001', 'ACTIVE'],
      ['10002', 'ACTIVE'],
      ['10003', 'ACTIVE'],
      ['10004', 'ACTIVE'],
      ['10004', 'PAUSED'],
      ['10003', 'PAUSED'],
      ['10002', 'PAUSED'],
      ['10001', 'PAUSED'],
    ]);
  });

  it('pauses ads before ad set and campaign then engages the campaign kill switch', async () => {
    const plan = {
      tenantId,
      campaignId,
      executionPlanId: planId,
      planHash: 'a'.repeat(64),
      meta: { connectionId: '55555555-5555-4555-8555-555555555555' },
    } as any;
    plans.findById.mockResolvedValue(plan);
    plans.latest.mockResolvedValue(plan);
    manifests.latestForPlan.mockResolvedValue({
      executionManifestId: manifestId,
      planHash: plan.planHash,
    });
    protocols.latestForManifest.mockResolvedValue({
      status: 'external_validation_succeeded',
      execution: {
        operations: [
          { objectType: 'campaign', externalObjectId: '10001' },
          { objectType: 'ad_set', externalObjectId: '10002' },
          { objectType: 'ad', externalObjectId: '10003' },
          { objectType: 'ad', externalObjectId: '10004' },
        ],
      },
    });
    connections.findById.mockResolvedValue({ credentialRef: 'vault:1' });
    adapter.read.mockResolvedValue({
      success: true,
      data: { configuredStatus: 'ACTIVE' },
      observedAt: new Date().toISOString(),
      retryable: false,
    });
    adapter.updateStatus.mockImplementation(async (
      _tenant: string,
      _credential: string,
      id: string,
      status: 'ACTIVE' | 'PAUSED',
    ) => ({ success: true, data: { id, configuredStatus: status }, retryable: false }));

    const result = await service.pause(
      tenantId, planId, 'operator:warison', 'Teto do piloto atingido',
    );

    expect(result.status).toBe('PAUSED_CONFIRMED');
    expect(result.kill_switch_engaged).toBe(true);
    expect(adapter.updateStatus.mock.calls.map((call: any[]) => [call[2], call[3]])).toEqual([
      ['10003', 'PAUSED'],
      ['10004', 'PAUSED'],
      ['10002', 'PAUSED'],
      ['10001', 'PAUSED'],
    ]);
    expect(killSwitch.changeCampaign).toHaveBeenCalledWith(
      tenantId,
      campaignId,
      'engaged',
      'operator:warison',
      expect.stringContaining('Teto do piloto atingido'),
    );
  });
});
