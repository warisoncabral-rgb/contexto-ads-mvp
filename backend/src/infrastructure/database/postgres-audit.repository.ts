import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AuditRepository, AuditTimelineRepository } from '../../domain/ports/repositories';

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

export class PostgresAuditRepository implements AuditRepository, AuditTimelineRepository {
  constructor(private readonly pool: Pool) {}

  async append(event: AuditEvent): Promise<void> {
    await insertAuditEvent(this.pool, event);
  }

  async listForCampaign(tenantId: string, campaignId: string, limit: number): Promise<AuditEvent[]> {
    const result = await this.pool.query<{
      audit_event_id: string; tenant_id: string; correlation_id: string; actor_type: AuditEvent['actorType'];
      actor_id: string | null; event_type: string; object_type: string | null; object_id: string | null;
      result: AuditEvent['result']; created_at: Date;
    }>(
      `with campaign_objects(object_id) as (
        select package_id::text from campaign_context_versions where tenant_id = $1 and campaign_id = $2
        union select execution_plan_id::text from execution_plans where tenant_id = $1 and campaign_id = $2
        union select approval_id::text from plan_approvals where tenant_id = $1 and campaign_id = $2
        union select creative_package_id::text from creative_package_versions where tenant_id = $1 and campaign_id = $2
        union select readiness_decision_id::text from operational_readiness_decisions where tenant_id = $1 and campaign_id = $2
        union select execution_manifest_id::text from execution_manifests where tenant_id = $1 and campaign_id = $2
        union select execution_authorization_id::text from execution_authorizations where tenant_id = $1 and campaign_id = $2
        union select execution_preflight_id::text from execution_preflights where tenant_id = $1 and campaign_id = $2
        union select kill_switch_state_id::text from kill_switch_states
          where tenant_id = $1 and (campaign_id = $2 or scope = 'tenant')
        union select meta_write_validation_protocol_id::text from meta_write_validation_protocols
          where tenant_id = $1 and campaign_id = $2
      )
      select audit_event_id, tenant_id, correlation_id, actor_type, actor_id,
        event_type, object_type, object_id, result, created_at
      from audit_events
      where tenant_id = $1 and object_id in (select object_id from campaign_objects)
        and event_type not like 'operator_%_viewed'
        and event_type not like 'operator_%_listed'
      order by created_at desc, audit_event_id desc
      limit $3`,
      [tenantId, campaignId, limit],
    );
    return result.rows.map((row) => ({
      auditEventId: row.audit_event_id, tenantId: row.tenant_id,
      correlationId: row.correlation_id, actorType: row.actor_type,
      ...(row.actor_id ? { actorId: row.actor_id } : {}), eventType: row.event_type,
      ...(row.object_type ? { objectType: row.object_type } : {}),
      ...(row.object_id ? { objectId: row.object_id } : {}), result: row.result,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
