import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GPT Action v1.0.27 client-safe contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.27-client-safe.yaml'),
    'utf8',
  );

  it('uses OpenAPI 3.0.3 and Bearer auth', () => {
    expect(schema).toContain('openapi: 3.0.3');
    expect(schema).toContain('scheme: bearer');
  });

  it('keeps all critical workflow operations as POST actions', () => {
    for (const operation of [
      'testGeneratorAuthenticatedPost',
      'submitCampaignPackage',
      'recoverCampaignPackageStatus',
      'prepareCreativePackage',
      'reviewCreativePackage',
      'getFinalCampaignReview',
      'finalizeCampaignForPublication',
      'publishCampaign',
    ]) expect(schema).toContain(`operationId: ${operation}`);
  });

  it('does not use component schema refs or empty generic envelopes', () => {
    expect(schema).not.toContain("$ref: '#/components/schemas/");
    expect(schema).not.toContain('GenericEnvelope');
    expect(schema).not.toContain('ActionResponse');
  });

  it('keeps publication separate and consequential', () => {
    expect(schema).toContain('operationId: publishCampaign');
    expect(schema).toContain('enum: [PUBLISH_CAMPAIGN]');
  });
});
