import { NotFoundException } from '@nestjs/common';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaConnectionStore } from '../../domain/ports/repositories';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaConnectionService } from './meta-connection.service';

describe('MetaConnectionService', () => {
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
    const result = await service.beginConnection('tenant-1');

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(expect.objectContaining({
      connectionId: expect.any(String),
      tenantId: 'tenant-1',
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
    await service.beginConnection('tenant-1');
    const result = await service.getConnection('tenant-1', saved!.connectionId);

    expect(repository.findById).toHaveBeenCalledWith('tenant-1', saved!.connectionId);
    expect(result).toEqual(saved);
  });

  it('returns not found when the tenant-scoped connection does not exist', async () => {
    repository.findById.mockResolvedValueOnce(null);

    await expect(service.getConnection('tenant-2', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
