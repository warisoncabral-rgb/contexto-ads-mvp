import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AuditRepository } from '../../domain/ports/repositories';

type AuditQueryable = Pick<Pool | PoolClient, 'query'>;

export async function insertAuditEvent(
  database: AuditQueryable,
  event: AuditEvent,
): Promise<void> {
  await database.query(
    `insert into audit_events (
      audit_event_id, tenant_id, correlation_id, actor_type, actor_id,
      event_type, object_type, object_id, previous_state, new_state,
      result, normalized_error, created_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13)`,
    [
      event.auditEventId,
      event.tenantId,
      event.correlationId,
      event.actorType,
      event.actorId ?? null,
      event.eventType,
      event.objectType ?? null,
      event.objectId ?? null,
      event.previousState === undefined ? null : JSON.stringify(event.previousState),
      event.newState === undefined ? null : JSON.stringify(event.newState),
      event.result,
      event.normalizedError ?? null,
      event.createdAt,
    ],
  );
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async append(event: AuditEvent): Promise<void> {
    await insertAuditEvent(this.pool, event);
  }
}
