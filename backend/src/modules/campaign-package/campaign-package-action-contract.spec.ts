import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Contexto Ads Generator Action contract', () => {
  const contract = readFileSync(
    join(process.cwd(), 'docs', 'contexto-ads-generator-action.openapi.yaml'),
    'utf8',
  );

  it('targets the hosted API and exposes only the V1 handoff/status operations', () => {
    expect(contract).toContain('https://contexto-ads-validation-api.onrender.com/v1');
    expect(contract).toContain('operationId: submitCampaignPackage');
    expect(contract).toContain('operationId: getCampaignPackageStatus');
    expect(contract).toContain('/operator/tenants/{tenantId}/campaign-packages/v1/submit:');
    expect(contract).toContain('/operator/tenants/{tenantId}/campaign-packages/v1/{packageId}/status:');
  });

  it('requires the frozen V1 strategy and keeps submission separate from Meta effects', () => {
    expect(contract).toContain('campaign_objective: { type: string, const: LEADS }');
    expect(contract).toContain('conversion_destination: { type: string, const: WHATSAPP }');
    expect(contract).toContain('strategy_status: { type: string, const: COMPLETE }');
    expect(contract).toContain('handoff_status: { type: string, const: READY_FOR_GENERATOR }');
    expect(contract).toContain('meta_write_performed: { type: boolean, const: false }');
    expect(contract).toContain('spend_authorized: { type: boolean, const: false }');
    expect(contract).toContain('delivery_authorized: { type: boolean, const: false }');
  });

  it('requires immutable media identity needed by the validated Generator creative flow', () => {
    expect(contract).toContain('required: [media_id, media_type, source, file_reference, checksum, mime_type, width, height]');
    expect(contract).toContain("checksum: { type: string, pattern: '^(sha256:)?[0-9a-fA-F]{64}$' }");
    expect(contract).toContain('mime_type: { type: string, enum: [image/jpeg, image/png] }');
  });
});
