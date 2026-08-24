import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { UnversionedKillSwitchStateV1 } from '../../domain/contracts/kill-switch';
import { PostgresKillSwitchRepository } from './postgres-kill-switch.repository';

describe('PostgresKillSwitchRepository', () => {
  const state: UnversionedKillSwitchStateV1 = {
    killSwitchStateId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    scope: 'campaign',
    campaignId: '33333333-3333-4333-8333-333333333333',
    status: 'engaged', reason: 'Interrupção preventiva.', changedBy: 'warison',
    correlationId: '44444444-4444-4444-8444-444444444444',
    changedAt: '2026-08-24T14:00:00.000Z',
  };
  const row = {
    kill_switch_state_id: state.killSwitchStateId,
    tenant_id: state.tenantId,
    scope: state.scope,
    campaign_id: state.campaignId,
    version: 1,
    status: state.status,
    reason: state.reason,
    changed_by: state.changedBy,
    correlation_id: state.correlationId,
    changed_at: new Date(state.changedAt),
  };
  const event: AuditEvent = {
    auditEventId: '55555555-5555-4555-8555-555555555555',
    tenantId: state.tenantId, correlationId: state.correlationId,
    actorType: 'user', actorId: 'warison', eventType: 'kill_switch_engaged',
    result: 'blocked', createdAt: state.changedAt,
  };
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const repository = new PostgresKillSwitchRepository({ connect, query } as unknown as Pool);

  beforeEach(() => {
    query.mockReset(); release.mockReset(); connect.mockClear();
  });

  it('serializes a scope and persists its new version with audit atomically', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await expect(repository.appendNext(state, event)).resolves.toEqual({
      ...state, version: 1,
    });
    expect(query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[3][0]).toContain('insert into kill_switch_states');
    expect(query.mock.calls[4][0]).toContain('insert into audit_events');
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('returns the current state without adding history or audit for the same status', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({});
    await expect(repository.appendNext(state, event)).resolves.toEqual({
      ...state, version: 1,
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into audit_events')))
      .toBe(false);
  });

  it('loads the latest state using tenant, scope and exact nullable target', async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(repository.latest(state.tenantId, 'campaign', state.campaignId))
      .resolves.toEqual({ ...state, version: 1 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('campaign_id is not distinct from $3::uuid'),
      [state.tenantId, 'campaign', state.campaignId],
    );
  });
});
