import { Pool } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { PostgresAuditRepository } from './postgres-audit.repository';

describe('PostgresAuditRepository', () => {
  const query = jest.fn();
  const repository = new PostgresAuditRepository({ query } as unknown as Pool);
  const event: AuditEvent = {
    auditEventId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    correlationId: '33333333-3333-4333-8333-333333333333',
    actorType: 'user',
    actorId: 'warison',
    eventType: 'campaign_plan_approved',
    objectType: 'plan_approval',
    objectId: '44444444-4444-4444-8444-444444444444',
    previousState: { status: 'pending' },
    newState: { status: 'approved' },
    result: 'success',
    createdAt: '2026-08-24T09:00:00.000Z',
  };

  beforeEach(() => query.mockReset());

  it('persists actor, correlation and before/after state', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repository.append(event);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into audit_events'),
      [
        event.auditEventId,
        event.tenantId,
        event.correlationId,
        event.actorType,
        event.actorId,
        event.eventType,
        event.objectType,
        event.objectId,
        JSON.stringify(event.previousState),
        JSON.stringify(event.newState),
        event.result,
        null,
        event.createdAt,
      ],
    );
  });
});
