import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { CampaignContextInput } from '../../domain/contracts/campaign-context';
import {
  OperatorPermission,
  OperatorRole,
  OperatorCampaignContextAccessV1,
  OperatorTenantPlansV1,
  OperatorWorkspaceAccessV1,
} from '../../domain/contracts/operator-access';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';
import {
  AuditRepository,
  OperatorPlanSelectionRepository,
  OperatorCampaignContextSelectionRepository,
  OperationalReadinessRepository,
  OperatorTenantMembershipRepository,
} from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  CAMPAIGN_CONTEXT_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  OPERATIONAL_READINESS_REPOSITORY,
  OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { OPERATOR_IDENTITY } from '../../infrastructure/operator-access/operator-access.tokens';
import { CampaignContextService } from '../campaign-context/campaign-context.service';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';
import { ApprovalService } from '../approval/approval.service';
import { OperationalReadinessService } from '../operational-readiness/operational-readiness.service';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';

const PERMISSIONS: Record<OperatorRole, OperatorPermission[]> = {
  owner: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
    'decide_approval',
    'configure_tenant',
  ],
  operator: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
  ],
  viewer: ['view_workspace'],
};

@Injectable()
export class OperatorAccessService {
  constructor(
    @Inject(OPERATOR_IDENTITY)
    private readonly identity: OperatorIdentityPort,
    @Inject(OPERATOR_TENANT_MEMBERSHIP_REPOSITORY)
    private readonly memberships: OperatorTenantMembershipRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: OperatorPlanSelectionRepository,
    @Inject(OPERATIONAL_READINESS_REPOSITORY)
    private readonly readiness: OperationalReadinessRepository,
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly campaignContextSelection: OperatorCampaignContextSelectionRepository,
    private readonly campaignContexts: CampaignContextService,
    private readonly executionPlans: ExecutionPlanService,
    private readonly approvalService: ApprovalService,
    private readonly operationalReadiness: OperationalReadinessService,
    private readonly executionSimulations: ExecutionSimulationService,
  ) {}

  async listTenants(
    authorizationHeader: string | undefined,
  ): Promise<OperatorWorkspaceAccessV1> {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const generatedAt = new Date().toISOString();
    await Promise.all(memberships.map((membership) => this.audit.append(
      this.accessEvent(membership.tenantId, membership.membershipId,
        operator.subject, generatedAt),
    )));
    return {
      operator,
      tenants: memberships.map((membership) => ({
        tenantId: membership.tenantId,
        displayName: membership.tenantDisplayName,
        role: membership.role,
        permissions: [...PERMISSIONS[membership.role]],
        membershipId: membership.membershipId,
      })),
      boundaries: {
        tenantAccessDerivedFromMembership: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      generatedAt,
    };
  }

  async listTenantPlans(
    authorizationHeader: string | undefined,
    tenantId: string,
  ): Promise<OperatorTenantPlansV1> {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const membership = memberships.find((candidate) => candidate.tenantId === tenantId);
    if (!membership) {
      throw new UnauthorizedException({
        code: 'tenant_access_denied',
        message: 'Operator is not authorized for this tenant',
      });
    }
    const plans = await this.plans.listLatestForTenant(tenantId);
    const generatedAt = new Date().toISOString();
    await this.audit.append(this.planListEvent(
      tenantId,
      membership.membershipId,
      operator.subject,
      generatedAt,
    ));
    return {
      tenantId,
      plans: plans.map((plan) => ({
        tenantId: plan.tenantId,
        campaignId: plan.campaignId,
        executionPlanId: plan.executionPlanId,
        planVersion: plan.planVersion,
        planHash: plan.planHash,
        status: plan.status,
        campaignPackageVersion: plan.campaignPackageVersion,
        maximumPlannedSpendMinor: plan.financials.maximumPlannedSpendMinor,
        currency: plan.financials.currency,
        calculation: plan.financials.calculation,
        approvalRequired: plan.autonomy.approvalRequired,
        externalWritesAllowed: false,
        createdAt: plan.createdAt,
      })),
      boundaries: {
        tenantAccessVerified: true,
        latestPlanPerCampaign: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      generatedAt,
    };
  }

  async latestReadiness(
    authorizationHeader: string | undefined,
    tenantId: string,
    executionPlanId: string,
  ) {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const membership = memberships.find((candidate) => candidate.tenantId === tenantId);
    if (!membership) {
      throw new UnauthorizedException({
        code: 'tenant_access_denied',
        message: 'Operator is not authorized for this tenant',
      });
    }
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) {
      throw new NotFoundException({
        code: 'execution_plan_not_found',
        message: 'Execution plan not found',
      });
    }
    const decision = await this.readiness.latestForPlan(tenantId, executionPlanId);
    if (!decision) {
      throw new NotFoundException({
        code: 'operational_readiness_not_found',
        message: 'Operational readiness decision not found',
      });
    }
    const generatedAt = new Date().toISOString();
    await this.audit.append(this.readinessAccessEvent(
      tenantId,
      decision.readinessDecisionId,
      executionPlanId,
      operator.subject,
      generatedAt,
    ));
    return decision;
  }

  async listCampaignContexts(
    authorizationHeader: string | undefined,
    tenantId: string,
  ): Promise<OperatorCampaignContextAccessV1> {
    const { operator, membership } = await this.authorizedMembership(
      authorizationHeader,
      tenantId,
    );
    const contexts = await this.campaignContextSelection.listLatestForTenant(tenantId);
    const generatedAt = new Date().toISOString();
    await this.audit.append(this.contextListEvent(
      tenantId,
      membership.membershipId,
      operator.subject,
      generatedAt,
    ));
    return {
      tenantId,
      contexts,
      boundaries: {
        tenantAccessVerified: true,
        latestContextPerCampaign: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      generatedAt,
    };
  }

  async createCampaignContext(
    authorizationHeader: string | undefined,
    tenantId: string,
    facts?: CampaignContextInput,
  ) {
    const { operator, membership } = await this.authorizedMembership(
      authorizationHeader,
      tenantId,
    );
    this.assertCanPrepareCampaign(membership.role);
    return this.campaignContexts.create(tenantId, facts, operator.subject);
  }

  async updateCampaignContext(
    authorizationHeader: string | undefined,
    tenantId: string,
    campaignId: string,
    facts?: CampaignContextInput,
  ) {
    const { operator, membership } = await this.authorizedMembership(
      authorizationHeader,
      tenantId,
    );
    this.assertCanPrepareCampaign(membership.role);
    return this.campaignContexts.appendVersion(
      tenantId,
      campaignId,
      facts,
      operator.subject,
    );
  }

  async generateExecutionPlan(
    authorizationHeader: string | undefined,
    tenantId: string,
    campaignId: string,
    contextVersion?: number,
  ) {
    const { operator, membership } = await this.authorizedMembership(
      authorizationHeader,
      tenantId,
    );
    this.assertCanPrepareCampaign(membership.role);
    return this.executionPlans.generate(
      tenantId,
      campaignId,
      contextVersion,
      operator.subject,
    );
  }

  async requestPlanApproval(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, executionPlanId: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'request_approval');
    const approval = await this.approvalService.request(
      tenantId, campaignId, executionPlanId, operator.subject,
    );
    return this.approvalReadiness(approval);
  }

  async bindExecutionTarget(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, executionPlanId: string, connectionId?: string, adAccountId?: string) {
    const { membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertCanPrepareCampaign(membership.role);
    return this.executionSimulations.bindTarget(
      tenantId, campaignId, executionPlanId, connectionId, adAccountId,
    );
  }

  async getPlanApproval(authorizationHeader: string | undefined, tenantId: string,
    approvalId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.approvalService.get(tenantId, approvalId);
  }

  async decidePlanApproval(authorizationHeader: string | undefined, tenantId: string,
    approvalId: string, decision: string, reason?: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'decide_approval');
    if (decision === 'approve') {
      const approval = await this.approvalService.approve(tenantId, approvalId, operator.subject);
      return this.approvalReadiness(approval);
    }
    if (decision === 'reject') {
      const approval = await this.approvalService.reject(
        tenantId, approvalId, operator.subject, reason,
      );
      return this.approvalReadiness(approval);
    }
    if (decision === 'revoke') {
      const approval = await this.approvalService.revoke(
        tenantId, approvalId, operator.subject, reason,
      );
      return this.approvalReadiness(approval);
    }
    throw new BadRequestException({ code: 'invalid_approval_decision',
      message: 'Decision must be approve, reject or revoke' });
  }

  private async approvalReadiness(approval: import('../../domain/contracts/approval').ApprovalV1) {
    const readiness = await this.operationalReadiness.generate(
      approval.tenantId,
      approval.campaignId,
      approval.executionPlanId,
      approval.approvalId,
    );
    return {
      approval,
      readiness,
      boundaries: {
        approvalIsExecutionAuthorization: false as const,
        publicationAuthorized: false as const,
        externalWritesAllowed: false as const,
        externalWritesPerformed: false as const,
      },
    };
  }

  private async authenticate(authorizationHeader: string | undefined) {
    try {
      return await this.identity.authenticate(authorizationHeader);
    } catch (error) {
      if (error instanceof OperatorAuthenticationUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'operator_authentication_not_configured',
          message: 'Operator authentication is not configured',
        });
      }
      if (error instanceof InvalidOperatorCredentialsError) {
        throw new UnauthorizedException({
          code: 'invalid_operator_credentials',
          message: 'Operator authentication failed',
        });
      }
      throw error;
    }
  }

  private async authorizedMembership(
    authorizationHeader: string | undefined,
    tenantId: string,
  ) {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const membership = memberships.find((candidate) => candidate.tenantId === tenantId);
    if (!membership) {
      throw new UnauthorizedException({
        code: 'tenant_access_denied',
        message: 'Operator is not authorized for this tenant',
      });
    }
    return { operator, membership };
  }

  private assertCanPrepareCampaign(role: OperatorRole) {
    if (!PERMISSIONS[role].includes('manage_campaign_preparation')) {
      throw new UnauthorizedException({
        code: 'campaign_preparation_not_permitted',
        message: 'Operator cannot change campaign preparation',
      });
    }
  }

  private assertPermission(role: OperatorRole, permission: OperatorPermission) {
    if (!PERMISSIONS[role].includes(permission)) {
      throw new UnauthorizedException({
        code: `${permission}_not_permitted`,
        message: 'Operator role does not permit this approval action',
      });
    }
  }

  private accessEvent(
    tenantId: string,
    membershipId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: 'operator_tenant_access_listed',
      objectType: 'operator_tenant_membership',
      objectId: membershipId,
      newState: {
        accessType: 'read_only_workspace_selection',
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
  }

  private planListEvent(
    tenantId: string,
    membershipId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: 'operator_tenant_plans_listed',
      objectType: 'operator_tenant_membership',
      objectId: membershipId,
      newState: {
        accessType: 'read_only_plan_selection',
        latestPlanPerCampaign: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
  }

  private readinessAccessEvent(
    tenantId: string,
    readinessDecisionId: string,
    executionPlanId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: 'operator_operational_readiness_viewed',
      objectType: 'operational_readiness_decision',
      objectId: readinessDecisionId,
      newState: {
        accessType: 'read_only_operational_decision',
        executionPlanId,
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
  }

  private contextListEvent(
    tenantId: string,
    membershipId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: 'operator_campaign_contexts_listed',
      objectType: 'operator_tenant_membership',
      objectId: membershipId,
      newState: {
        accessType: 'read_only_campaign_context_selection',
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
  }
}
