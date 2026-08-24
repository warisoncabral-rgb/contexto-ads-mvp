import { Pool, PoolClient } from 'pg';
import { CampaignContextPackageV1 } from '../../domain/contracts/campaign-context';
import { PostgresCampaignContextRepository } from './postgres-campaign-context.repository';

describe('PostgresCampaignContextRepository', () => {
  const context: CampaignContextPackageV1 = {
    packageId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    version: 1,
    schemaVersion: '1.0',
    status: 'needs_information',
    facts: {},
    inferences: [],
    validationIssues: [{
      code: 'required_fact_missing',
      field: 'offer',
      severity: 'blocker',
      message: 'Missing offer',
      nextAction: 'Provide offer',
    }],
    contentHash: 'a'.repeat(64),
    createdAt: '2026-08-24T05:00:00.000Z',
  };
  const clientQuery = jest.fn();
  const release = jest.fn();
  const poolQuery = jest.fn();
  const pool = {
    connect: jest.fn().mockResolvedValue({ query: clientQuery, release } as unknown as PoolClient),
    query: poolQuery,
  } as unknown as Pool;
  const repository = new PostgresCampaignContextRepository(pool);

  beforeEach(() => {
    clientQuery.mockReset();
    poolQuery.mockReset();
    release.mockReset();
  });

  it('creates the campaign and first version in one transaction', async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await repository.create(context);

    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('insert into campaigns'),
      expect.stringContaining('insert into campaign_context_versions'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent version allocation by locking the campaign row', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ campaign_id: context.campaignId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ next_version: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const result = await repository.appendNext(context);

    expect(clientQuery.mock.calls[1][0]).toContain('for update');
    expect(result).toEqual({ ...context, version: 2 });
  });

  it('returns null without inserting when the tenant-scoped campaign is absent', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.appendNext(context)).resolves.toBeNull();
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('where tenant_id = $1 and campaign_id = $2'),
      'rollback',
    ]);
  });

  it('loads only the latest package inside the tenant scope', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{
      package_id: context.packageId,
      tenant_id: context.tenantId,
      campaign_id: context.campaignId,
      version: context.version,
      schema_version: context.schemaVersion,
      status: context.status,
      facts: context.facts,
      inferences: context.inferences,
      validation_issues: context.validationIssues,
      content_hash: context.contentHash,
      created_at: new Date(context.createdAt),
    }] });

    await expect(repository.latest(context.tenantId, context.campaignId))
      .resolves.toEqual(context);
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and campaign_id = $2'),
      [context.tenantId, context.campaignId],
    );
  });

  it('rolls back a failed create and always releases the client', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('database failure'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.create(context)).rejects.toThrow('database failure');
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
