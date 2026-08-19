import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';

const UNAVAILABLE_MESSAGE = 'Credential Vault is not configured';

export class UnavailableCredentialVaultAdapter implements CredentialVaultPort {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async putSecret(_tenantId: string, _secret: string): Promise<string> {
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  async getSecret(_tenantId: string, _credentialRef: string): Promise<string> {
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  async revokeSecret(_tenantId: string, _credentialRef: string): Promise<void> {
    throw new Error(UNAVAILABLE_MESSAGE);
  }
}
