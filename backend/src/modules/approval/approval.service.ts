import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import {
  APPROVAL_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
} from '../../infrastructure/database/database.tokens';

const APPROVAL_VALIDITY_MS = 24 * 60 * 60 * 1000;
const RISK_RANK = { low: 1, medium: 2, high: 3 } as const;

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(APPROVAL_REPOSITORY)
    private readonly approvals: ApprovalRepository,
  ) {}

  async request(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    requestedBy: unknown,
  ): Promise<ApprovalV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    const actor = this.assertActor(requestedBy, 'requestedBy');
    const [plan, latest] = await Promise.all([
      this.plans.findById(tenantId, executionPlanId),
      this.plans.latest(tenantId, campaignId),
    ]);
    if (!plan || plan.campaignId !== campaignId) {
      throw new NotFoundException('Execution plan not found');
    }
    if (!latest
      || latest.executionPlanId !== plan.executionPlanId
      || latest.planHash !== plan.planHash) {
      throw new ConflictException({
        code: 'execution_plan_not_current',
        message: 'Only the latest campaign plan can be submitted for approval',
      });
    }
    if (plan.externalEffects.writesAllowed || plan.externalEffects.writesPerformed) {
      throw new ConflictException({
        code: 'unsafe_execution_plan',
        message: 'A plan with external effects cannot enter this approval flow',
      });
    }

    const now = new Date();
    const approval: ApprovalV1 = {
      approvalId: randomUUID(),
      tenantId,
      executionPlanId,
      campaignId,
      planVersion: plan.planVersion,
      approvedPlanHash: plan.planHash,
      actionType: 'approve_campaign_plan',
      riskLevel: this.highestRisk(plan),
      scope: this.scope(plan),
      requestedBy: actor,
      expiresAt: new Date(now.getTime() + APPROVAL_VALIDITY_MS).toISOString(),
      status: 'pending',
      correlationId: randomUUID(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return this.approvals.request(
      approval,
      this.event(
        approval,
        'user',
        actor,
        'campaign_plan_approval_requested',
        undefined,
        { status: 'pending', planHash: plan.planHash, scope: approval.scope },
        'success',
        approval.createdAt,
      ),
    );
  }

  async get(tenantId: unknown, approvalId: unknown): Promise<ApprovalV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(approvalId, 'approvalId');
    return this.refresh(tenantId, approvalId);
  }

  async approve(
    tenantId: unknown,
    approvalId: unknown,
    approvedBy: unknown,
  ): Promise<ApprovalV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(approvalId, 'approvalId');
    const actor = this.assertActor(approvedBy, 'approvedBy');
    const current = await this.refresh(tenantId, approvalId);
    this.assertStatus(current, ['pending'], 'approval_not_pending');
    const now = new Date().toISOString();
    const approved = await this.approvals.approveIfCurrent(
      tenantId,
      approvalId,
      actor,
      now,
      this.event(
        current,
        'user',
        actor,
        'campaign_plan_approved',
        { status: current.status },
        { status: 'approved', approvedPlanHash: current.approvedPlanHash },
        'success',
        now,
      ),
    );
    if (approved) return approved;
    const refreshed = await this.refresh(tenantId, approvalId);
    throw new ConflictException({
      code: 'approval_no_longer_valid',
      message: 'The approval expired or its plan is no longer current',
      status: refreshed.status,
    });
  }

  async reject(
    tenantId: unknown,
    approvalId: unknown,
    rejectedBy: unknown,
    reason: unknown,
  ): Promise<ApprovalV1> {
    return this.userTransition(
      tenantId,
      approvalId,
      rejectedBy,
      reason,
      ['pending'],
      'rejected',
      'campaign_plan_rejected',
    );
  }

  async revoke(
    tenantId: unknown,
    approvalId: unknown,
    revokedBy: unknown,
    reason: unknown,
  ): Promise<ApprovalV1> {
    return this.userTransition(
      tenantId,
      approvalId,
      revokedBy,
      reason,
      ['approved'],
      'revoked',
      'campaign_plan_approval_revoked',
    );
  }

  private async userTransition(
    tenantId: unknown,
    approvalId: unknown,
    actorValue: unknown,
    reasonValue: unknown,
    fromStatuses: ApprovalV1['status'][],
    toStatus: ApprovalV1['status'],
    eventType: string,
  ): Promise<ApprovalV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(approvalId, 'approvalId');
    const actor = this.assertActor(actorValue, 'actor');
    const reason = this.assertReason(reasonValue);
    const current = await this.refresh(tenantId, approvalId);
    this.assertStatus(current, fromStatuses, `approval_cannot_be_${toStatus}`);
    const now = new Date().toISOString();
    const transitioned = await this.approvals.transition(
      tenantId,
      approvalId,
      fromStatuses,
      toStatus,
      now,
      reason,
      this.event(
        current,
        'user',
        actor,
        eventType,
        { status: current.status },
        { status: toStatus, reason },
        'success',
        now,
      ),
    );
    if (!transitioned) {
      throw new ConflictException({
        code: 'approval_state_changed',
        message: 'The approval state changed before the decision was persisted',
      });
    }
    return transitioned;
  }

  private async refresh(tenantId: string, approvalId: string): Promise<ApprovalV1> {
    const current = await this.approvals.findById(tenantId, approvalId);
    if (!current) throw new NotFoundException('Approval not found');
    if (!['pending', 'approved'].includes(current.status)) return current;
    const now = new Date().toISOString();
    const expired = await this.approvals.expire(
      tenantId,
      approvalId,
      now,
      this.event(
        current,
        'system',
        undefined,
        'campaign_plan_approval_expired',
        { status: current.status },
        { status: 'expired', reason: 'approval_expired' },
        'info',
        now,
      ),
    );
    if (expired) return expired;
    const invalidated = await this.approvals.invalidateIfStale(
      tenantId,
      approvalId,
      now,
      this.event(
        current,
        'system',
        undefined,
        'campaign_plan_approval_invalidated',
        { status: current.status, approvedPlanHash: current.approvedPlanHash },
        { status: 'invalidated', reason: 'plan_hash_changed' },
        'blocked',
        now,
      ),
    );
    return invalidated ?? current;
  }

  private highestRisk(plan: ExecutionPlanV1): ApprovalV1['riskLevel'] {
    return plan.risks.reduce<ApprovalV1['riskLevel']>(
      (highest, risk) => RISK_RANK[risk.severity] > RISK_RANK[highest]
        ? risk.severity
        : highest,
      'low',
    );
  }

  private scope(plan: ExecutionPlanV1): string[] {
    return [
      `campaign:${plan.campaignId}`,
      `execution_plan:${plan.executionPlanId}`,
      `plan_hash:${plan.planHash}`,
      `context_version:${plan.campaignPackageVersion}`,
      `maximum_spend_minor:${plan.financials.maximumPlannedSpendMinor}`,
      `currency:${plan.financials.currency}`,
      `objects:${plan.objectsToCreate.map((object) => object.type).join(',')}`,
      `capabilities:${plan.meta.requiredCapabilities.join(',')}`,
      'external_write:false',
    ];
  }

  private assertStatus(
    approval: ApprovalV1,
    allowed: ApprovalV1['status'][],
    code: string,
  ): void {
    if (!allowed.includes(approval.status)) {
      throw new ConflictException({
        code,
        message: `Approval status is ${approval.status}`,
        status: approval.status,
      });
    }
  }

  private event(
    approval: ApprovalV1,
    actorType: AuditEvent['actorType'],
    actorId: string | undefined,
    eventType: string,
    previousState: unknown,
    newState: unknown,
    result: AuditEvent['result'],
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: approval.tenantId,
      correlationId: approval.correlationId,
      actorType,
      ...(actorId ? { actorId } : {}),
      eventType,
      objectType: 'plan_approval',
      objectId: approval.approvalId,
      ...(previousState === undefined ? {} : { previousState }),
      newState,
      result,
      createdAt,
    };
  }

  private assertActor(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 200) {
      throw new BadRequestException(`${field} must have between 2 and 200 characters`);
    }
    return value.trim();
  }

  private assertReason(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 1_000) {
      throw new BadRequestException('reason must have between 3 and 1000 characters');
    }
    return value.trim();
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
