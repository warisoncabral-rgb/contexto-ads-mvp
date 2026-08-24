import { Pool } from 'pg';
import { ReadinessSnapshot } from '../../domain/contracts/readiness';
import { PostgresReadinessRepository } from './postgres-readiness.repository';

describe('PostgresReadinessRepository', () => {
  const query = jest.fn();
  const repository = new PostgresReadinessRepository({ query } as unknown as Pool);
  const snapshot: ReadinessSnapshot = {
    snapshotId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    connectionId: '33333333-3333-4333-8333-333333333333',
    correlationId: '44444444-4444-4444-8444-444444444444',
    checks: [{
      key: 'meta_oauth',
      status: 'passed',
      meaning: 'OAuth ready',
      evidenceRefs: ['meta_connection:33333333-3333-4333-8333-333333333333'],
      source: 'system',
    }],
    blockers: [],
    generatedAt: '2026-08-24T04:00:00.000Z',
  };

  beforeEach(() => query.mockReset());

  it('persists a complete readiness snapshot idempotently', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repository.save(snapshot);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (snapshot_id) do nothing'),
      [
        snapshot.snapshotId,
        snapshot.tenantId,
        snapshot.connectionId,
        snapshot.correlationId,
        JSON.stringify(snapshot.checks),
        JSON.stringify(snapshot.blockers),
        snapshot.generatedAt,
      ],
    );
  });

  it('loads only the latest tenant-scoped snapshot', async () => {
    query.mockResolvedValueOnce({ rows: [{
      snapshot_id: snapshot.snapshotId,
      tenant_id: snapshot.tenantId,
      connection_id: snapshot.connectionId,
      correlation_id: snapshot.correlationId,
      checks: snapshot.checks,
      blockers: snapshot.blockers,
      generated_at: new Date(snapshot.generatedAt),
    }] });

    await expect(repository.latestForConnection(
      snapshot.tenantId,
      snapshot.connectionId,
    )).resolves.toEqual(snapshot);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and connection_id = $2'),
      [snapshot.tenantId, snapshot.connectionId],
    );
  });
});
