import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';
import { PostgresCredentialVaultAdapter } from '../vault/postgres-credential-vault.adapter';
import { PostgresCapabilityRepository } from './postgres-capability.repository';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL integration', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const connectionId = randomUUID();

  beforeAll(async () => {
    for (const migration of [
      '001_foundation.sql',
      '002_meta_oauth_attempts.sql',
      '003_meta_oauth_credential_compensations.sql',
      '004_postgres_credential_vault.sql',
      '005_tenant_scoped_asset_bindings.sql',
      '006_tenant_scoped_capability_registry.sql',
    ]) {
      await pool.query(
        await readFile(join(process.cwd(), 'db', 'migrations', migration), 'utf8'),
      );
    }
    await pool.query(
      `insert into meta_connections (
        connection_id, tenant_id, status, created_at, updated_at
      ) values ($1, $2, 'authorization_pending', now(), now())`,
      [connectionId, tenantId],
    );
  });

  afterAll(async () => {
    await pool.query('delete from credential_vault_secrets where tenant_id = any($1::uuid[])', [
      [tenantId, otherTenantId],
    ]);
    await pool.query('delete from meta_asset_bindings where tenant_id = $1', [tenantId]);
    await pool.query('delete from capability_registry where tenant_id = $1', [tenantId]);
    await pool.query('delete from meta_oauth_attempts where tenant_id = $1', [tenantId]);
    await pool.query('delete from meta_connections where tenant_id = $1', [tenantId]);
    await pool.end();
  });

  it('atomically allows only one consumer for an OAuth state', async () => {
    const repository = new PostgresMetaOAuthAttemptRepository(pool);
    const stateHash = 'a'.repeat(64);
    const now = new Date();
    await repository.replaceActive({
      attemptId: randomUUID(),
      tenantId,
      connectionId,
      stateHash,
      requestedScopes: ['public_profile'],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.consumeActive(stateHash)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('stores no plaintext and enforces tenant isolation and revocation', async () => {
    const vault = new PostgresCredentialVaultAdapter(pool, Buffer.alloc(32, 7));
    const secret = '{"accessToken":"integration-only-secret"}';
    const credentialRef = await vault.putSecret(tenantId, secret);
    const credentialId = credentialRef.slice('postgres-vault://'.length);

    const persisted = await pool.query<{ ciphertext_text: string }>(
      `select encode(ciphertext, 'escape') as ciphertext_text
      from credential_vault_secrets where credential_id = $1`,
      [credentialId],
    );
    expect(persisted.rows[0].ciphertext_text).not.toContain('integration-only-secret');
    await expect(vault.getSecret(tenantId, credentialRef)).resolves.toBe(secret);
    await expect(vault.getSecret(otherTenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );

    await vault.revokeSecret(tenantId, credentialRef);
    await vault.revokeSecret(tenantId, credentialRef);
    await expect(vault.getSecret(tenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );
  });

  it('replaces asset snapshots and enforces tenant scope in PostgreSQL', async () => {
    const repository = new PostgresMetaConnectionRepository(pool);
    const observedAt = '2026-08-24T01:00:00.000Z';
    await repository.replaceBindings(tenantId, connectionId, [{
      tenantId,
      connectionId,
      assetType: 'ad_account',
      externalId: 'act_123',
      displayName: 'Main account',
      selected: false,
      observedAt,
    }]);

    await expect(repository.listBindings(tenantId, connectionId)).resolves.toEqual([{
      tenantId,
      connectionId,
      assetType: 'ad_account',
      externalId: 'act_123',
      displayName: 'Main account',
      selected: false,
      observedAt,
    }]);

    await expect(pool.query(
      `insert into meta_asset_bindings (
        tenant_id, connection_id, asset_type, external_id, selected, observed_at
      ) values ($1, $2, 'business', 'cross-tenant', false, now())`,
      [otherTenantId, connectionId],
    )).rejects.toThrow();
  });

  it('persists capability evidence and rejects cross-tenant associations', async () => {
    const repository = new PostgresCapabilityRepository(pool);
    const capabilityId = randomUUID();
    const validatedAt = '2026-08-24T02:00:00.000Z';
    await repository.replaceForConnection(tenantId, connectionId, [{
      capabilityId,
      tenantId,
      connectionId,
      capabilityType: 'READ_AD_ACCOUNT',
      assetScope: 'act_123',
      requiredPermissions: ['ads_read'],
      grantedPermissions: ['ads_read'],
      status: 'available',
      apiVersion: 'v26.0',
      restrictions: [],
      validationSource: 'meta_api',
      validatedAt,
    }]);

    await expect(repository.listForConnection(tenantId, connectionId)).resolves
      .toEqual([expect.objectContaining({ capabilityId, tenantId, connectionId })]);

    await expect(pool.query(
      `insert into capability_registry (
        capability_id, tenant_id, connection_id, capability_type,
        required_permissions, granted_permissions, status, restrictions,
        validation_source, validated_at
      ) values ($1, $2, $3, 'DISCOVER_ASSETS', '[]', '[]', 'unknown', '[]',
        'system_rule', now())`,
      [randomUUID(), otherTenantId, connectionId],
    )).rejects.toThrow();
  });
});
