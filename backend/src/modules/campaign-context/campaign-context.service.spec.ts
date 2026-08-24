import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CampaignContextPackageV1,
  UnversionedCampaignContextPackageV1,
} from '../../domain/contracts/campaign-context';
import { CampaignContextRepository } from '../../domain/ports/repositories';
import { CampaignContextService } from './campaign-context.service';

describe('CampaignContextService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  let repository: jest.Mocked<CampaignContextRepository>;
  let service: CampaignContextService;

  const completeFacts = {
    businessName: 'Contexto Ads',
    offer: 'Gestão profissional de anúncios',
    objective: 'leads',
    audience: 'Pequenas empresas que precisam gerar demanda',
    destination: 'whatsapp',
    geography: 'Brasil',
    budget: { mode: 'daily', amountMinor: 5000, currency: 'BRL' },
    durationDays: 30,
  };

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(undefined),
      appendNext: jest.fn(),
      latest: jest.fn(),
      findVersion: jest.fn(),
    };
    service = new CampaignContextService(repository);
  });

  it('creates a complete immutable package ready for generation', async () => {
    const result = await service.create(tenantId, completeFacts);

    expect(result).toEqual(expect.objectContaining({
      tenantId,
      version: 1,
      schemaVersion: '1.0',
      status: 'ready_for_generation',
      inferences: [],
      validationIssues: [],
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(result.facts.businessName).toEqual(expect.objectContaining({
      value: 'Contexto Ads',
      source: 'user_input',
      evidenceRefs: ['api:user_input'],
    }));
    expect(repository.create).toHaveBeenCalledWith(result);
  });

  it('persists an incomplete draft with explicit actionable blockers', async () => {
    const result = await service.create(tenantId, { businessName: 'Contexto Ads' });

    expect(result.status).toBe('needs_information');
    expect(result.validationIssues).toHaveLength(7);
    expect(result.validationIssues).toContainEqual(expect.objectContaining({
      field: 'budget',
      severity: 'blocker',
      code: 'required_fact_missing',
      nextAction: expect.stringContaining('budget'),
    }));
  });

  it('records no inference when facts are absent', async () => {
    const result = await service.create(tenantId);

    expect(result.facts).toEqual({});
    expect(result.inferences).toEqual([]);
    expect(result.validationIssues).toHaveLength(8);
  });

  it('normalizes user text before hashing and persistence', async () => {
    const first = await service.create(tenantId, {
      ...completeFacts,
      businessName: '  Contexto Ads  ',
    });
    const second = await service.create(tenantId, completeFacts);

    expect(first.facts.businessName?.value).toBe('Contexto Ads');
    expect(first.contentHash).toBe(second.contentHash);
  });

  it.each([
    [{ ...completeFacts, objective: 'profit' }, 'objective'],
    [{ ...completeFacts, durationDays: 0 }, 'durationDays'],
    [{ ...completeFacts, budget: { mode: 'daily', amountMinor: 10.5, currency: 'BRL' } }, 'amountMinor'],
    [{ ...completeFacts, budget: { mode: 'daily', amountMinor: 1000, currency: 'brl' } }, 'currency'],
  ])('rejects malformed facts instead of silently guessing: %s', async (facts, message) => {
    await expect(service.create(tenantId, facts)).rejects.toThrow(message);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant identifiers before persistence', async () => {
    await expect(service.create('tenant-1', completeFacts))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('appends the next full immutable version returned by the repository', async () => {
    repository.appendNext.mockImplementationOnce(async (
      context: UnversionedCampaignContextPackageV1,
    ): Promise<CampaignContextPackageV1> => ({ ...context, version: 2 }));

    const result = await service.appendVersion(tenantId, campaignId, completeFacts);

    expect(result.version).toBe(2);
    expect(result.campaignId).toBe(campaignId);
    expect(repository.appendNext).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      campaignId,
      status: 'ready_for_generation',
    }));
  });

  it('does not disclose a campaign that is absent from the tenant scope', async () => {
    repository.latest.mockResolvedValueOnce(null);
    await expect(service.latest(tenantId, campaignId)).rejects
      .toBeInstanceOf(NotFoundException);
  });

  it('returns not found if a version is appended outside the tenant scope', async () => {
    repository.appendNext.mockResolvedValueOnce(null);
    await expect(service.appendVersion(tenantId, campaignId, completeFacts)).rejects
      .toBeInstanceOf(NotFoundException);
  });
});
