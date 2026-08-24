import { Pool } from 'pg';
import { PostgresOperatorWorkQueueSnapshotRepository } from './postgres-operator-work-queue-snapshot.repository';

const item = { workItemId: 'b'.repeat(64), tenantId: '22222222-2222-4222-8222-222222222222',
  tenantDisplayName: 'Rosa VIP', role: 'owner' as const,
  campaignId: '33333333-3333-4333-8333-333333333333',
  executionPlanId: '44444444-4444-4444-8444-444444444444',
  source: 'operational_blocker' as const, blockerCode: 'approval_valid', owner: 'operator' as const,
  priority: 'high' as const, meaning: 'Aprovação pendente.', nextAction: 'Revisar.',
  evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z' };

describe('PostgresOperatorWorkQueueSnapshotRepository', () => {
  const query = jest.fn();
  const repository = new PostgresOperatorWorkQueueSnapshotRepository({ query } as unknown as Pool);
  const snapshot = { snapshotId: '11111111-1111-4111-8111-111111111111',
    tenantId: item.tenantId, queueDate: '2026-08-24', calendarBasis: 'UTC' as const,
    snapshotHash: 'a'.repeat(64), itemCount: 1,
    sourceDecisions: [{ source: 'campaign_plans' as const, status: 'included' as const,
      reason: 'Persisted plans.' }], generatedAt: '2026-08-24T18:00:00.000Z' };

  beforeEach(() => query.mockReset());

  it('upserts the exact tenant/day and exposes a missing baseline without inferring changes', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
      snapshot_id: snapshot.snapshotId, tenant_id: snapshot.tenantId, queue_date: snapshot.queueDate,
      snapshot_hash: snapshot.snapshotHash, source_decisions: snapshot.sourceDecisions,
      generated_at: new Date(snapshot.generatedAt), item_count: '1' }] });

    const result = await repository.saveDaily(snapshot, [item]);

    expect(result).toEqual(expect.objectContaining(snapshot));
    expect(result.comparison).toEqual({ baselineAvailable: false, previousQueueDate: null, changes: [] });
    expect(query.mock.calls[0][0]).toMatch(/queue_date < \$2[\s\S]*order by queue_date desc/);
    expect(query.mock.calls[1][0]).toMatch(
      /on conflict \(tenant_id, queue_date\)[\s\S]*snapshot_hash <> excluded\.snapshot_hash/,
    );
  });

  it('returns the existing daily row when content is unchanged and compares to the prior day', async () => {
    query.mockResolvedValueOnce({ rows: [{ snapshot_id: '55555555-5555-4555-8555-555555555555',
      tenant_id: snapshot.tenantId, queue_date: '2026-08-23', snapshot_hash: 'c'.repeat(64),
      items: [{ ...item, priority: 'normal' }], source_decisions: snapshot.sourceDecisions,
      generated_at: '2026-08-23T18:00:00.000Z', item_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
        snapshot_id: snapshot.snapshotId, tenant_id: snapshot.tenantId,
        queue_date: new Date('2026-08-24T00:00:00.000Z'), snapshot_hash: snapshot.snapshotHash,
        source_decisions: snapshot.sourceDecisions, generated_at: snapshot.generatedAt, item_count: '1',
      }] });

    const result = await repository.saveDaily(snapshot, [item]);

    expect(result.comparison?.baselineAvailable).toBe(true);
    expect(result.comparison?.previousQueueDate).toBe('2026-08-23');
    expect(result.comparison?.changes[0]).toEqual(expect.objectContaining({
      workItemId: item.workItemId, kind: 'worsened', previousPriority: 'normal', currentPriority: 'high',
    }));
    expect(query.mock.calls[2][1]).toEqual([snapshot.tenantId, snapshot.queueDate]);
  });
});
