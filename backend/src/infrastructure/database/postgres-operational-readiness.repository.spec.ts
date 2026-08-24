import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { OperationalReadinessDecisionV1 } from '../../domain/contracts/operational-readiness';
import { PostgresOperationalReadinessRepository } from './postgres-operational-readiness.repository';

describe('PostgresOperationalReadinessRepository', () => {
  const decision: OperationalReadinessDecisionV1 = {
    readinessDecisionId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    planHash: 'a'.repeat(64),
    simulationId: '55555555-5555-4555-8555-555555555555',
    decisionHash: 'b'.repeat(64),
    status: 'action_required',
    headline: 'Ação necessária',
    plainLanguageSummary: 'Ainda existem pendências.',
    decisionBasis: [],
    blockers: [],
    nextAction: 'Resolver a pendência.',
    progress: {
      campaignPreparation: 'incomplete',
      metaEnvironmentValidation: 'pending',
      creativeApproval: 'pending',
      humanPlanApproval: 'pending',
      executorValidation: 'pending',
      publication: 'not_started',
      activation: 'not_started',
      delivery: 'not_started',
    },
    financialScope: {
      currency: 'BRL',
      maximumPlannedSpendMinor: 8400,
      calculation: '1200 x 7 days',
    },
    autonomy: { level: 'A0', humanApprovalRequired: true },
    boundaries: {
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    generatedAt: '2026-08-24T13:00:00.000Z',
  };
  const event: AuditEvent = {
    auditEventId: '66666666-6666-4666-8666-666666666666',
    tenantId: decision.tenantId,
    correlationId: '77777777-7777-4777-8777-777777777777',
    actorType: 'system',
    eventType: 'operational_readiness_decided',
    result: 'info',
    createdAt: decision.generatedAt,
  };
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const repository = new PostgresOperationalReadinessRepository({
    connect,
    query,
  } as unknown as Pool);

  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    connect.mockClear();
  });

  it('persists decision and audit atomically on first insertion', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ payload: decision }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(repository.saveIdempotent(decision, event)).resolves.toEqual(decision);
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(' ')[0])).toEqual([
      'begin', 'insert', 'insert', 'commit',
    ]);
    expect(query.mock.calls[1][0]).toContain('on conflict');
    expect(query.mock.calls[2][0]).toContain('insert into audit_events');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns the existing semantic decision without duplicating audit', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ payload: decision }] })
      .mockResolvedValueOnce({});

    await expect(repository.saveIdempotent(decision, event)).resolves.toEqual(decision);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into audit_events')))
      .toBe(false);
  });

  it('loads the latest decision only inside the tenant and plan', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: decision }] });
    await expect(repository.latestForPlan(decision.tenantId, decision.executionPlanId))
      .resolves.toEqual(decision);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_plan_id = $2'),
      [decision.tenantId, decision.executionPlanId],
    );
  });
});
