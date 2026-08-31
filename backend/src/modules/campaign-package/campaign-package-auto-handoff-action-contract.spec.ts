import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Contexto Ads automatic Generator handoff Action contract', () => {
  const contract = readFileSync(
    join(process.cwd(), 'docs', 'contexto-ads-generator-action.gpt.openapi.v1.0.19-auto-handoff.yaml'),
    'utf8',
  );

  it('exposes the real persisted handoff and recovery operations', () => {
    expect(contract).toContain('/operator/campaign-packages/v1/action-submit:');
    expect(contract).toContain('operationId: submitCampaignPackage');
    expect(contract).toContain('/operator/campaign-packages/v1/action-status:');
    expect(contract).toContain('operationId: recoverCampaignPackageStatus');
  });

  it('instructs the GPT to submit automatically before declaring completion', () => {
    expect(contract).toContain('submit the approved Campaign Package before telling the user the campaign is finished');
    expect(contract).toContain('Call automatically once the campaign is complete and approved');
  });

  it('supports both approved images and MP4 videos without enabling Meta writes', () => {
    expect(contract).toContain('media_type: { type: string, enum: [image, video] }');
    expect(contract).toContain('mime_type: { type: string, enum: [image/jpeg, image/png, video/mp4] }');
    expect(contract).toContain('publication_authorized: { type: boolean, const: false }');
    expect(contract).toContain('meta_write_performed: { type: boolean, const: false }');
  });
});
