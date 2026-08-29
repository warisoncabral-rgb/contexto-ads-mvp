import { NotFoundException } from '@nestjs/common';
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

function buildService() {
  let storedContext: any = null;
  let storedCreative: any = null;
  const basePlan = {
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    planHash: 'b'.repeat(64),
    status: 'draft',
  };
  const derivedPlan = {
    executionPlanId: '55555555-5555-4555-8555-555555555555',
    planHash: 'c'.repeat(64),
    status: 'draft',
  };
  const contexts = {
    findVersion: jest.fn(async (_tenant: string, _campaign: string, version: number) =>
      storedContext?.version === version ? storedContext : null),
    latest: jest.fn(async () => storedContext),
    create: jest.fn(async (context: any) => { storedContext = context; }),
    appendNext: jest.fn(),
  };
  const executionPlans = {
    generate: jest.fn(async () => basePlan),
    latest: jest.fn(async () => derivedPlan),
  };
  const creativePackages = {
    latest: jest.fn(async () => {
      if (!storedCreative) throw new NotFoundException('Creative package not found');
      return storedCreative;
    }),
    appendVersion: jest.fn(async () => {
      storedCreative = {
        creativePackageId: '66666666-6666-4666-8666-666666666666',
        version: 1,
        contentHash: 'd'.repeat(64),
        status: 'needs_review',
        sourcePlanHash: basePlan.planHash,
      };
      return { creativePackage: storedCreative, executionPlan: derivedPlan };
    }),
  };
  const executionSimulations = {
    bindTarget: jest.fn(async () => ({
      ...derivedPlan,
      executionPlanId: '77777777-7777-4777-8777-777777777777',
      planHash: 'e'.repeat(64),
    })),
  };
  const service = new CampaignPackageHandoffService(
    new CampaignPackageMapper(new CampaignPackageService()),
    contexts as any,
    executionPlans as any,
    creativePackages as any,
    executionSimulations as any,
  );
  return { service, contexts, executionPlans, creativePackages, executionSimulations, derivedPlan };
}

describe('CampaignPackageHandoffService', () => {
  it('persists context, creative package and derived plan once for a repeated identical package', async () => {
    const { service, contexts, creativePackages, executionSimulations, derivedPlan } = buildService();

    const first = await service.submit(tenantId, packageV1, 'owner:test');
    const second = await service.submit(tenantId, packageV1, 'owner:test');

    expect(contexts.create).toHaveBeenCalledTimes(1);
    expect(creativePackages.appendVersion).toHaveBeenCalledTimes(1);
    expect(executionSimulations.bindTarget).not.toHaveBeenCalled();
    expect(first.campaign_id).toBe(packageV1.package_id);
    expect(first.campaign_context_version).toBe(1);
    expect(first.creative_package_status).toBe('needs_review');
    expect(first.execution_plan_id).toBe(derivedPlan.executionPlanId);
    expect(first.target_binding_status).toBe('PENDING_RESOLUTION');
    expect(first.boundaries).toEqual({
      persisted: true,
      creative_package_persisted: true,
      execution_plan_created: true,
      meta_write_performed: false,
      spend_authorized: false,
      delivery_authorized: false,
    });
    expect(second.package_hash).toBe(first.package_hash);
    expect(second.creative_package_id).toBe(first.creative_package_id);
  });

  it('binds an ad account only through the existing validated target resolver', async () => {
    const { service, executionSimulations } = buildService();
    const result = await service.submit(tenantId, {
      ...packageV1,
      ad_account_id: 'act_929361834160386',
    }, 'owner:test');

    expect(executionSimulations.bindTarget).toHaveBeenCalledWith(
      tenantId,
      packageV1.package_id,
      '55555555-5555-4555-8555-555555555555',
      packageV1.meta_connection_id,
      'act_929361834160386',
    );
    expect(result.target_binding_status).toBe('BOUND');
    expect(result.execution_plan_id).toBe('77777777-7777-4777-8777-777777777777');
  });

  it('rejects a version gap before changing internal state', async () => {
    const { service, contexts, executionPlans, creativePackages } = buildService();
    contexts.findVersion.mockResolvedValue(null);
    contexts.latest.mockResolvedValue(null);

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
    expect(creativePackages.appendVersion).not.toHaveBeenCalled();
  });

  it('rejects changed content under the same external package version', async () => {
    const { service, contexts, executionPlans } = buildService();
    contexts.findVersion.mockResolvedValue({ version: 1, contentHash: '0'.repeat(64) });

    await expect(service.submit(tenantId, {
      ...packageV1,
      ads: [{ ...packageV1.ads[0], primary_text: 'Texto alterado sem nova versão.' }],
    }, 'owner:test')).rejects.toMatchObject({ response: expect.objectContaining({
      code: 'campaign_package_version_conflict',
    }) });
    expect(executionPlans.generate).not.toHaveBeenCalled();
  });
});
