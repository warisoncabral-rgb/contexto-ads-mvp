import { CapabilityRepository } from '../../domain/ports/repositories';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { CapabilityRegistryService } from './capability-registry.service';

describe('CapabilityRegistryService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';
  const connections = { getConnection: jest.fn() } as unknown as jest.Mocked<MetaConnectionService>;
  const capabilities = {
    replaceForConnection: jest.fn(),
    listForConnection: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<CapabilityRepository>;
  const service = new CapabilityRegistryService(connections, capabilities);

  beforeEach(() => jest.clearAllMocks());

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
});
