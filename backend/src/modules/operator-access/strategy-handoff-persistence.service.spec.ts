import { ConflictException } from '@nestjs/common';
import { StrategyHandoffPersistenceService } from './strategy-handoff-persistence.service';

const tenantId = '22222222-2222-4222-8222-222222222222';
const campaignId = '11111111-1111-4111-8111-111111111111';
const input = {
  businessName: 'Rosa VIP Calçados',
  offer: 'Calçados femininos no atacado',
  objective: 'leads',
  audience: 'Lojistas e revendedores focados em qualidade',
  destination: 'whatsapp',
  geography: 'Incluir João Pessoa, PB, BR (40 km); Incluir Recife, PE, BR (40 km)',
  budget: { mode: 'daily', amountMinor: 2000, currency: 'BRL' },
  durationDays: 7,
};

describe('StrategyHandoffPersistenceService', () => {
  it('persists the deterministic campaign context on first submit', async () => {
    const repository = {
      findVersion: jest.fn(async () => null),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const service = new StrategyHandoffPersistenceService(repository as any);

    const result = await service.createOrGet(tenantId, campaignId, input, 'operator:test');

    expect(result.campaignId).toBe(campaignId);
    expect(result.version).toBe(1);
    expect(result.status).toBe('ready_for_generation');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create.mock.calls[0][0]).toMatchObject({
      tenantId,
      campaignId,
      version: 1,
      validationIssues: [],
    });
    expect(repository.create.mock.calls[0][1]).toMatchObject({
      eventType: 'operator_strategy_handoff_persisted',
      newState: {
        campaignId,
        deterministicIdentity: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
    });
  });

  it('returns the existing version for an identical retry instead of creating a duplicate', async () => {
    const seedRepository = {
      findVersion: jest.fn(async () => null),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const seedService = new StrategyHandoffPersistenceService(seedRepository as any);
    const existing = await seedService.createOrGet(tenantId, campaignId, input, 'operator:test');

    const repository = {
      findVersion: jest.fn(async () => existing),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const service = new StrategyHandoffPersistenceService(repository as any);
    const retry = await service.createOrGet(tenantId, campaignId, input, 'operator:test');

    expect(retry).toBe(existing);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('fails closed if the same deterministic identity points to different content', async () => {
    const seedRepository = {
      findVersion: jest.fn(async () => null),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const seedService = new StrategyHandoffPersistenceService(seedRepository as any);
    const existing = await seedService.createOrGet(tenantId, campaignId, input, 'operator:test');

    const repository = {
      findVersion: jest.fn(async () => existing),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const service = new StrategyHandoffPersistenceService(repository as any);

    await expect(service.createOrGet(
      tenantId,
      campaignId,
      { ...input, durationDays: 8 },
      'operator:test',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('recovers safely from a concurrent insert race when the persisted content matches', async () => {
    const seedRepository = {
      findVersion: jest.fn(async () => null),
      create: jest.fn(async (_context: unknown, _event?: unknown) => undefined),
    };
    const seedService = new StrategyHandoffPersistenceService(seedRepository as any);
    const existing = await seedService.createOrGet(tenantId, campaignId, input, 'operator:test');

    const repository = {
      findVersion: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing),
      create: jest.fn(async (_context: unknown, _event?: unknown) => {
        throw new Error('duplicate key');
      }),
    };
    const service = new StrategyHandoffPersistenceService(repository as any);

    const result = await service.createOrGet(tenantId, campaignId, input, 'operator:test');

    expect(result).toBe(existing);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
});