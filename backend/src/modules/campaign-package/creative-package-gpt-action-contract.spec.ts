import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Creative Package GPT Action contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.24-creative-package.yaml'),
    'utf8',
  );

  it('uses standard bearer authentication', () => {
    expect(schema).toContain('version: 1.0.24-creative-package');
    expect(schema).toContain('type: http');
    expect(schema).toContain('scheme: bearer');
    expect(schema).not.toContain('X-Contexto-Operator-Key');
  });

  it('exposes the creative package lifecycle', () => {
    expect(schema).toContain('operationId: getAuthorizedTenants');
    expect(schema).toContain('operationId: createCreativePackage');
    expect(schema).toContain('operationId: getLatestCreativePackage');
    expect(schema).toContain('operationId: approveCreativePackage');
  });

  it('requires exact media integrity metadata at the creative stage', () => {
    expect(schema).toContain('required: [assetId, storageRef, sha256, mimeType, width, height]');
    expect(schema).toContain("pattern: '^[0-9a-f]{64}$'");
  });

  it('keeps approval internal and Meta execution unauthorized', () => {
    expect(schema).toContain('Approval does not authorize');
    expect(schema).toContain('Meta publication, activation, delivery or spend');
    expect(schema).toContain('x-openai-isConsequential: true');
  });
});
