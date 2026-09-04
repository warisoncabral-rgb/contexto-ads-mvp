import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalRepository,
  CampaignContextRepository,
} from '../../domain/ports/repositories';
import {
  APPROVAL_REPOSITORY,
  CAMPAIGN_CONTEXT_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { CreativePackageService } from '../creative-package/creative-package.service';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';

export type CampaignPackageNextActionV1 =
  | 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE'
  | 'RESOLVE_META_TARGET'
  | 'REQUEST_EXECUTION_PLAN_APPROVAL'
  | 'DECIDE_EXECUTION_PLAN_APPROVAL'
  | 'PREPARE_PAUSED_CREATION';

@Injectable()
export class CampaignPackageStatusService {
  constructor(
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
    private readonly executionPlans: ExecutionPlanService,
    private readonly creativePackages: CreativePackageService,
    @Inject(APPROVAL_REPOSITORY)
    private readonly approvals: ApprovalRepository,
  ) {}

  async get(tenantId: unknown, packageId: unknown) {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(packageId, 'packageId');
    const context = await this.contexts.latest(tenantId, packageId);
    if (!context) throw new NotFoundException({
      code: 'campaign_package_handoff_not_found',
      message: 'Campaign Package handoff was not found for this tenant',
    });
    const plan = await this.executionPlans.latest(tenantId, packageId);
    let creative = null;
    try {
      creative = await this.creativePackages.latest(tenantId, packageId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const targetBound = Boolean(plan.meta.connectionId && plan.meta.adAccountId);
    const approval = await this.approvals.findCurrentForPlan(
      tenantId,
      plan.executionPlanId,
      plan.planHash,
    );
    const nextAction: CampaignPackageNextActionV1 = !creative || creative.status !== 'approved'
      ? 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE'
      : !targetBound
        ? 'RESOLVE_META_TARGET'
        : approval?.status === 'approved'
          ? 'PREPARE_PAUSED_CREATION'
          : approval?.status === 'pending'
            ? 'DECIDE_EXECUTION_PLAN_APPROVAL'
            : 'REQUEST_EXECUTION_PLAN_APPROVAL';

    return {
      package_id: packageId,
      campaign_id: packageId,
      context: {
        internal_package_id: context.packageId,
        version: context.version,
        status: context.status,
        content_hash: context.contentHash,
        objective: context.facts.objective?.value ?? null,
        destination: context.facts.destination?.value ?? null,
      },
      creative: creative ? {
        creative_package_id: creative.creativePackageId,
        version: creative.version,
        status: creative.status,
        content_hash: creative.contentHash,
      } : null,
      execution_plan: {
        execution_plan_id: plan.executionPlanId,
        plan_hash: plan.planHash,
        status: plan.status,
        target_binding_status: targetBound ? 'BOUND' : 'PENDING_RESOLUTION',
        maximum_planned_spend_minor: plan.financials.maximumPlannedSpendMinor,
        currency: plan.financials.currency,
      },
      plan_approval: approval ? {
        approval_id: approval.approvalId,
        status: approval.status,
        approved_plan_hash: approval.approvedPlanHash,
        expires_at: approval.expiresAt,
      } : null,
      next_action: nextAction,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: plan.externalEffects.writesPerformed,
        plan_approval_is_execution_authorization: false,
      },
    };
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
