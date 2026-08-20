import { GoogleSecretManagerCredentialVaultAdapter } from './google-secret-manager-credential-vault.adapter';

const TENANT_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_TENANT_ID = '123e4567-e89b-42d3-a456-426614174001';
const PROJECT_ID = 'contexto-ads-test';

function clientMock() {
  return {
    createSecret: jest.fn(),
    addSecretVersion: jest.fn(),
    accessSecretVersion: jest.fn(),
    deleteSecret: jest.fn(),
  };
}

describe('GoogleSecretManagerCredentialVaultAdapter', () => {
  it('checks only the permissions required by vault operations', async () => {
    const client = clientMock();
    const permissionClient = { request: jest.fn().mockResolvedValue({ data: {
      permissions: [
        'secretmanager.secrets.create',
        'secretmanager.versions.add',
        'secretmanager.versions.access',
        'secretmanager.secrets.delete',
      ],
    } }) };
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never, permissionClient as never);

    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(permissionClient.request).toHaveBeenCalledWith({
      url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:testIamPermissions`,
      method: 'POST',
      data: { permissions: expect.arrayContaining([
        'secretmanager.secrets.create',
        'secretmanager.versions.add',
        'secretmanager.versions.access',
        'secretmanager.secrets.delete',
      ]) },
    });
    expect(client.accessSecretVersion).not.toHaveBeenCalled();
  });

  it('reports unavailable when a required permission is missing or IAM fails', async () => {
    const client = clientMock();
    const permissionClient = { request: jest.fn().mockResolvedValue({ data: { permissions: ['secretmanager.versions.access'] } }) };
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never, permissionClient as never);
    await expect(adapter.isAvailable()).resolves.toBe(false);
    permissionClient.request.mockRejectedValue(new Error('provider detail'));
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it('creates one secret and its first version and returns a latest reference', async () => {
    const client = clientMock();
    client.createSecret.mockResolvedValue([{}]);
    client.addSecretVersion.mockResolvedValue([{}]);
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);

    const reference = await adapter.putSecret(TENANT_ID, 'access-token');

    expect(reference).toMatch(new RegExp(`^gcp-sm://projects/${PROJECT_ID}/secrets/contexto-meta-${TENANT_ID}-[0-9a-f-]{36}/versions/latest$`));
    const createRequest = client.createSecret.mock.calls[0][0];
    expect(client.addSecretVersion).toHaveBeenCalledWith({
      parent: `projects/${PROJECT_ID}/secrets/${createRequest.secretId}`,
      payload: { data: Buffer.from('access-token') },
    });
  });

  it('deletes the empty secret if adding its first version fails', async () => {
    const client = clientMock();
    client.createSecret.mockResolvedValue([{}]);
    client.addSecretVersion.mockRejectedValue(new Error('raw provider error'));
    client.deleteSecret.mockResolvedValue([{}]);
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);

    await expect(adapter.putSecret(TENANT_ID, 'token')).rejects.toThrow('Credential Vault operation failed');
    expect(client.deleteSecret).toHaveBeenCalledWith({
      name: expect.stringMatching(`^projects/${PROJECT_ID}/secrets/contexto-meta-${TENANT_ID}-`),
    });
  });

  it('does not expose provider errors when cleanup also fails', async () => {
    const client = clientMock();
    client.createSecret.mockResolvedValue([{}]);
    client.addSecretVersion.mockRejectedValue(new Error('raw add error'));
    client.deleteSecret.mockRejectedValue(new Error('raw cleanup error'));
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);

    await expect(adapter.putSecret(TENANT_ID, 'token')).rejects.toThrow('Credential Vault operation failed');
  });

  it('reads only the latest version for a tenant-scoped reference', async () => {
    const client = clientMock();
    client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from('token') } }]);
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);
    const ref = `gcp-sm://projects/${PROJECT_ID}/secrets/contexto-meta-${TENANT_ID}-123e4567-e89b-42d3-a456-426614174099/versions/latest`;

    await expect(adapter.getSecret(TENANT_ID, ref)).resolves.toBe('token');
    expect(client.accessSecretVersion).toHaveBeenCalledWith({ name: ref.slice('gcp-sm://'.length) });
  });

  it('rejects invalid and cross-tenant references before calling Google', async () => {
    const client = clientMock();
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);
    const otherRef = `gcp-sm://projects/${PROJECT_ID}/secrets/contexto-meta-${OTHER_TENANT_ID}-123e4567-e89b-42d3-a456-426614174099/versions/latest`;

    await expect(adapter.getSecret(TENANT_ID, otherRef)).rejects.toThrow('Invalid credential reference');
    await expect(adapter.getSecret(TENANT_ID, 'projects/other/secrets/value')).rejects.toThrow('Invalid credential reference');
    expect(client.accessSecretVersion).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant IDs before any Google operation', async () => {
    const client = clientMock();
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);
    await expect(adapter.putSecret('not-a-uuid', 'token')).rejects.toThrow('Invalid tenantId');
    expect(client.createSecret).not.toHaveBeenCalled();
  });

  it('deletes the secret on revoke and treats not found as success', async () => {
    const client = clientMock();
    client.deleteSecret.mockResolvedValueOnce([{}]).mockRejectedValueOnce({ code: 5 });
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);
    const ref = `gcp-sm://projects/${PROJECT_ID}/secrets/contexto-meta-${TENANT_ID}-123e4567-e89b-42d3-a456-426614174099/versions/latest`;

    await expect(adapter.revokeSecret(TENANT_ID, ref)).resolves.toBeUndefined();
    await expect(adapter.revokeSecret(TENANT_ID, ref)).resolves.toBeUndefined();
    expect(client.deleteSecret).toHaveBeenCalledWith({
      name: ref.slice('gcp-sm://'.length, -'/versions/latest'.length),
    });
  });

  it('sanitizes access and revoke provider errors', async () => {
    const client = clientMock();
    client.accessSecretVersion.mockRejectedValue(new Error('sensitive provider detail'));
    client.deleteSecret.mockRejectedValue(new Error('sensitive provider detail'));
    const adapter = new GoogleSecretManagerCredentialVaultAdapter(PROJECT_ID, client as never);
    const ref = `gcp-sm://projects/${PROJECT_ID}/secrets/contexto-meta-${TENANT_ID}-123e4567-e89b-42d3-a456-426614174099/versions/latest`;

    await expect(adapter.getSecret(TENANT_ID, ref)).rejects.toThrow('Credential Vault operation failed');
    await expect(adapter.revokeSecret(TENANT_ID, ref)).rejects.toThrow('Credential Vault operation failed');
  });
});
