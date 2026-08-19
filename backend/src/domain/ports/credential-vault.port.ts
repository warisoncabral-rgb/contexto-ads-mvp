export interface CredentialVaultPort {
  isAvailable(): Promise<boolean>;
  putSecret(tenantId: string, secret: string): Promise<string>; // retorna credentialRef
  getSecret(tenantId: string, credentialRef: string): Promise<string>;
  revokeSecret(tenantId: string, credentialRef: string): Promise<void>;
}
