import { Pool } from 'pg';
import { PostgresOperatorWorkQueueSnapshotRepository } from './postgres-operator-work-queue-snapshot.repository';

describe('PostgresOperatorWorkQueueSnapshotRepository', () => {
  const query = jest.fn();
  const repository = new PostgresOperatorWorkQueueSnapshotRepository({ query } as unknown as Pool);
  const snapshot = { snapshotId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222', queueDate: '2026-08-24',
    calendarBasis: 'UTC' as const, snapshotHash: 'a'.repeat(64), itemCount: 0,
    sourceDecisions: [{ source: 'campaign_plans' as const, status: 'included' as const,
      reason: 'Persisted plans.' }], generatedAt: '2026-08-24T18:00:00.000Z' };

  beforeEach(() => query.mockReset());

  it('upserts only the exact tenant and UTC day and returns persisted evidence', async () => {
    query.mockResolvedValueOnce({ rows: [{ snapshot_id: snapshot.snapshotId,
      tenant_id: snapshot.tenantId, queue_date: snapshot.queueDate,
      snapshot_hash: snapshot.snapshotHash, source_decisions: snapshot.sourceDecisions,
      generated_at: new Date(snapshot.generatedAt), item_count: '0' }] });

    await expect(repository.saveDaily(snapshot, [])).resolves.toEqual(snapshot);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(
      /on conflict \(tenant_id, queue_date\)[\s\S]*snapshot_hash <> excluded\.snapshot_hash/,
    ), expect.arrayContaining([snapshot.tenantId, snapshot.queueDate, snapshot.snapshotHash]));
  });

  it('returns the existing daily row when the content hash is unchanged', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
      snapshot_id: snapshot.snapshotId, tenant_id: snapshot.tenantId,
      queue_date: new Date('2026-08-24T00:00:00.000Z'), snapshot_hash: snapshot.snapshotHash,
      source_decisions: snapshot.sourceDecisions, generated_at: snapshot.generatedAt,
      item_count: '0',
    }] });

    await expect(repository.saveDaily(snapshot, [])).resolves.toEqual(snapshot);
    expect(query.mock.calls[1][1]).toEqual([snapshot.tenantId, snapshot.queueDate]);
  });
});
