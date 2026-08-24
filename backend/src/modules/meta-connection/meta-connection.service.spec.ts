import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import {
  MetaAssetBindingStore,
  MetaConnectionStore,
} from '../../domain/ports/repositories';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaConnectionService } from './meta-connection.service';

describe('MetaConnectionService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const missingConnectionId = '33333333-3333-4333-8333-333333333333';
  const meta = {
    validateConnection: jest.fn(),
    discoverAssets: jest.fn(),
  } as unknown as jest.Mocked<MetaReadonlyAdapter>;
  let saved: MetaConnection | undefined;
  let repository: jest.Mocked<MetaConnectionStore & MetaAssetBindingStore>;
  let service: MetaConnectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    saved = undefined;
    repository = {
      save: jest.fn(async (connection: MetaConnection) => { saved = connection; }),
      findById: jest.fn(async (_tenantId: string, _connectionId: string) => saved ?? null),
      markConnected: jest.fn().mockResolvedValue(true),
      replaceBindings: jest.fn().mockResolvedValue(undefined),
      listBindings: jest.fn().mockResolvedValue([]),
    };
    service = new MetaConnectionService(meta, repository);
  });

  it('persists a tenant-scoped authorization_pending connection', async () => {
    const result = await service.beginConnection(tenantId);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(expect.objectContaining({
      connectionId: expect.any(String),
      tenantId,
      provider: 'meta',
      status: 'authorization_pending',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }));
    expect(saved).not.toHaveProperty('credentialRef');
    expect(result).toEqual(expect.objectContaining({
      connectionId: saved?.connectionId,
      status: 'authorization_pending',
      nextAction: 'configure_meta_app_and_oauth',
      externalWritePerformed: false,
    }));
  });

  it('returns a connection using tenantId and connectionId', async () => {
    await service.beginConnection(tenantId);
    const result = await service.getConnection(tenantId, saved!.connectionId);

    expect(repository.findById).toHaveBeenCalledWith(tenantId, saved!.connectionId);
    expect(result).toEqual(saved);
  });

  it('returns not found when the tenant-scoped connection does not exist', async () => {
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.getConnection(otherTenantId, missingConnectionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an invalid tenantId before saving a connection', async () => {
    await expect(service.beginConnection('tenant-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid tenantId before querying a connection', async () => {
    await expect(service.getConnection('tenant-1', 'connection-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('rejects an invalid connectionId before querying a connection', async () => {
    await expect(service.getConnection(tenantId, 'connection-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('discovers and atomically replaces tenant-scoped asset bindings', async () => {
    saved = {
      connectionId: missingConnectionId,
      tenantId,
      provider: 'meta',
      status: 'connected',
      credentialRef: 'postgres-vault://44444444-4444-4444-8444-444444444444',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    meta.discoverAssets.mockResolvedValueOnce({
      success: true,
      data: [{
        tenantId: otherTenantId,
        connectionId: '55555555-5555-4555-8555-555555555555',
        assetType: 'ad_account',
        externalId: 'act_123',
        displayName: 'Main account',
        selected: true,
        observedAt: '2000-01-01T00:00:00.000Z',
      }],
      observedAt: '2026-08-24T01:00:00.000Z',
      retryable: false,
    });

    const result = await service.discoverAssets(tenantId, missingConnectionId);

    expect(meta.discoverAssets).toHaveBeenCalledWith(saved.credentialRef, tenantId);
    expect(repository.replaceBindings).toHaveBeenCalledWith(
      tenantId,
      missingConnectionId,
      [expect.objectContaining({
        tenantId,
        connectionId: missingConnectionId,
        selected: false,
        observedAt: '2026-08-24T01:00:00.000Z',
      })],
    );
    expect(JSON.stringify(result)).not.toContain(saved.credentialRef!);
  });

  it('does not persist a failed discovery result', async () => {
    saved = {
      connectionId: missingConnectionId,
      tenantId,
      provider: 'meta',
      status: 'connected',
      credentialRef: 'postgres-vault://44444444-4444-4444-8444-444444444444',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    meta.discoverAssets.mockResolvedValueOnce({
      success: false,
      observedAt: '2026-08-24T01:00:00.000Z',
      retryable: false,
      normalizedError: 'AUTH_PERMISSION',
    });

    await expect(service.discoverAssets(tenantId, missingConnectionId)).resolves
      .toEqual(expect.objectContaining({ success: false }));
    expect(repository.replaceBindings).not.toHaveBeenCalled();
  });

  it('blocks discovery before OAuth has connected the account', async () => {
    await service.beginConnection(tenantId);
    await expect(service.discoverAssets(tenantId, saved!.connectionId)).rejects
      .toBeInstanceOf(ConflictException);
    expect(meta.discoverAssets).not.toHaveBeenCalled();
  });

  it('lists assets only after validating the tenant-scoped connection', async () => {
    await service.beginConnection(tenantId);
    await service.listAssets(tenantId, saved!.connectionId);
    expect(repository.findById).toHaveBeenCalledWith(tenantId, saved!.connectionId);
    expect(repository.listBindings).toHaveBeenCalledWith(tenantId, saved!.connectionId);
  });
});
