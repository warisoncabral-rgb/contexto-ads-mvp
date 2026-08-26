import { ConflictException } from '@nestjs/common';
import { CampaignPackageMapper } from './campaign-package.mapper';
import { CampaignPackageService } from './campaign-package.service';

const validPackage = {
  package_id: '11111111-1111-4111-8111-111111111111',
  package_version: 1,
  created_at: '2026-08-26T20:00:00.000Z',
  source: 'contexto_ads',
  client_id: '22222222-2222-4222-8222-222222222222',
  business_name: 'Rosa VIP',
  business_description: 'Marca de calçados com operação de atacado.',
  offer_name: 'Calçados no atacado',
  offer_description: 'Oferta para geração de contatos de lojistas e revendedores.',
  offer_type: 'lead_generation',
  campaign_objective: 'LEADS',
  conversion_destination: 'WHATSAPP',
  campaign_goal_description: 'Gerar contatos qualificados pelo WhatsApp.',
  audience_description: 'Lojistas, sacoleiros e revendedores.',
  locations: [
    { city: 'Recife', state: 'PE', country: 'BR', radius_km: 40 },
    { city: 'Natal', state: 'RN', country: 'BR', radius_km: 40 },
  ],
  budget_type: 'DAILY',
  budget_amount: 10,
  currency: 'BRL',
  duration_days: 7,
  ads: [{
    ad_reference: 'AD_01',
    primary_text: 'Conheça nossa linha de atacado.',
    cta: 'WHATSAPP_MESSAGE',
    initial_message: 'Olá! Quero conhecer o atacado.',
    media_id: 'MEDIA_01',
  }],
  media: [{
    media_id: 'MEDIA_01',
    media_type: 'image',
    source: 'approved_asset',
    file_reference: 'asset://rosa-vip/media-01',
    checksum: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }],
  strategy_status: 'COMPLETE',
  handoff_status: 'READY_FOR_GENERATOR',
  meta_connection_id: '33333333-3333-4333-8333-333333333333',
};

describe('CampaignPackageMapper', () => {
  const mapper = new CampaignPackageMapper(new CampaignPackageService());

  it('maps a valid handoff into existing generator inputs without persisting or writing', () => {
    const result = mapper.prepare(validPackage);

    expect(result.generator_inputs.campaign_context).toMatchObject({
      businessName: 'Rosa VIP',
      objective: 'leads',
      destination: 'whatsapp',
      geography: 'Recife, PE, BR (40 km); Natal, RN, BR (40 km)',
      budget: { mode: 'daily', amountMinor: 1000, currency: 'BRL' },
      durationDays: 7,
    });
    expect((result.generator_inputs.creative_package.copies as unknown[])).toHaveLength(1);
    expect((result.generator_inputs.creative_package.assets as unknown[])).toHaveLength(1);
    expect(result.boundaries).toEqual({
      persisted: false,
      execution_plan_created: false,
      meta_write_performed: false,
      spend_authorized: false,
      delivery_authorized: false,
    });
  });

  it('fails closed when preparation receives an invalid package', () => {
    expect(() => mapper.prepare({ ...validPackage, strategy_status: 'IN_REVIEW' }))
      .toThrow(ConflictException);
  });
});
