import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Contexto Ads retry-safe strategy-first GPT Action contract', () => {
  const schema = readFileSync(
    join(
      process.cwd(),
      'docs/contexto-ads-generator-action.gpt.openapi.v1.0.21-retry-safe-handoff.yaml',
    ),
    'utf8',
  );

  it('exposes automatic strategy submission and recovery', () => {
    expect(schema).toContain('version: 1.0.21-retry-safe-handoff');
    expect(schema).toContain('/operator/campaign-strategies/v1/action-submit:');
    expect(schema).toContain('operationId: submitCampaignPackage');
    expect(schema).toContain('/operator/campaign-packages/v1/action-status:');
    expect(schema).toContain('operationId: recoverCampaignPackageStatus');
  });

  it('forces the latest explicit conversation approval to supersede older versions', () => {
    expect(schema).toContain('LATEST_EXPLICIT_CONVERSATION_APPROVAL');
    expect(schema).toContain('Always use the latest explicit user-approved values in the current conversation');
    expect(schema).toContain('later approvals');
    expect(schema).toContain('supersede earlier campaign versions');
  });

  it('documents deterministic retry safety after uncertain transport results', () => {
    expect(schema).toContain('An identical retry of the');
    expect(schema).toContain('same strategy is idempotent');
    expect(schema).toContain('Exact retries are');
    expect(schema).toContain('safe and reuse the same deterministic campaign identity');
    expect(schema).toContain('idempotency_status:');
  });

  it('does not require technical package or media metadata from Contexto Ads', () => {
    const strategySection = schema.split('ApprovedCampaignStrategyV1:')[1]
      .split('NoWriteBoundaries:')[0];

    expect(strategySection).not.toContain('package_id:');
    expect(strategySection).not.toContain('client_id:');
    expect(strategySection).not.toContain('checksum:');
    expect(strategySection).not.toContain('mime_type:');
    expect(strategySection).not.toContain('width:');
    expect(strategySection).not.toContain('height:');
    expect(strategySection).toContain('creative_brief:');
    expect(schema).toContain('Do not block on package/client IDs, final copy, checksums, MIME');
  });

  it('keeps publication, external writes, Meta writes and spend disabled', () => {
    expect(schema).toMatch(/publication_authorized:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/external_writes_allowed:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/meta_write_performed:\s*\n\s*type: boolean\s*\n\s*const: false/);
    expect(schema).toMatch(/spend_authorized:\s*\n\s*type: boolean\s*\n\s*const: false/);
  });
});