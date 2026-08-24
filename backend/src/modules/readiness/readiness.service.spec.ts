import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { MetaAssetBinding, MetaConnection } from '../../domain/contracts/meta-connection';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import {
  ReadinessRepository,
  SmokeTestReportRepository,
} from '../../domain/ports/repositories';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';
  const credentialRef = 'postgres-vault://33333333-3333-4333-8333-333333333333';
  const values: Record<string, string> = {
    NODE_ENV: 'development',
    META_APP_ID: '123456789',
    META_APP_SECRET: 'server-only-secret',
    META_GRAPH_API_VERSION: 'v26.0',
    META_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/meta/oauth/callback',
  };
  const pending: MetaConnection = {
    tenantId,
    connectionId,
    provider: 'meta',
    status: 'authorization_pending',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };
  const connected: MetaConnection = {
    ...pending,
    status: 'connected',
    credentialRef,
  };
  const adAccount: MetaAssetBinding = {
    tenantId,
    connectionId,
    assetType: 'ad_account',
    externalId: 'act_123',
    displayName: 'Primary ads',
    selected: false,
    observedAt: '2026-08-24T01:00:00.000Z',
  };
  const capabilityRecords: CapabilityRecord[] = [{
    capabilityId: '44444444-4444-4444-8444-444444444444',
    tenantId,
    connectionId,
    capabilityType: 'DISCOVER_ASSETS',
    requiredPermissions: ['ads_read', 'pages_show_list'],
    grantedPermissions: ['ads_read', 'pages_show_list'],
    status: 'available',
    apiVersion: 'v26.0',
    restrictions: [],
    validationSource: 'meta_api',
    validatedAt: '2026-08-24T02:00:00.000Z',
  }, {
    capabilityId: '55555555-5555-4555-8555-555555555555',
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
    validatedAt: '2026-08-24T02:00:00.000Z',
  }];
  let connections: jest.Mocked<MetaConnectionService>;
  let capabilities: jest.Mocked<CapabilityRegistryService>;
  let config: ConfigService;
  let vault: jest.Mocked<CredentialVaultPort>;
  let snapshots: jest.Mocked<ReadinessRepository>;
  let smokeReports: jest.Mocked<SmokeTestReportRepository>;
  let service: ReadinessService;

  beforeEach(() => {
    connections = {
      getConnection: jest.fn().mockResolvedValue(pending),
      listAssets: jest.fn().mockResolvedValue([]),
      validateReadOnly: jest.fn(),
      discoverAssets: jest.fn(),
      readDiscoveredAdAccount: jest.fn(),
    } as unknown as jest.Mocked<MetaConnectionService>;
    capabilities = {
      list: jest.fn().mockResolvedValue([]),
      validateReadOnly: jest.fn(),
    } as unknown as jest.Mocked<CapabilityRegistryService>;
    config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    vault = {
      isAvailable: jest.fn().mockResolvedValue(true),
      putSecret: jest.fn(),
      getSecret: jest.fn(),
      revokeSecret: jest.fn(),
    };
    snapshots = {
      save: jest.fn(),
      latestForConnection: jest.fn().mockResolvedValue(null),
    };
    smokeReports = {
      save: jest.fn(),
      latestForConnection: jest.fn().mockResolvedValue(null),
    };
    service = new ReadinessService(
      connections,
      capabilities,
      config,
      vault,
      snapshots,
      smokeReports,
    );
  });

  it('explains every pending step for an authorization-pending connection', async () => {
    const result = await service.getConnectionReadiness(tenantId, connectionId);

    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'meta_configuration', status: 'passed' }),
      expect.objectContaining({ key: 'credential_vault', status: 'passed' }),
      expect.objectContaining({ key: 'meta_oauth', status: 'pending' }),
      expect.objectContaining({ key: 'asset_discovery', status: 'pending' }),
      expect.objectContaining({ key: 'read_capabilities', status: 'pending' }),
    ]));
    expect(result.blockers).toEqual([
      'meta_oauth_pending',
      'asset_discovery_pending',
      'read_capabilities_pending',
    ]);
  });

  it('reports ready only from tenant-scoped persisted evidence', async () => {
    connections.getConnection.mockResolvedValue(connected);
    connections.listAssets.mockResolvedValue([adAccount]);
    capabilities.list.mockResolvedValue(capabilityRecords);

    const result = await service.getConnectionReadiness(tenantId, connectionId);

    expect(result.blockers).toEqual([]);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(connections.listAssets).toHaveBeenCalledWith(tenantId, connectionId);
    expect(capabilities.list).toHaveBeenCalledWith(tenantId, connectionId);
    expect(JSON.stringify(result)).not.toContain(credentialRef);
    expect(JSON.stringify(result)).not.toContain(values.META_APP_SECRET);
  });

  it('names invalid configuration keys without exposing their values', async () => {
    (config.get as jest.Mock).mockImplementation((key: string) =>
      key === 'META_APP_ID' ? 'invalid-app-id' : values[key]);

    const result = await service.getConnectionReadiness(tenantId, connectionId);
    const check = result.checks.find((item) => item.key === 'meta_configuration');

    expect(check).toEqual(expect.objectContaining({
      status: 'blocked',
      meaning: expect.stringContaining('META_APP_ID'),
    }));
    expect(JSON.stringify(result)).not.toContain('invalid-app-id');
  });

  it('captures and retrieves tenant-scoped readiness evidence', async () => {
    const captured = await service.captureConnectionReadiness(tenantId, connectionId);
    snapshots.latestForConnection.mockResolvedValueOnce(captured);

    await expect(service.latestConnectionReadiness(tenantId, connectionId))
      .resolves.toEqual(captured);
    expect(snapshots.save).toHaveBeenCalledWith(captured);
    expect(snapshots.latestForConnection).toHaveBeenCalledWith(tenantId, connectionId);
  });

  it('runs the complete read-only smoke test in a guarded sequence', async () => {
    connections.getConnection.mockResolvedValue(connected);
    connections.validateReadOnly.mockResolvedValue({
      success: true,
      data: { subjectId: '987654321' },
      observedAt: '2026-08-24T03:00:00.000Z',
      retryable: false,
    });
    connections.discoverAssets.mockResolvedValue({
      success: true,
      data: [adAccount],
      observedAt: '2026-08-24T03:01:00.000Z',
      retryable: false,
    });
    capabilities.validateReadOnly.mockResolvedValue({
      success: true,
      data: capabilityRecords,
      observedAt: '2026-08-24T03:02:00.000Z',
      retryable: false,
    });
    connections.readDiscoveredAdAccount.mockResolvedValue({
      success: true,
      data: { id: 'act_123', name: 'Primary ads' },
      observedAt: '2026-08-24T03:03:00.000Z',
      retryable: false,
    });

    const result = await service.runReadOnlySmokeTest(tenantId, connectionId);

    expect(result).toEqual(expect.objectContaining({
      passed: true,
      blockers: [],
      steps: [
        expect.objectContaining({ key: 'identity', status: 'passed' }),
        expect.objectContaining({ key: 'asset_discovery', status: 'passed' }),
        expect.objectContaining({ key: 'capability_validation', status: 'passed' }),
        expect.objectContaining({ key: 'ad_account_read', status: 'passed' }),
      ],
    }));
    expect(connections.validateReadOnly.mock.invocationCallOrder[0])
      .toBeLessThan(connections.discoverAssets.mock.invocationCallOrder[0]);
    expect(connections.discoverAssets.mock.invocationCallOrder[0])
      .toBeLessThan(capabilities.validateReadOnly.mock.invocationCallOrder[0]);
    expect(capabilities.validateReadOnly.mock.invocationCallOrder[0])
      .toBeLessThan(connections.readDiscoveredAdAccount.mock.invocationCallOrder[0]);
    expect(smokeReports.save).toHaveBeenCalledWith(result);
    expect(JSON.stringify(result)).not.toContain(credentialRef);
  });

  it('blocks smoke testing before external calls when configuration is invalid', async () => {
    connections.getConnection.mockResolvedValue(connected);
    (config.get as jest.Mock).mockImplementation((key: string) =>
      key === 'META_APP_SECRET' ? '' : values[key]);

    await expect(service.runReadOnlySmokeTest(tenantId, connectionId)).resolves.toEqual(
      expect.objectContaining({ passed: false, blockers: ['meta_configuration_blocked'] }),
    );
    expect(vault.isAvailable).not.toHaveBeenCalled();
    expect(connections.validateReadOnly).not.toHaveBeenCalled();
    expect(smokeReports.save).toHaveBeenCalledWith(expect.objectContaining({
      passed: false,
      blockers: ['meta_configuration_blocked'],
    }));
  });

  it('stops the smoke test at the first failed external step', async () => {
    connections.getConnection.mockResolvedValue(connected);
    connections.validateReadOnly.mockResolvedValue({
      success: true,
      data: { subjectId: '987654321' },
      observedAt: '2026-08-24T03:00:00.000Z',
      retryable: false,
    });
    connections.discoverAssets.mockResolvedValue({
      success: false,
      observedAt: '2026-08-24T03:01:00.000Z',
      retryable: true,
      normalizedError: 'TRANSIENT_API',
    });

    await expect(service.runReadOnlySmokeTest(tenantId, connectionId)).resolves.toEqual(
      expect.objectContaining({ passed: false, blockers: ['meta_asset_discovery_failed'] }),
    );
    expect(capabilities.validateReadOnly).not.toHaveBeenCalled();
    expect(connections.readDiscoveredAdAccount).not.toHaveBeenCalled();
  });

  it('retrieves the latest smoke report only after tenant validation', async () => {
    smokeReports.latestForConnection.mockResolvedValueOnce({
      smokeTestId: '66666666-6666-4666-8666-666666666666',
      tenantId,
      connectionId,
      passed: false,
      steps: [],
      blockers: ['meta_oauth_blocked'],
      generatedAt: '2026-08-24T04:00:00.000Z',
    });

    await expect(service.latestReadOnlySmokeTest(tenantId, connectionId)).resolves
      .toEqual(expect.objectContaining({ blockers: ['meta_oauth_blocked'] }));
    expect(connections.getConnection).toHaveBeenCalledWith(tenantId, connectionId);
    expect(smokeReports.latestForConnection).toHaveBeenCalledWith(tenantId, connectionId);
  });

  it('preserves tenant validation errors without running diagnostics', async () => {
    connections.getConnection.mockRejectedValueOnce(
      new NotFoundException('Meta connection not found'),
    );
    await expect(service.getConnectionReadiness(tenantId, connectionId))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(vault.isAvailable).not.toHaveBeenCalled();

    connections.getConnection.mockRejectedValueOnce(
      new BadRequestException('tenantId must be a valid UUID'),
    );
    await expect(service.runReadOnlySmokeTest('tenant-1', connectionId))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(connections.validateReadOnly).not.toHaveBeenCalled();
  });
});
