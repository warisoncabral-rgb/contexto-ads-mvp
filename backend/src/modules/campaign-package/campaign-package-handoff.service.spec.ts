import { CampaignPackageHandoffService } from './campaign-package-handoff.service';
import { CampaignPackageMapper } from './campaign-package.mapper';
import { CampaignPackageService } from './campaign-package.service';

const tenantId = '22222222-2222-4222-8222-222222222222';
const packageV1 = {
  package_id: '11111111-1111-4111-8111-111111111111',
  package_version: 1,
  created_at: '2026-08-26T20:00:00.000Z',
  source: 'contexto_ads',
  client_id: 'client-rosa-vip',
  business_name: 'Rosa VIP',
  business_description: 'Marca de calçados com operação de atacado.',
  offer_name: 'Calçados no atacado',
  offer_description: 'Oferta para geração de contatos de lojistas e revendedores.',
  offer_type: 'lead_generation',
  campaign_objective: 'LEADS',
  conversion_destination: 'WHATSAPP',
  campaign_goal_description: 'Gerar contatos qualificados pelo WhatsApp.',
  audience_description: 'Lojistas, sacoleiros e revendedores.',
  locations: [{ city: 'Recife', state: 'PE', country: 'BR', radius_km: 40 }],
  budget_type: 'DAILY',
  budget_amount: 10,
  currency: 'BRL',
  duration_days: 7,
  ads: [{
    ad_reference: 'AD_01',
    primary_text: 'Conheça nossa linha de atacado.',
    headline: 'Calçados no atacado',
    cta: 'WHATSAPP_MESSAGE',
    initial_message: 'Olá! Quero conhecer o atacado.',
    media_id: 'MEDIA_01',
  }],
  media: [{
    media_id: 'MEDIA_01',
    media_type: 'image',
    source: 'approved_asset',
    file_reference: 'asset://rosa-vip/media-01',
    checksum: `sha256:${'a'.repeat(64)}`,
    mime_type: 'image/jpeg',
    width: 1080,
    height: 1350,
  }],
  strategy_status: 'COMPLETE',
  handoff_status: 'READY_FOR_GENERATOR',
  meta_connection_id: '33333333-3333-4333-8333-333333333333',
};

describe('CampaignPackageHandoffService', () => {
  it('persists the first package version once and creates an internal plan without external effects', async () => {
    let stored: any = null;
    const contexts = {
      findVersion: jest.fn(async (_tenant: string, _campaign: string, version: number) =>
        stored?.version === version ? stored : null),
      latest: jest.fn(async () => stored),
      create: jest.fn(async (context: any) => { stored = context; }),
      appendNext: jest.fn(),
    };
    const executionPlans = {
      generate: jest.fn(async (_tenant: string, campaignId: string, version: number) => ({
        executionPlanId: '44444444-4444-4444-8444-444444444444',
        planHash: 'b'.repeat(64),
        status: 'draft',
        campaignId,
        campaignPackageVersion: version,
      })),
    };
    const service = new CampaignPackageHandoffService(
      new CampaignPackageMapper(new CampaignPackageService()),
      contexts as any,
      executionPlans as any,
    );

    const first = await service.submit(tenantId, packageV1, 'owner:test');
    const second = await service.submit(tenantId, packageV1, 'owner:test');

    expect(contexts.create).toHaveBeenCalledTimes(1);
    expect(first.campaign_id).toBe(packageV1.package_id);
    expect(first.campaign_context_version).toBe(1);
    expect(first.execution_plan_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(first.boundaries).toEqual({
      persisted: true,
      execution_plan_created: true,
      meta_write_performed: false,
      spend_authorized: false,
      delivery_authorized: false,
    });
    expect(second.package_hash).toBe(first.package_hash);
  });

  it('rejects a version gap before changing internal state', async () => {
    const contexts = {
      findVersion: jest.fn(async () => null),
      latest: jest.fn(async () => null),
      create: jest.fn(),
      appendNext: jest.fn(),
    };
    const executionPlans = { generate: jest.fn() };
    const service = new CampaignPackageHandoffService(
      new CampaignPackageMapper(new CampaignPackageService()),
      contexts as any,
      executionPlans as any,
    );

    await expect(service.submit(
      tenantId,
      { ...packageV1, package_version: 2 },
      'owner:test',
    )).rejects.toMatchObject({ response: expect.objectContaining({
      code: 'campaign_package_version_gap',
    }) });
    expect(contexts.create).not.toHaveBeenCalled();
    expect(contexts.appendNext).not.toHaveBeenCalled();
    expect(executionPlans.generate).not.toHaveBeenCalled();
  });
});
