import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ApprovalRepository } from '../../domain/ports/repositories';
import { insertAuditEvent } from './postgres-audit.repository';

interface ApprovalRow {
  approval_id: string;
  tenant_id: string;
  execution_plan_id: string;
  campaign_id: string;
  plan_version: string;
  approved_plan_hash: string;
  action_type: string;
  risk_level: ApprovalV1['riskLevel'];
  scope: string[];
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  expires_at: Date;
  decision_reason: string | null;
  status: ApprovalV1['status'];
  correlation_id: string;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `approval_id, tenant_id, execution_plan_id, campaign_id,
  plan_version, approved_plan_hash, action_type, risk_level, scope,
  requested_by, approved_by, approved_at, expires_at, decision_reason,
  status, correlation_id, created_at, updated_at`;

export class PostgresApprovalRepository implements ApprovalRepository {
  constructor(private readonly pool: Pool) {}

  async request(approval: ApprovalV1, event: AuditEvent): Promise<ApprovalV1> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');

      // A timed-out approval may still be stored as pending/approved until it is read.
      // Expire it first so the partial unique index cannot incorrectly block a fresh request.
      const timedOut = await client.query<ApprovalRow>(
        `select ${COLUMNS} from plan_approvals
        where tenant_id = $1 and execution_plan_id = $2
          and approved_plan_hash = $3
          and status in ('pending', 'approved')
          and expires_at <= $4
        for update`,
        [
          approval.tenantId,
          approval.executionPlanId,
          approval.approvedPlanHash,
          approval.createdAt,
        ],
      );
      if (timedOut.rows.length > 0) {
        await client.query(
          `update plan_approvals
          set status = 'expired', decision_reason = 'approval_expired', updated_at = $4
          where tenant_id = $1 and execution_plan_id = $2
            and approved_plan_hash = $3
            and status in ('pending', 'approved')
            and expires_at <= $4`,
          [
            approval.tenantId,
            approval.executionPlanId,
            approval.approvedPlanHash,
            approval.createdAt,
          ],
        );
        for (const row of timedOut.rows) {
          await insertAuditEvent(client, {
            auditEventId: randomUUID(),
            tenantId: row.tenant_id,
            correlationId: row.correlation_id,
            actorType: 'system',
            eventType: 'campaign_plan_approval_expired',
            objectType: 'plan_approval',
            objectId: row.approval_id,
            previousState: { status: row.status },
            newState: { status: 'expired', reason: 'approval_expired' },
            result: 'info',
            createdAt: approval.createdAt,
          });
        }
      }

      const inserted = await client.query<ApprovalRow>(
        `insert into plan_approvals (
          approval_id, tenant_id, execution_plan_id, campaign_id,
          plan_version, approved_plan_hash, action_type, risk_level, scope,
          requested_by, expires_at, status, correlation_id, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
        on conflict (tenant_id, execution_plan_id, approved_plan_hash)
          where status in ('pending', 'approved')
        do nothing
        returning ${COLUMNS}`,
        [
          approval.approvalId,
          approval.tenantId,
          approval.executionPlanId,
          approval.campaignId,
          approval.planVersion,
          approval.approvedPlanHash,
          approval.actionType,
          approval.riskLevel,
          JSON.stringify(approval.scope),
          approval.requestedBy,
          approval.expiresAt,
          approval.status,
          approval.correlationId,
          approval.createdAt,
          approval.updatedAt,
        ],
      );
      let row = inserted.rows[0];
      if (row) {
        await insertAuditEvent(client, event);
      } else {
        const existing = await client.query<ApprovalRow>(
          `select ${COLUMNS} from plan_approvals
          where tenant_id = $1 and execution_plan_id = $2
            and approved_plan_hash = $3 and status in ('pending', 'approved')
          limit 1`,
          [approval.tenantId, approval.executionPlanId, approval.approvedPlanHash],
        );
        row = existing.rows[0];
      }
      if (!row) throw new Error('Approval idempotency invariant failed');
      await client.query('commit');
      return this.toDomain(row);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(tenantId: string, approvalId: string): Promise<ApprovalV1 | null> {
    const result = await this.pool.query<ApprovalRow>(
      `select ${COLUMNS} from plan_approvals
      where tenant_id = $1 and approval_id = $2
      limit 1`,
      [tenantId, approvalId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async findCurrentForPlan(
    tenantId: string,
    executionPlanId: string,
    planHash: string,
  ): Promise<ApprovalV1 | null> {
    const result = await this.pool.query<ApprovalRow>(
      `select ${COLUMNS} from plan_approvals
      where tenant_id = $1 and execution_plan_id = $2
        and approved_plan_hash = $3
        and status in ('pending', 'approved')
        and expires_at > now()
      order by updated_at desc, approval_id desc
      limit 1`,
      [tenantId, executionPlanId, planHash],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : null;
  }

  async approveIfCurrent(
    tenantId: string,
    approvalId: string,
    approvedBy: string,
    approvedAt: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<ApprovalRow>(
        `update plan_approvals approval
        set status = 'approved', approved_by = $3, approved_at = $4, updated_at = $4
        where tenant_id = $1 and approval_id = $2 and status = 'pending'
          and expires_at > $4
          and approved_plan_hash = (
            select plan_hash from execution_plans plan
            where plan.tenant_id = approval.tenant_id
              and plan.campaign_id = approval.campaign_id
            order by plan.created_at desc, plan.execution_plan_id desc
            limit 1
          )
        returning ${COLUMNS}`,
        [tenantId, approvalId, approvedBy, approvedAt],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
  }

  async transition(
    tenantId: string,
    approvalId: string,
    fromStatuses: ApprovalV1['status'][],
    toStatus: ApprovalV1['status'],
    updatedAt: string,
    decisionReason: string | undefined,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<ApprovalRow>(
        `update plan_approvals
        set status = $4, updated_at = $5,
          decision_reason = coalesce($6, decision_reason)
        where tenant_id = $1 and approval_id = $2
          and status = any($3::text[])
        returning ${COLUMNS}`,
        [tenantId, approvalId, fromStatuses, toStatus, updatedAt, decisionReason ?? null],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
  }

  async expire(
    tenantId: string,
    approvalId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null> {
    return this.conditionalSystemTransition(
      tenantId,
      approvalId,
      now,
      'expired',
      'approval_expired',
      'expires_at <= $3',
      event,
    );
  }

  async invalidateIfStale(
    tenantId: string,
    approvalId: string,
    now: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null> {
    return this.conditionalSystemTransition(
      tenantId,
      approvalId,
      now,
      'invalidated',
      'plan_hash_changed',
      `approved_plan_hash <> coalesce((
        select plan_hash from execution_plans plan
        where plan.tenant_id = plan_approvals.tenant_id
          and plan.campaign_id = plan_approvals.campaign_id
        order by plan.created_at desc, plan.execution_plan_id desc
        limit 1
      ), '')`,
      event,
    );
  }

  async invalidateForCampaignExceptHash(
    tenantId: string,
    campaignId: string,
    currentPlanHash: string,
    now: string,
  ): Promise<number> {
    return this.inTransaction(async (client) => {
      const stale = await client.query<ApprovalRow>(
        `select ${COLUMNS} from plan_approvals
        where tenant_id = $1 and campaign_id = $2
          and status in ('pending', 'approved') and approved_plan_hash <> $3
        for update`,
        [tenantId, campaignId, currentPlanHash],
      );
      if (stale.rows.length === 0) return 0;
      await client.query(
        `update plan_approvals
        set status = 'invalidated', decision_reason = 'plan_hash_changed', updated_at = $4
        where tenant_id = $1 and campaign_id = $2
          and approved_plan_hash <> $3 and status in ('pending', 'approved')`,
        [tenantId, campaignId, currentPlanHash, now],
      );
      for (const row of stale.rows) {
        await insertAuditEvent(client, {
          auditEventId: randomUUID(),
          tenantId,
          correlationId: row.correlation_id,
          actorType: 'system',
          eventType: 'campaign_plan_approval_invalidated',
          objectType: 'plan_approval',
          objectId: row.approval_id,
          previousState: {
            status: row.status,
            approvedPlanHash: row.approved_plan_hash,
          },
          newState: {
            status: 'invalidated',
            reason: 'plan_hash_changed',
            currentPlanHash,
          },
          result: 'blocked',
          createdAt: now,
        });
      }
      return stale.rows.length;
    });
  }

  private async conditionalSystemTransition(
    tenantId: string,
    approvalId: string,
    now: string,
    status: 'expired' | 'invalidated',
    reason: string,
    condition: string,
    event: AuditEvent,
  ): Promise<ApprovalV1 | null> {
    return this.inTransaction(async (client) => {
      const result = await client.query<ApprovalRow>(
        `update plan_approvals
        set status = $4, decision_reason = $5, updated_at = $3
        where tenant_id = $1 and approval_id = $2
          and status in ('pending', 'approved') and ${condition}
        returning ${COLUMNS}`,
        [tenantId, approvalId, now, status, reason],
      );
      if (result.rows[0]) await insertAuditEvent(client, event);
      return result.rows[0] ? this.toDomain(result.rows[0]) : null;
    });
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

  private toDomain(row: ApprovalRow): ApprovalV1 {
    return {
      approvalId: row.approval_id,
      tenantId: row.tenant_id,
      executionPlanId: row.execution_plan_id,
      campaignId: row.campaign_id,
      planVersion: row.plan_version,
      approvedPlanHash: row.approved_plan_hash,
      actionType: row.action_type,
      riskLevel: row.risk_level,
      scope: row.scope,
      requestedBy: row.requested_by,
      ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
      ...(row.approved_at ? { approvedAt: row.approved_at.toISOString() } : {}),
      expiresAt: row.expires_at.toISOString(),
      ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
      status: row.status,
      correlationId: row.correlation_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
