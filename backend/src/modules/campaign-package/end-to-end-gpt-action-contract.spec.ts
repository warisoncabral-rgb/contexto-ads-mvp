import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('End-to-end GPT Action contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.26-end-to-end.yaml'),
    'utf8',
  );

  it('uses Bearer and POST-only critical actions', () => {
    expect(schema).toContain('version: 1.0.26-end-to-end');
    expect(schema).toContain('scheme: bearer');
    expect(schema).toContain('operationId: prepareCreativePackage');
    expect(schema).toContain('operationId: getFinalCampaignReview');
    expect(schema).toContain('operationId: finalizeCampaignForPublication');
    expect(schema).toContain('operationId: publishCampaign');
    expect(schema).not.toContain('operationId: getAuthorizedTenants');
  });

  it('uses the official GPT Action file parameter', () => {
    expect(schema).toContain('openaiFileIdRefs:');
    expect(schema).toContain('runtime do GPT substitui os IDs');
    expect(schema).not.toContain('required: [assetId, storageRef, sha256, mimeType, width, height]');
  });

  it('keeps final publication separately consequential', () => {
    expect(schema).toContain('const: CONFIRM_AND_PREPARE_FOR_PUBLICATION');
    expect(schema).toContain('const: PUBLISH_CAMPAIGN');
    expect(schema).toContain('Esta operação pode iniciar entrega e gasto na Meta.');
  });

  it('does not expose path tenant parameters or empty generic schemas', () => {
    expect(schema).not.toContain('{tenantId}');
    expect(schema).not.toContain('GenericEnvelope');
    expect(schema).toContain('ActionResponse:');
    expect(schema).toContain('properties:');
  });
});
