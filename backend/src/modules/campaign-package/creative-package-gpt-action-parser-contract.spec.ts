import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Creative Package GPT Action parser-compatible contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'docs/contexto-ads-generator-action.gpt.openapi.v1.0.25-parser-compatible.yaml'),
    'utf8',
  );

  it('keeps Bearer authentication and the creative lifecycle', () => {
    expect(schema).toContain('version: 1.0.25-parser-compatible');
    expect(schema).toContain('scheme: bearer');
    expect(schema).toContain('operationId: getAuthorizedTenants');
    expect(schema).toContain('operationId: createCreativePackage');
    expect(schema).toContain('operationId: getLatestCreativePackage');
    expect(schema).toContain('operationId: approveCreativePackage');
  });

  it('uses inline path parameters instead of parameter refs', () => {
    expect(schema).toContain('- name: tenantId');
    expect(schema).toContain('- name: campaignId');
    expect(schema).toContain('- name: executionPlanId');
    expect(schema).not.toContain("$ref: '#/components/parameters/");
    expect(schema).not.toContain('\n  parameters:\n    TenantId:');
  });

  it('uses explicit response schemas instead of an empty generic envelope', () => {
    expect(schema).not.toContain('GenericEnvelope');
    expect(schema).toContain('PingResponse:');
    expect(schema).toContain('CampaignSubmitResponse:');
    expect(schema).toContain('CampaignStatusResponse:');
    expect(schema).toContain('TenantWorkspaceResponse:');
    expect(schema).toContain('CreativeMutationResponse:');
    expect(schema).toContain('CreativePackageV1:');
  });

  it('keeps exact media metadata and internal-only approval boundaries', () => {
    expect(schema).toContain("pattern: '^[0-9a-f]{64}$'");
    expect(schema).toContain('- assetId');
    expect(schema).toContain('- storageRef');
    expect(schema).toContain('- sha256');
    expect(schema).toContain('x-openai-isConsequential: true');
    expect(schema).toContain('Approval does not authorize Meta publication, activation, delivery or spend.');
  });
});
