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

  it('lists only campaign-linked objects inside the tenant boundary', async () => {
    query.mockResolvedValueOnce({ rows: [{
      audit_event_id: event.auditEventId, tenant_id: event.tenantId,
      correlation_id: event.correlationId, actor_type: event.actorType,
      actor_id: event.actorId, event_type: event.eventType,
      object_type: event.objectType, object_id: event.objectId,
      result: event.result, created_at: new Date(event.createdAt),
    }] });
    const result = await repository.listForCampaign(
      event.tenantId, '55555555-5555-4555-8555-555555555555', 100,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and object_id in'),
      [event.tenantId, '55555555-5555-4555-8555-555555555555', 100],
    );
    expect(query.mock.calls[0][0]).toContain("event_type not like 'operator_%_viewed'");
    expect(result).toEqual([expect.objectContaining({
      auditEventId: event.auditEventId, eventType: event.eventType,
      createdAt: event.createdAt,
    })]);
  });
});
