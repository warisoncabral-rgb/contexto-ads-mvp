import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightV1,
} from '../../domain/contracts/execution-authorization';
import { ExecutionAuthorizationRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface AuthorizationRow {
  execution_authorization_id: string;
  tenant_id: string;
  campaign_id: string;
  execution_plan_id: string;
  execution_manifest_id: string;
  plan_hash: string;
  manifest_hash: string;
  action_type: ExecutionAuthorizationV1['actionType'];
  risk_level: 'high';
  scope: string[];
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  decision_reason: string | null;
  status: ExecutionAuthorizationV1['status'];
  expires_at: Date;
  correlation_id: string;
  boundaries: ExecutionAuthorizationV1['boundaries'];
  created_at: Date;
  updated_at: Date;
}

interface PreflightRow { payload: ExecutionPreflightV1 }

const COLUMNS = `execution_authorization_id, tenant_id, campaign_id,
  execution_plan_id, execution_manifest_id, plan_hash, manifest_hash,
  action_type, risk_level, scope, requested_by, approved_by, approved_at,
  decision_reason, status, expires_at, correlation_id, boundaries,
  created_at, updated_at`;

export class PostgresExecutionAuthorizationRepository
implements ExecutionAuthorizationRepository {
  constructor(private readonly pool: Pool) {}

  async request(
    authorization: ExecutionAuthorizationV1,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<AuthorizationRow>(
        `insert into execution_authorizations (
          execution_authorization_id, tenant_id, campaign_id, execution_plan_id,
          execution_manifest_id, plan_hash, manifest_hash, action_type,
          risk_level, scope, requested_by, status, expires_at, correlation_id,
          boundaries, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,
          $15::jsonb,$16,$17)
        on conflict (tenant_id, execution_manifest_id, manifest_hash)
          where status in ('pending','approved')
        do nothing returning ${COLUMNS}`,
        [authorization.executionAuthorizationId, authorization.tenantId,
          authorization.campaignId, authorization.executionPlanId,
          authorization.executionManifestId, authorization.planHash,
          authorization.manifestHash, authorization.actionType,
          authorization.riskLevel, JSON.stringify(authorization.scope),
          authorization.requestedBy, authorization.status, authorization.expiresAt,
          authorization.correlationId, JSON.stringify(authorization.boundaries),
          authorization.createdAt, authorization.updatedAt],
      );
      let row = inserted.rows[0];
      if (row) await insertAuditEvent(client, event);
      if (!row) row = (await client.query<AuthorizationRow>(
        `select ${COLUMNS} from execution_authorizations
        where tenant_id = $1 and execution_manifest_id = $2
          and manifest_hash = $3 and status in ('pending','approved') limit 1`,
        [authorization.tenantId, authorization.executionManifestId,
          authorization.manifestHash],
      )).rows[0];
      if (!row) throw new Error('Execution authorization idempotency invariant failed');
      return this.toDomain(row);
    });
  }

  async findById(
    tenantId: string,
    executionAuthorizationId: string,
  ): Promise<ExecutionAuthorizationV1 | null> {
    const result = await this.pool.query<AuthorizationRow>(
      `select ${COLUMNS} from execution_authorizations
      where tenant_id = $1 and execution_authorization_id = $2 limit 1`,
      [tenantId, executionAuthorizationId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async approveIfCurrent(
    tenantId: string,
    executionAuthorizationId: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<AuthorizationRow>(
        `update execution_authorizations as auth
        set status = 'approved', approved_by = $3, approved_at = $4, updated_at = $4
        where tenant_id = $1 and execution_authorization_id = $2
          and status = 'pending' and expires_at > $4
          and execution_manifest_id = (
            select manifest.execution_manifest_id from execution_manifests manifest
            where manifest.tenant_id = auth.tenant_id
              and manifest.execution_plan_id = auth.execution_plan_id
            order by manifest.generated_at desc, manifest.execution_manifest_id desc limit 1
          )
          and manifest_hash = (
            select manifest.manifest_hash from execution_manifests manifest
            where manifest.tenant_id = auth.tenant_id
              and manifest.execution_manifest_id = auth.execution_manifest_id
          )
        returning ${COLUMNS}`,
        [tenantId, executionAuthorizationId, approvedBy, approvedAt],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
  }

  async transition(
    tenantId: string,
    executionAuthorizationId: string,
    fromStatuses: ExecutionAuthorizationV1['status'][],
    toStatus: ExecutionAuthorizationV1['status'],
    updatedAt: string,
    reason: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<AuthorizationRow>(
        `update execution_authorizations set status = $4, updated_at = $5,
          decision_reason = $6
        where tenant_id = $1 and execution_authorization_id = $2
          and status = any($3::text[]) returning ${COLUMNS}`,
        [tenantId, executionAuthorizationId, fromStatuses, toStatus, updatedAt, reason],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
  }

  async expireOrInvalidate(
    tenantId: string,
    executionAuthorizationId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ExecutionAuthorizationV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<AuthorizationRow>(
        `update execution_authorizations as auth set
          status = case when expires_at <= $3 then 'expired' else 'invalidated' end,
          decision_reason = case when expires_at <= $3
            then 'execution_authorization_expired' else 'manifest_changed' end,
          updated_at = $3
        where tenant_id = $1 and execution_authorization_id = $2
          and status in ('pending','approved')
          and (expires_at <= $3 or execution_manifest_id <> coalesce((
            select manifest.execution_manifest_id from execution_manifests manifest
            where manifest.tenant_id = auth.tenant_id
              and manifest.execution_plan_id = auth.execution_plan_id
            order by manifest.generated_at desc, manifest.execution_manifest_id desc limit 1
          ), '00000000-0000-0000-0000-000000000000'::uuid))
        returning ${COLUMNS}`,
        [tenantId, executionAuthorizationId, now],
      );
      if (result.rows[0]) await insertAuditEvent(client, {
        ...event,
        eventType: result.rows[0].status === 'expired'
          ? 'execution_authorization_expired'
          : 'execution_authorization_invalidated',
        newState: {
          status: result.rows[0].status,
          reason: result.rows[0].decision_reason,
        },
      });
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
  }

  async savePreflightIdempotent(
    preflight: ExecutionPreflightV1,
    event: AuditEvent,
  ): Promise<ExecutionPreflightV1> {
    return this.inTransaction(async (client) => {
      const inserted = await client.query<PreflightRow>(
        `insert into execution_preflights (
          execution_preflight_id, tenant_id, campaign_id, execution_plan_id,
          execution_manifest_id, execution_authorization_id, plan_hash,
          manifest_hash, preflight_hash, status, payload, generated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
        on conflict (tenant_id, execution_manifest_id, execution_authorization_id,
          preflight_hash) do nothing returning payload`,
        [preflight.executionPreflightId, preflight.tenantId, preflight.campaignId,
          preflight.executionPlanId, preflight.executionManifestId,
          preflight.executionAuthorizationId, preflight.planHash,
          preflight.manifestHash, preflight.preflightHash, preflight.status,
          JSON.stringify(preflight), preflight.generatedAt],
      );
      if (inserted.rows[0]) await insertAuditEvent(client, event);
      const result = inserted.rows[0] ?? (await client.query<PreflightRow>(
        `select payload from execution_preflights where tenant_id = $1
          and execution_manifest_id = $2 and execution_authorization_id = $3
          and preflight_hash = $4 limit 1`,
        [preflight.tenantId, preflight.executionManifestId,
          preflight.executionAuthorizationId, preflight.preflightHash],
      )).rows[0];
      if (!result) throw new Error('Execution preflight idempotency invariant failed');
      return result.payload;
    });
  }

  private toDomain(row: AuthorizationRow): ExecutionAuthorizationV1 {
    return {
      executionAuthorizationId: row.execution_authorization_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      executionPlanId: row.execution_plan_id,
      executionManifestId: row.execution_manifest_id,
      planHash: row.plan_hash,
      manifestHash: row.manifest_hash,
      actionType: row.action_type,
      riskLevel: row.risk_level,
      scope: row.scope,
      requestedBy: row.requested_by,
      ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
      ...(row.approved_at ? { approvedAt: row.approved_at.toISOString() } : {}),
      ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      correlationId: row.correlation_id,
      boundaries: row.boundaries,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
