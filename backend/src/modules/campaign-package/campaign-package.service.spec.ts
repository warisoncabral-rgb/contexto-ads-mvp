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
  ads: [
    {
      ad_reference: 'AD_01',
      primary_text: 'Conheça nossa linha de atacado.',
      cta: 'WHATSAPP_MESSAGE',
      initial_message: 'Olá! Quero conhecer o atacado.',
      media_id: 'MEDIA_01',
    },
  ],
  media: [
    {
      media_id: 'MEDIA_01',
      media_type: 'image',
      source: 'approved_asset',
      file_reference: 'asset://rosa-vip/media-01',
      checksum: 'sha256:example',
    },
  ],
  strategy_status: 'COMPLETE',
  handoff_status: 'READY_FOR_GENERATOR',
  meta_connection_id: '33333333-3333-4333-8333-333333333333',
};

describe('CampaignPackageService', () => {
  const service = new CampaignPackageService();

  it('accepts a complete V1 package without authorizing external effects', () => {
    const result = service.validate(validPackage);

    expect(result.validation_status).toBe('VALID');
    expect(result.handoff_status).toBe('ACCEPTED_BY_GENERATOR');
    expect(result.package_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.external_effects).toEqual({
      meta_write_performed: false,
      spend_authorized: false,
      delivery_authorized: false,
    });
  });

  it('rejects handoff while strategy is not complete', () => {
    const result = service.validate({ ...validPackage, strategy_status: 'IN_REVIEW' });

    expect(result.validation_status).toBe('INVALID');
    expect(result.blocking_reasons).toContain('strategy_status must be COMPLETE before handoff');
  });

  it('rejects an ad whose media reference does not exist', () => {
    const result = service.validate({
      ...validPackage,
      ads: [{ ...validPackage.ads[0], media_id: 'MEDIA_MISSING' }],
    });

    expect(result.validation_status).toBe('INVALID');
    expect(result.blocking_reasons).toContain('ads[0].media_id does not reference an existing media item');
  });

  it('keeps Meta assets as warnings at submission time because they may be resolved by the Generator', () => {
    const result = service.validate(validPackage);

    expect(result.warnings).toEqual(expect.arrayContaining([
      'ad_account_id will need to be resolved before execution',
      'facebook_page_id will need to be resolved before execution',
      'whatsapp_asset_id will need to be resolved before execution',
    ]));
  });
});
