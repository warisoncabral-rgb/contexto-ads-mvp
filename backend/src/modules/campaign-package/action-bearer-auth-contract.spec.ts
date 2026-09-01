import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Contexto Ads GPT Action bearer auth contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.23-bearer-auth.yaml'),
    'utf8',
  );

  it('uses standard HTTP bearer auth for authenticated actions', () => {
    expect(schema).toContain('version: 1.0.23-bearer-auth');
    expect(schema).toContain('bearerAuth:');
    expect(schema).toMatch(/bearerAuth:\s*\n\s*type: http\s*\n\s*scheme: bearer/);
    expect(schema).not.toContain('X-Contexto-Operator-Key');
  });

  it('keeps raw transport ping unauthenticated and authenticated ping protected', () => {
    expect(schema).toContain('operationId: testGeneratorTransportPost');
    expect(schema).toContain('operationId: testGeneratorAuthenticatedPost');
    const raw = schema.split('/operator/transport-post-ping:')[1].split('/operator/action-post-ping:')[0];
    const authenticated = schema.split('/operator/action-post-ping:')[1].split('/operator/campaign-strategies/v1/action-submit:')[0];
    expect(raw).toContain('security: []');
    expect(authenticated).not.toContain('security: []');
  });

  it('preserves handoff, recovery and no-write boundaries', () => {
    expect(schema).toContain('operationId: submitCampaignPackage');
    expect(schema).toContain('operationId: recoverCampaignPackageStatus');
    expect(schema).toContain('LATEST_EXPLICIT_CONVERSATION_APPROVAL');
    expect(schema).toMatch(/publication_authorized:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/meta_write_performed:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/spend_authorized:\s*\n\s*type: boolean\s*\n\s*const: false/);
  });
});
