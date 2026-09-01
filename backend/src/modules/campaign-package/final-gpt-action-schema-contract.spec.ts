import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('final GPT Action schema contract', () => {
  const schemaPath = join(
    process.cwd(),
    'docs',
    'contexto-ads-generator-action.gpt.openapi.v1.0.30-final.json',
  );
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as any;

  it('uses the ChatGPT-supported OpenAPI version and a valid HTTPS server', () => {
    expect(schema.openapi).toBe('3.1.0');
    expect(Array.isArray(schema.servers)).toBe(true);
    expect(schema.servers).toHaveLength(1);
    expect(schema.servers[0].url).toBe('https://contexto-ads-validation-api.onrender.com/v1');
  });

  it('keeps components.schemas as an object and Bearer authentication explicit', () => {
    expect(schema.components).toEqual(expect.any(Object));
    expect(schema.components.schemas).toEqual(expect.any(Object));
    expect(schema.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('exposes the complete end-to-end flow plus the one-shot diagnostic', () => {
    const operationIds = Object.values(schema.paths)
      .flatMap((path: any) => Object.values(path))
      .map((operation: any) => operation.operationId)
      .filter(Boolean);

    expect(operationIds).toEqual(expect.arrayContaining([
      'testGeneratorTransportPost',
      'testGeneratorAuthenticatedPost',
      'diagnoseGeneratorIntegration',
      'submitCampaignPackage',
      'recoverCampaignPackageStatus',
      'prepareCreativePackage',
      'reviewCreativePackage',
      'getFinalCampaignReview',
      'finalizeCampaignForPublication',
      'publishCampaign',
    ]));
    expect(operationIds).toHaveLength(10);
  });

  it('keeps publication separate and consequential', () => {
    expect(schema.paths['/operator/campaigns/v1/action-finalize-for-publication'].post['x-openai-isConsequential']).toBe(true);
    expect(schema.paths['/operator/campaigns/v1/action-publish'].post['x-openai-isConsequential']).toBe(true);
    expect(schema.paths['/operator/integration/v1/action-diagnose'].post['x-openai-isConsequential']).toBe(false);
  });
});
