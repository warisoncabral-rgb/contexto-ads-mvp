'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  GoogleSecretManagerCredentialVaultAdapter,
} = require('../dist/infrastructure/vault/google-secret-manager-credential-vault.adapter');

const VAULT_ERROR = 'Credential Vault operation failed';

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required');
  }

  const tenantId = randomUUID();
  const secretValue = `contexto-pr7-smoke-${randomUUID()}`;
  const adapter = new GoogleSecretManagerCredentialVaultAdapter(projectId);
  let credentialRef;

  try {
    assert.equal(
      await adapter.isAvailable(),
      true,
      'ADC and the four required IAM permissions must be available',
    );

    credentialRef = await adapter.putSecret(tenantId, secretValue);
    assert.ok(
      credentialRef.startsWith(
        `gcp-sm://projects/${projectId}/secrets/contexto-meta-${tenantId}-`,
      ),
      'credentialRef must be project- and tenant-scoped',
    );
    assert.ok(
      credentialRef.endsWith('/versions/latest'),
      'credentialRef must point to the latest version',
    );

    assert.equal(
      await adapter.getSecret(tenantId, credentialRef),
      secretValue,
      'the real Secret Manager round trip must preserve the value',
    );

    await adapter.revokeSecret(tenantId, credentialRef);
    await adapter.revokeSecret(tenantId, credentialRef);
    await assert.rejects(
      () => adapter.getSecret(tenantId, credentialRef),
      new RegExp(VAULT_ERROR),
      'a revoked secret must no longer be readable',
    );

    console.log('PASS: Google Secret Manager smoke test completed');
  } finally {
    if (credentialRef) {
      await adapter.revokeSecret(tenantId, credentialRef);
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
