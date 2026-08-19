import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaConnectionStore } from '../../domain/ports/repositories';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaConnectionService } from './meta-connection.service';

describe('MetaConnectionService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const missingConnectionId = '33333333-3333-4333-8333-333333333333';
  const meta = { validateConnection: jest.fn() } as unknown as MetaReadonlyAdapter;
  let saved: MetaConnection | undefined;
  let repository: jest.Mocked<MetaConnectionStore>;
  let service: MetaConnectionService;

  beforeEach(() => {
    saved = undefined;
    repository = {
      save: jest.fn(async (connection: MetaConnection) => { saved = connection; }),
      findById: jest.fn(async (_tenantId: string, _connectionId: string) => saved ?? null),
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
});
