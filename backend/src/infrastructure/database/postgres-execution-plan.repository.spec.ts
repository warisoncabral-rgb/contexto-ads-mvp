import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { PostgresExecutionPlanRepository } from './postgres-execution-plan.repository';

describe('PostgresExecutionPlanRepository', () => {
  const plan = {
    executionPlanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    campaignPackageVersion: 1,
    planVersion: '1.0',
    correlationId: '44444444-4444-4444-8444-444444444444',
    planHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    status: 'draft',
    meta: { assetBindings: [], requiredCapabilities: ['CREATE_CAMPAIGN'] },
    objectsToCreate: [],
    readiness: [],
    autonomy: { level: 'A0', approvalRequired: true },
    financials: {
      currency: 'BRL',
      budgetMode: 'daily',
      configuredAmountMinor: 1000,
      maximumPlannedSpendMinor: 7000,
      calculation: '1000 x 7 days',
    },
    decisions: [],
    risks: [],
    externalEffects: { writesAllowed: false, writesPerformed: false },
    createdAt: '2026-08-24T07:00:00.000Z',
  } as ExecutionPlanV1;
  const query = jest.fn();
  const clientQuery = jest.fn();
  const release = jest.fn();
  const repository = new PostgresExecutionPlanRepository({
    query,
    connect: jest.fn().mockResolvedValue({ query: clientQuery, release } as unknown as PoolClient),
  } as unknown as Pool);
  const event: AuditEvent = {
    auditEventId: '55555555-5555-4555-8555-555555555555',
    tenantId: plan.tenantId,
    correlationId: plan.correlationId,
    actorType: 'user',
    actorId: 'operator:warison',
    eventType: 'operator_execution_plan_generated',
    objectType: 'execution_plan',
    objectId: plan.executionPlanId,
    result: 'success',
    createdAt: plan.createdAt,
  };

  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset();
    release.mockReset();
  });

  it('inserts by idempotency key and returns the persisted plan', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: plan }] });

    await expect(repository.saveIdempotent(plan)).resolves.toEqual(plan);
    expect(query.mock.calls[0][0]).toContain('on conflict do nothing');
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('where idempotency_key = $1 and tenant_id = $2'),
      [plan.idempotencyKey, plan.tenantId, plan.campaignId],
    ]);
  });

  it('returns the original persisted plan after an idempotency conflict', async () => {
    const original = { ...plan, executionPlanId: '55555555-5555-4555-8555-555555555555' };
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payload: original }] });

    await expect(repository.saveIdempotent(plan)).resolves.toEqual(original);
  });

  it('commits a new plan and operator audit evidence atomically', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ execution_plan_id: plan.executionPlanId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: plan }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.saveIdempotent(plan, event)).resolves.toEqual(plan);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('insert into execution_plans'),
      expect.stringContaining('where idempotency_key = $1 and tenant_id = $2'),
      expect.stringContaining('insert into audit_events'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate generation audit after an idempotency conflict', async () => {
    const original = { ...plan, executionPlanId: '66666666-6666-4666-8666-666666666666' };
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payload: original }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.saveIdempotent(plan, event)).resolves.toEqual(original);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('insert into execution_plans'),
      expect.stringContaining('where idempotency_key = $1 and tenant_id = $2'),
      'commit',
    ]);
  });

  it('loads only the latest plan in tenant scope', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: plan }] });
    await expect(repository.latest(plan.tenantId, plan.campaignId)).resolves.toEqual(plan);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and campaign_id = $2'),
      [plan.tenantId, plan.campaignId],
    );
  });

  it('loads a plan by tenant and execution plan id', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: plan }] });
    await expect(repository.findById(plan.tenantId, plan.executionPlanId))
      .resolves.toEqual(plan);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_plan_id = $2'),
      [plan.tenantId, plan.executionPlanId],
    );
  });

  it('lists one latest plan per campaign inside the tenant scope', async () => {
    const olderCampaign = {
      ...plan,
      campaignId: '77777777-7777-4777-8777-777777777777',
      createdAt: '2026-08-23T07:00:00.000Z',
    };
    query.mockResolvedValueOnce({ rows: [{ payload: olderCampaign }, { payload: plan }] });

    await expect(repository.listLatestForTenant(plan.tenantId))
      .resolves.toEqual([plan, olderCampaign]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('select distinct on (campaign_id) payload'),
      [plan.tenantId],
    );
  });

  it('fails closed if the idempotency invariant cannot be resolved', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.saveIdempotent(plan)).rejects
      .toThrow('Execution plan idempotency invariant failed');
  });
});
