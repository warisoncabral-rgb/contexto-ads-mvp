import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';
  const connection: MetaConnection = {
    tenantId,
    connectionId,
    provider: 'meta',
    status: 'authorization_pending',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  let connections: jest.Mocked<Pick<MetaConnectionService, 'getConnection'>>;
  let service: ReadinessService;

  beforeEach(() => {
    connections = {
      getConnection: jest.fn().mockResolvedValue(connection),
    };
    service = new ReadinessService(connections as unknown as MetaConnectionService);
  });

  it('returns pending OAuth readiness for a persisted authorization_pending connection', async () => {
    const result = await service.getConnectionReadiness(tenantId, connectionId);

    expect(result).toEqual(expect.objectContaining({
      tenantId,
      connectionId,
      blockers: ['meta_oauth_not_configured'],
      checks: [expect.objectContaining({ key: 'meta_oauth', status: 'pending' })],
    }));
  });

  it('queries the persisted connection using tenantId and connectionId', async () => {
    await service.getConnectionReadiness(tenantId, connectionId);

    expect(connections.getConnection).toHaveBeenCalledWith(tenantId, connectionId);
  });

  it('returns not found when the connection does not exist for the tenant', async () => {
    connections.getConnection.mockRejectedValueOnce(new NotFoundException('Meta connection not found'));

    await expect(service.getConnectionReadiness(tenantId, connectionId))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves bad request for an invalid tenantId', async () => {
    connections.getConnection.mockRejectedValueOnce(
      new BadRequestException('tenantId must be a valid UUID'),
    );

    await expect(service.getConnectionReadiness('tenant-1', connectionId))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
