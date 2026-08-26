import { ConflictException } from '@nestjs/common';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { CapabilityRepository } from '../../domain/ports/repositories';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { CapabilityRegistryService } from './capability-registry.service';

describe('CapabilityRegistryService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';
  const credentialRef = 'postgres-vault://33333333-3333-4333-8333-333333333333';
  const connected: MetaConnection = {
    tenantId,
    connectionId,
    provider: 'meta',
    status: 'connected',
    credentialRef,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };
  const connections = {
    getConnection: jest.fn(),
    listAssets: jest.fn(),
  } as unknown as jest.Mocked<MetaConnectionService>;
  const meta = {
    validateCapabilities: jest.fn(),
  } as unknown as jest.Mocked<MetaReadonlyAdapter>;
  const capabilities = {
    replaceForConnection: jest.fn(),
    listForConnection: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<CapabilityRepository>;
  const service = new CapabilityRegistryService(connections, meta, capabilities);

  beforeEach(() => {
    jest.clearAllMocks();
    connections.getConnection.mockResolvedValue(connected);
    connections.listAssets.mockResolvedValue([]);
    capabilities.listForConnection.mockResolvedValue([]);
  });

  it('validates the tenant-scoped connection before listing capabilities', async () => {
    await service.list(tenantId, connectionId);
    expect(connections.getConnection).toHaveBeenCalledWith(tenantId, connectionId);
    expect(capabilities.listForConnection).toHaveBeenCalledWith(tenantId, connectionId);
    expect(connections.getConnection.mock.invocationCallOrder[0])
      .toBeLessThan(capabilities.listForConnection.mock.invocationCallOrder[0]);
  });

  it('does not query capabilities when connection validation fails', async () => {
    connections.getConnection.mockRejectedValueOnce(new Error('not found'));
    await expect(service.list(tenantId, connectionId)).rejects.toThrow('not found');
    expect(capabilities.listForConnection).not.toHaveBeenCalled();
  });

  it('validates and atomically persists read-only capability evidence', async () => {
    connections.listAssets.mockResolvedValueOnce([{
      tenantId,
      connectionId,
      assetType: 'ad_account',
      externalId: 'act_123',
      selected: false,
      observedAt: '2026-08-24T01:00:00.000Z',
    }]);
    meta.validateCapabilities.mockResolvedValueOnce({
      success: true,
      data: [{
        capability: 'DISCOVER_ASSETS',
        available: false,
        requiredPermissions: ['ads_read', 'pages_show_list'],
        grantedPermissions: ['ads_read'],
        apiVersion: 'v26.0',
        reason: 'permission_missing',
      }, {
        capability: 'READ_AD_ACCOUNT',
        available: true,
        requiredPermissions: ['ads_read'],
        grantedPermissions: ['ads_read'],
        apiVersion: 'v26.0',
        assetScope: 'act_123',
      }],
      observedAt: '2026-08-24T02:00:00.000Z',
      retryable: false,
    });

    const result = await service.validateReadOnly(tenantId, connectionId);

    expect(meta.validateCapabilities).toHaveBeenCalledWith(
      tenantId,
      credentialRef,
      expect.arrayContaining([expect.objectContaining({ externalId: 'act_123' })]),
      ['DISCOVER_ASSETS', 'READ_AD_ACCOUNT'],
    );
    expect(capabilities.replaceForConnection).toHaveBeenCalledWith(
      tenantId,
      connectionId,
      [expect.objectContaining({
        capabilityType: 'DISCOVER_ASSETS',
        status: 'permission_missing',
        restrictions: ['missing_permission:pages_show_list'],
        validatedAt: '2026-08-24T02:00:00.000Z',
      }), expect.objectContaining({
        capabilityType: 'READ_AD_ACCOUNT',
        assetScope: 'act_123',
        status: 'available',
        restrictions: [],
      })],
    );
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(JSON.stringify(result)).not.toContain(credentialRef);
  });

  it('preserves the previous snapshot when Meta validation fails', async () => {
    meta.validateCapabilities.mockResolvedValueOnce({
      success: false,
      observedAt: '2026-08-24T02:00:00.000Z',
      retryable: true,
      normalizedError: 'TRANSIENT_API',
    });

    await expect(service.validateReadOnly(tenantId, connectionId)).resolves.toEqual(
      expect.objectContaining({ success: false, normalizedError: 'TRANSIENT_API' }),
    );
    expect(capabilities.replaceForConnection).not.toHaveBeenCalled();
  });

  it('collects a complete execution-readiness snapshot without performing writes', async () => {
    meta.validateCapabilities.mockResolvedValueOnce({
      success: true,
      data: [{
        capability: 'CREATE_CAMPAIGN',
        available: false,
        requiredPermissions: ['ads_management'],
        grantedPermissions: [],
        apiVersion: 'v26.0',
        reason: 'permission_missing',
      }, {
        capability: 'CLICK_TO_WHATSAPP',
        available: false,
        requiredPermissions: ['ads_management'],
        grantedPermissions: ['ads_management'],
        apiVersion: 'v26.0',
        assetScope: 'act_123',
        reason: 'asset_missing',
      }],
      observedAt: '2026-08-24T02:00:00.000Z',
      retryable: false,
    });

    await service.validateForExecution(tenantId, connectionId);

    expect(meta.validateCapabilities).toHaveBeenCalledWith(
      tenantId,
      credentialRef,
      [],
      ['DISCOVER_ASSETS', 'READ_AD_ACCOUNT', 'CREATE_CAMPAIGN', 'CREATE_ADSET',
        'CREATE_CREATIVE', 'CREATE_AD', 'CLICK_TO_WHATSAPP'],
    );
    expect(capabilities.replaceForConnection).toHaveBeenCalledWith(
      tenantId,
      connectionId,
      expect.arrayContaining([
        expect.objectContaining({ capabilityType: 'CREATE_CAMPAIGN',
          restrictions: ['missing_permission:ads_management'] }),
        expect.objectContaining({ capabilityType: 'CLICK_TO_WHATSAPP',
          restrictions: ['missing_selected_facebook_page_or_whatsapp'] }),
      ]),
    );
  });

  it('blocks capability validation before OAuth has connected the account', async () => {
    connections.getConnection.mockResolvedValueOnce({
      ...connected,
      status: 'authorization_pending',
      credentialRef: undefined,
    });

    await expect(service.validateReadOnly(tenantId, connectionId)).rejects
      .toBeInstanceOf(ConflictException);
    expect(connections.listAssets).not.toHaveBeenCalled();
    expect(meta.validateCapabilities).not.toHaveBeenCalled();
  });
});
