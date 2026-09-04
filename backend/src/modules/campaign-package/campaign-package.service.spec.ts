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
  whatsapp_number: '+5583999999999',
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
      headline: 'Calçados no atacado',
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
      checksum: `sha256:${'a'.repeat(64)}`,
      mime_type: 'image/jpeg',
      width: 1080,
      height: 1350,
    },
  ],
  strategy_status: 'COMPLETE',
  handoff_status: 'READY_FOR_GENERATOR',
  meta_connection_id: '33333333-3333-4333-8333-333333333333',
};

describe('CampaignPackageService', () => {
  const service = new CampaignPackageService();

  it('accepts a complete executable V1 package without authorizing external effects', () => {
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

  it('requires the WhatsApp number when WhatsApp is the destination', () => {
    const { whatsapp_number, ...withoutNumber } = validPackage;
    const result = service.validate(withoutNumber);
    expect(result.validation_status).toBe('INVALID');
    expect(result.missing_fields).toContain('whatsapp_number');
  });

  it('accepts Instagram by direct profile link without requiring a technical Meta id', () => {
    const result = service.validate({
      ...validPackage,
      campaign_objective: 'ENGAGEMENT',
      conversion_destination: 'INSTAGRAM',
      instagram_url: 'https://www.instagram.com/contextoads/',
      whatsapp_number: undefined,
      ads: [{
        ...validPackage.ads[0],
        cta: 'LEARN_MORE',
        initial_message: undefined,
      }],
    });
    expect(result.validation_status).toBe('VALID');
    expect(result.warnings).toContain('instagram_account_id will need to be resolved before execution');
  });

  it('accepts Facebook Page by direct link', () => {
    const result = service.validate({
      ...validPackage,
      campaign_objective: 'ENGAGEMENT',
      conversion_destination: 'FACEBOOK_PAGE',
      facebook_page_url: 'https://www.facebook.com/contextoads',
      whatsapp_number: undefined,
      ads: [{
        ...validPackage.ads[0],
        cta: 'LEARN_MORE',
        initial_message: undefined,
      }],
    });
    expect(result.validation_status).toBe('VALID');
    expect(result.warnings).toContain('facebook_page_id will need to be resolved before execution');
  });

  it('rejects a social link that points to the wrong network', () => {
    const result = service.validate({
      ...validPackage,
      conversion_destination: 'INSTAGRAM',
      instagram_url: 'https://www.facebook.com/contextoads',
      whatsapp_number: undefined,
      ads: [{ ...validPackage.ads[0], cta: 'LEARN_MORE', initial_message: undefined }],
    });
    expect(result.validation_status).toBe('INVALID');
    expect(result.blocking_reasons).toContain('instagram_url must point to Instagram');
  });

  it('accepts an MP4 video referenced by an ad', () => {
    const result = service.validate({
      ...validPackage,
      media: [{
        ...validPackage.media[0],
        media_type: 'video',
        mime_type: 'video/mp4',
        file_reference: 'asset://rosa-vip/video-01',
      }],
    });

    expect(result.validation_status).toBe('VALID');
    expect(result.handoff_status).toBe('ACCEPTED_BY_GENERATOR');
  });

  it('rejects media_type and mime_type mismatches', () => {
    const result = service.validate({
      ...validPackage,
      media: [{ ...validPackage.media[0], media_type: 'video', mime_type: 'image/jpeg' }],
    });

    expect(result.validation_status).toBe('INVALID');
    expect(result.blocking_reasons).toContain(
      'media[0].mime_type must match media_type (image/jpeg, image/png or video/mp4)',
    );
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

  it('rejects media metadata that cannot be consumed by the validated creative core', () => {
    const result = service.validate({
      ...validPackage,
      media: [{ ...validPackage.media[0], checksum: 'unknown', width: 0 }],
    });

    expect(result.validation_status).toBe('INVALID');
    expect(result.blocking_reasons).toContain('media[0].checksum must be SHA-256');
    expect(result.missing_fields).toContain('media[0].width');
  });

  it('requires the WhatsApp copy fields used by the current Generator creative package', () => {
    const result = service.validate({
      ...validPackage,
      ads: [{ ...validPackage.ads[0], headline: '', initial_message: '' }],
    });

    expect(result.validation_status).toBe('INVALID');
    expect(result.missing_fields).toEqual(expect.arrayContaining([
      'ads[0].headline',
      'ads[0].initial_message',
    ]));
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
