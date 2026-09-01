import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GPT Action transport diagnostics contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.22-transport-diagnostics.yaml'),
    'utf8',
  );

  it('exposes raw and authenticated POST diagnostics without replacing handoff operations', () => {
    expect(schema).toContain('operationId: testGeneratorTransportPost');
    expect(schema).toContain('/operator/transport-post-ping:');
    expect(schema).toContain('security: []');
    expect(schema).toContain('operationId: testGeneratorAuthenticatedPost');
    expect(schema).toContain('/operator/action-post-ping:');
    expect(schema).toContain('operationId: submitCampaignPackage');
    expect(schema).toContain('operationId: recoverCampaignPackageStatus');
  });

  it('keeps both diagnostics non-consequential and no-write', () => {
    expect(schema.match(/x-openai-isConsequential: false/g)?.length).toBeGreaterThanOrEqual(4);
    expect(schema).toMatch(/publication_authorized:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/external_writes_allowed:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/meta_write_performed:\s*\n\s*type: boolean\s*\n\s*const: false/);
  });
});
