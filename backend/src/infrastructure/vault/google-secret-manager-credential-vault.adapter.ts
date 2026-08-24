import { randomUUID } from 'node:crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { GoogleAuth } from 'google-auth-library';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';

const REQUIRED_PERMISSIONS = [
  'secretmanager.secrets.create',
  'secretmanager.versions.add',
  'secretmanager.versions.access',
  'secretmanager.secrets.delete',
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VAULT_ERROR = 'Credential Vault operation failed';

type SecretManagerClient = Pick<
  SecretManagerServiceClient,
  | 'createSecret'
  | 'addSecretVersion'
  | 'accessSecretVersion'
  | 'deleteSecret'
>;

type PermissionClient = Pick<GoogleAuth, 'request'>;

export class GoogleSecretManagerCredentialVaultAdapter implements CredentialVaultPort {
  private readonly parent: string;

  constructor(
    private readonly projectId: string,
    private readonly client: SecretManagerClient = new SecretManagerServiceClient(),
    private readonly permissionClient: PermissionClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }),
  ) {
    if (!projectId.trim()) {
      throw new Error('Google Secret Manager project is not configured');
    }
    this.parent = `projects/${projectId}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.permissionClient.request<{ permissions?: string[] }>({
        url: `https://cloudresourcemanager.googleapis.com/v1/${this.parent}:testIamPermissions`,
        method: 'POST',
        data: { permissions: [...REQUIRED_PERMISSIONS] },
      });
      const granted = new Set(response.data.permissions ?? []);
      return REQUIRED_PERMISSIONS.every((permission) => granted.has(permission));
    } catch {
      return false;
    }
  }

  async putSecret(tenantId: string, secret: string): Promise<string> {
    const normalizedTenantId = this.validateTenantId(tenantId);
    const secretId = `contexto-meta-${normalizedTenantId}-${randomUUID()}`;
    const secretName = `${this.parent}/secrets/${secretId}`;
    let created = false;

    try {
      await this.client.createSecret({
        parent: this.parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
      created = true;
      await this.client.addSecretVersion({
        parent: secretName,
        payload: { data: Buffer.from(secret, 'utf8') },
      });
      return `gcp-sm://${secretName}/versions/latest`;
    } catch {
      if (created) {
        try {
          await this.client.deleteSecret({ name: secretName });
        } catch {
          // The empty secret contains no credential; cleanup can be retried operationally.
        }
      }
      throw new Error(VAULT_ERROR);
    }
  }

  async getSecret(tenantId: string, credentialRef: string): Promise<string> {
    const versionName = this.validateCredentialRef(tenantId, credentialRef);
    try {
      const [version] = await this.client.accessSecretVersion({ name: versionName });
      const data = version.payload?.data;
      if (data === undefined || data === null) {
        throw new Error(VAULT_ERROR);
      }
      return Buffer.from(data as Uint8Array).toString('utf8');
    } catch {
      throw new Error(VAULT_ERROR);
    }
  }

  async revokeSecret(tenantId: string, credentialRef: string): Promise<void> {
    const versionName = this.validateCredentialRef(tenantId, credentialRef);
    const secretName = versionName.slice(0, -'/versions/latest'.length);
    try {
      await this.client.deleteSecret({ name: secretName });
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw new Error(VAULT_ERROR);
    }
  }

  private validateCredentialRef(tenantId: string, credentialRef: string): string {
    const normalizedTenantId = this.validateTenantId(tenantId);
    const expectedPrefix = `gcp-sm://${this.parent}/secrets/contexto-meta-${normalizedTenantId}-`;
    const suffix = '/versions/latest';
    if (!credentialRef.startsWith(expectedPrefix) || !credentialRef.endsWith(suffix)) {
      throw new Error('Invalid credential reference');
    }
    const instanceId = credentialRef.slice(expectedPrefix.length, -suffix.length);
    if (!UUID_PATTERN.test(instanceId)) {
      throw new Error('Invalid credential reference');
    }
    return credentialRef.slice('gcp-sm://'.length);
  }

  private validateTenantId(tenantId: string): string {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new Error('Invalid tenantId');
    }
    return tenantId.toLowerCase();
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 5;
  }
}
