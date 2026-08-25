import { OperatorMetaController } from './operator-meta.controller';
import { OperatorAccessService } from './operator-access.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { MetaOAuthService } from '../meta-oauth/meta-oauth.service';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { ReadinessService } from '../readiness/readiness.service';

describe('OperatorMetaController', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const connectionId = '33333333-3333-4333-8333-333333333333';
  let access: { authorizeTenantConfiguration: jest.Mock };
  let connections: { beginConnection: jest.Mock; getConnection: jest.Mock;
    listAssets: jest.Mock; discoverAssets: jest.Mock; selectAssets: jest.Mock };
  let oauth: { start: jest.Mock };
  let capabilities: { validateReadOnly: jest.Mock };
  let readiness: { runReadOnlySmokeTest: jest.Mock; latestReadOnlySmokeTest: jest.Mock };
  let controller: OperatorMetaController;

  beforeEach(() => {
    access = { authorizeTenantConfiguration: jest.fn().mockResolvedValue({}) };
    connections = {
      beginConnection: jest.fn().mockResolvedValue({ connectionId }),
      getConnection: jest.fn(), listAssets: jest.fn(), discoverAssets: jest.fn(),
      selectAssets: jest.fn(),
    };
    oauth = { start: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://www.facebook.com/v26.0/dialog/oauth?state=safe',
      expiresAt: '2026-08-24T20:10:00.000Z',
    }) };
    capabilities = { validateReadOnly: jest.fn() };
    readiness = { runReadOnlySmokeTest: jest.fn(), latestReadOnlySmokeTest: jest.fn() };
    controller = new OperatorMetaController(
      access as unknown as OperatorAccessService,
      connections as unknown as MetaConnectionService,
      oauth as unknown as MetaOAuthService,
      capabilities as unknown as CapabilityRegistryService,
      readiness as unknown as ReadinessService,
    );
  });

  it('authorizes membership before creating the OAuth attempt', async () => {
    const result = await controller.startOAuth(tenantId, 'Bearer secret');

    expect(access.authorizeTenantConfiguration).toHaveBeenCalledWith(
      'Bearer secret', tenantId,
    );
    expect(access.authorizeTenantConfiguration.mock.invocationCallOrder[0])
      .toBeLessThan(connections.beginConnection.mock.invocationCallOrder[0]);
    expect(oauth.start).toHaveBeenCalledWith(tenantId, connectionId);
    expect(result).toEqual(expect.objectContaining({
      connectionId,
      boundaries: expect.objectContaining({
        requestedScopesAreReadOnly: true,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      }),
    }));
  });

  it('authorizes membership before running the real read-only smoke test', async () => {
    readiness.runReadOnlySmokeTest.mockResolvedValue({ status: 'passed' });

    await controller.smokeTest(tenantId, connectionId, 'Bearer secret');

    expect(access.authorizeTenantConfiguration).toHaveBeenCalledWith(
      'Bearer secret', tenantId,
    );
    expect(readiness.runReadOnlySmokeTest).toHaveBeenCalledWith(tenantId, connectionId);
  });

  it('authorizes membership before selecting discovered assets', async () => {
    const assets = [{ assetType: 'ad_account', externalId: 'act_123' }];
    connections.selectAssets.mockResolvedValue({ assets });

    await controller.selectAssets(tenantId, connectionId, { assets }, 'Bearer secret');

    expect(access.authorizeTenantConfiguration).toHaveBeenCalledWith(
      'Bearer secret', tenantId,
    );
    expect(access.authorizeTenantConfiguration.mock.invocationCallOrder[0])
      .toBeLessThan(connections.selectAssets.mock.invocationCallOrder[0]);
    expect(connections.selectAssets).toHaveBeenCalledWith(tenantId, connectionId, assets);
  });
});
