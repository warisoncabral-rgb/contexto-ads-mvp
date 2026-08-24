import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  KeyObject,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { Pool } from 'pg';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const KEY_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_PREFIX = 'postgres-vault://';
const VAULT_ERROR = 'Credential Vault operation failed';

interface VaultSecretRow {
  ciphertext: Buffer;
  initialization_vector: Buffer;
  authentication_tag: Buffer;
  key_version: number;
}

export class PostgresCredentialVaultAdapter implements CredentialVaultPort {
  private readonly key: KeyObject;

  constructor(
    private readonly pool: Pool,
    masterKey: Buffer,
  ) {
    if (masterKey.length !== KEY_LENGTH) {
      throw new Error('Credential Vault master key must contain exactly 32 bytes');
    }
    this.key = createSecretKey(Buffer.from(masterKey));
    masterKey.fill(0);
  }

  static decodeMasterKey(encodedKey: string): Buffer {
    const normalized = encodedKey.trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) {
      throw new Error('Credential Vault master key must be base64-encoded');
    }
    const key = Buffer.from(normalized, 'base64');
    if (key.length !== KEY_LENGTH || key.toString('base64') !== normalized) {
      key.fill(0);
      throw new Error('Credential Vault master key must contain exactly 32 bytes');
    }
    return key;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ relation: string | null }>(
        "select to_regclass('public.credential_vault_secrets')::text as relation",
      );
      return result.rows[0]?.relation === 'credential_vault_secrets';
    } catch {
      return false;
    }
  }

  async putSecret(tenantId: string, secret: string): Promise<string> {
    const normalizedTenantId = this.validateUuid(tenantId, 'tenantId');
    if (!secret) throw new Error(VAULT_ERROR);

    const credentialId = randomUUID();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(this.additionalAuthenticatedData(normalizedTenantId, credentialId));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    try {
      await this.pool.query(
        `insert into credential_vault_secrets (
          credential_id, tenant_id, ciphertext, initialization_vector,
          authentication_tag, key_version
        ) values ($1, $2, $3, $4, $5, $6)`,
        [
          credentialId,
          normalizedTenantId,
          ciphertext,
          iv,
          authenticationTag,
          KEY_VERSION,
        ],
      );
      return `${REFERENCE_PREFIX}${credentialId}`;
    } catch {
      throw new Error(VAULT_ERROR);
    } finally {
      ciphertext.fill(0);
    }
  }

  async getSecret(tenantId: string, credentialRef: string): Promise<string> {
    const normalizedTenantId = this.validateUuid(tenantId, 'tenantId');
    const credentialId = this.parseCredentialRef(credentialRef);

    try {
      const result = await this.pool.query<VaultSecretRow>(
        `select ciphertext, initialization_vector, authentication_tag, key_version
        from credential_vault_secrets
        where tenant_id = $1 and credential_id = $2 and revoked_at is null`,
        [normalizedTenantId, credentialId],
      );
      const row = result.rows[0];
      if (!row || row.key_version !== KEY_VERSION) throw new Error(VAULT_ERROR);

      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        row.initialization_vector,
        { authTagLength: AUTH_TAG_LENGTH },
      );
      decipher.setAAD(this.additionalAuthenticatedData(normalizedTenantId, credentialId));
      decipher.setAuthTag(row.authentication_tag);
      const plaintext = Buffer.concat([
        decipher.update(row.ciphertext),
        decipher.final(),
      ]);
      try {
        return plaintext.toString('utf8');
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new Error(VAULT_ERROR);
    }
  }

  async revokeSecret(tenantId: string, credentialRef: string): Promise<void> {
    const normalizedTenantId = this.validateUuid(tenantId, 'tenantId');
    const credentialId = this.parseCredentialRef(credentialRef);
    try {
      await this.pool.query(
        `update credential_vault_secrets
        set revoked_at = coalesce(revoked_at, now())
        where tenant_id = $1 and credential_id = $2`,
        [normalizedTenantId, credentialId],
      );
    } catch {
      throw new Error(VAULT_ERROR);
    }
  }

  private additionalAuthenticatedData(tenantId: string, credentialId: string): Buffer {
    return Buffer.from(`${tenantId}:${credentialId}:v${KEY_VERSION}`, 'utf8');
  }

  private parseCredentialRef(credentialRef: string): string {
    if (!credentialRef.startsWith(REFERENCE_PREFIX)) {
      throw new Error('Invalid credential reference');
    }
    return this.validateUuid(
      credentialRef.slice(REFERENCE_PREFIX.length),
      'credential reference',
    );
  }

  private validateUuid(value: string, field: string): string {
    if (!UUID_PATTERN.test(value)) throw new Error(`Invalid ${field}`);
    return value.toLowerCase();
  }
}
