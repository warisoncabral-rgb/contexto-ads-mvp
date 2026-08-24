import { Pool } from 'pg';
import { PostgresCredentialVaultAdapter } from './postgres-credential-vault.adapter';

describe('PostgresCredentialVaultAdapter', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const secret = '{"accessToken":"server-only-secret"}';
  const records = new Map<string, {
    tenantId: string;
    ciphertext: Buffer;
    initializationVector: Buffer;
    authenticationTag: Buffer;
    keyVersion: number;
    revoked: boolean;
  }>();
  const query = jest.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('to_regclass')) {
      return { rows: [{ relation: 'credential_vault_secrets' }] };
    }
    if (sql.includes('insert into credential_vault_secrets')) {
      const [id, tenant, ciphertext, iv, tag, keyVersion] = values!;
      records.set(id as string, {
        tenantId: tenant as string,
        ciphertext: Buffer.from(ciphertext as Buffer),
        initializationVector: Buffer.from(iv as Buffer),
        authenticationTag: Buffer.from(tag as Buffer),
        keyVersion: keyVersion as number,
        revoked: false,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('select ciphertext')) {
      const [tenant, id] = values!;
      const record = records.get(id as string);
      if (!record || record.tenantId !== tenant || record.revoked) return { rows: [] };
      return { rows: [{
        ciphertext: record.ciphertext,
        initialization_vector: record.initializationVector,
        authentication_tag: record.authenticationTag,
        key_version: record.keyVersion,
      }] };
    }
    if (sql.includes('update credential_vault_secrets')) {
      const [tenant, id] = values!;
      const record = records.get(id as string);
      if (record && record.tenantId === tenant) record.revoked = true;
      return { rows: [], rowCount: record ? 1 : 0 };
    }
    throw new Error('Unexpected query');
  });
  const pool = { query } as unknown as Pool;
  let vault: PostgresCredentialVaultAdapter;

  beforeEach(() => {
    records.clear();
    query.mockClear();
    vault = new PostgresCredentialVaultAdapter(pool, Buffer.alloc(32, 7));
  });

  it('reports availability only when its migrated table exists', async () => {
    await expect(vault.isAvailable()).resolves.toBe(true);
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(vault.isAvailable()).resolves.toBe(false);
  });

  it('stores authenticated ciphertext and returns only an opaque reference', async () => {
    const credentialRef = await vault.putSecret(tenantId, secret);
    const record = [...records.values()][0];

    expect(credentialRef).toMatch(/^postgres-vault:\/\/[0-9a-f-]{36}$/);
    expect(record.ciphertext.toString('utf8')).not.toContain('server-only-secret');
    expect(record.initializationVector).toHaveLength(12);
    expect(record.authenticationTag).toHaveLength(16);
    await expect(vault.getSecret(tenantId, credentialRef)).resolves.toBe(secret);
  });

  it('binds ciphertext to its tenant and credential reference', async () => {
    const credentialRef = await vault.putSecret(tenantId, secret);
    await expect(vault.getSecret(otherTenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );
  });

  it('rejects tampered ciphertext', async () => {
    const credentialRef = await vault.putSecret(tenantId, secret);
    const record = [...records.values()][0];
    record.ciphertext[0] ^= 1;

    await expect(vault.getSecret(tenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );
  });

  it('revokes idempotently and never returns a revoked secret', async () => {
    const credentialRef = await vault.putSecret(tenantId, secret);
    await vault.revokeSecret(tenantId, credentialRef);
    await vault.revokeSecret(tenantId, credentialRef);
    await expect(vault.getSecret(tenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );
  });

  it('accepts only a canonical 32-byte base64 master key', () => {
    const encoded = Buffer.alloc(32, 9).toString('base64');
    expect(PostgresCredentialVaultAdapter.decodeMasterKey(encoded)).toHaveLength(32);
    expect(() => PostgresCredentialVaultAdapter.decodeMasterKey('not-a-key')).toThrow();
    expect(() => PostgresCredentialVaultAdapter.decodeMasterKey(Buffer.alloc(31).toString('base64'))).toThrow();
  });
});
