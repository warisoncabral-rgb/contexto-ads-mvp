import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
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
  AuditTimelineRepository,
  OperatorPlanSelectionRepository,
  OperatorCampaignContextSelectionRepository,
  OperationalReadinessRepository,
  OperatorTenantMembershipRepository,
  OperatorWorkQueueSnapshotRepository,
} from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  AUDIT_TIMELINE_REPOSITORY,
  CAMPAIGN_CONTEXT_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  OPERATIONAL_READINESS_REPOSITORY,
  OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
  OPERATOR_WORK_QUEUE_SNAPSHOT_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { OPERATOR_IDENTITY } from '../../infrastructure/operator-access/operator-access.tokens';
import { CampaignContextService } from '../campaign-context/campaign-context.service';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';
import { ApprovalService } from '../approval/approval.service';
import { OperationalReadinessService } from '../operational-readiness/operational-readiness.service';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';
import { CreativePackageService } from '../creative-package/creative-package.service';
import { CreativePackageInputV1 } from '../../domain/contracts/creative-package';
import { ExecutionManifestService } from '../execution-manifest/execution-manifest.service';
import { ExecutionAuthorizationService } from '../execution-authorization/execution-authorization.service';
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaWriteValidationService } from '../meta-write-validation/meta-write-validation.service';
import { KillSwitchStatus } from '../../domain/contracts/kill-switch';
import { OperatorCampaignTimelineV1, OperatorTimelineItemV1 } from '../../domain/contracts/operator-timeline';
import { OperatorPortfolioItemV1, OperatorPortfolioV1 } from '../../domain/contracts/operator-portfolio';
import { OperatorWorkItemV1, OperatorWorkPriority, OperatorWorkQueueSourceDecisionV1, OperatorWorkQueueV1 } from '../../domain/contracts/operator-work-queue';

const TIMELINE_COPY: Record<string, Pick<OperatorTimelineItemV1, 'category' | 'title' | 'detail'>> = {
  operator_campaign_context_created: { category: 'context', title: 'Contexto da campanha criado', detail: 'Os fatos iniciais foram registrados e versionados.' },
  operator_campaign_context_updated: { category: 'context', title: 'Contexto atualizado', detail: 'Uma nova versão dos fatos substituiu a anterior sem apagar o histórico.' },
  operator_execution_plan_generated: { category: 'plan', title: 'Plano lógico gerado', detail: 'O Gerador consolidou estratégia, teto e objetos pausados.' },
  creative_package_version_created: { category: 'creative', title: 'Versão criativa registrada', detail: 'Textos, mídia e checklist receberam um hash imutável.' },
  creative_package_approved: { category: 'creative', title: 'Criativo aprovado', detail: 'O proprietário aprovou a versão e o hash criativo exatos.' },
  campaign_plan_approval_requested: { category: 'approval', title: 'Aprovação do plano solicitada', detail: 'Hash e teto financeiro foram enviados para decisão humana.' },
  campaign_plan_approved: { category: 'approval', title: 'Plano aprovado', detail: 'A decisão humana ficou vinculada ao hash e teto exatos.' },
  campaign_plan_rejected: { category: 'approval', title: 'Plano rejeitado', detail: 'A continuidade foi interrompida para revisão.' },
  campaign_plan_approval_revoked: { category: 'approval', title: 'Aprovação revogada', detail: 'A autorização anterior deixou de valer.' },
  operational_readiness_decided: { category: 'readiness', title: 'Prontidão recalculada', detail: 'Bloqueios e próxima ação foram consolidados novamente.' },
  execution_manifest_prepared: { category: 'executor', title: 'Manifesto preparado', detail: 'As operações pausadas foram ordenadas com idempotência e gate fechado.' },
  execution_authorization_requested: { category: 'executor', title: 'Autorização curta solicitada', detail: 'Uma decisão específica de alto risco foi aberta por 15 minutos.' },
  execution_authorization_approved: { category: 'executor', title: 'Autorização curta aprovada', detail: 'A decisão humana foi registrada, mas o gate continuou fechado.' },
  execution_authorization_rejected: { category: 'executor', title: 'Autorização curta rejeitada', detail: 'Nenhuma tentativa externa foi permitida.' },
  execution_authorization_revoked: { category: 'executor', title: 'Autorização curta revogada', detail: 'A decisão deixou de ser válida antes de qualquer tentativa.' },
  execution_preflight_blocked: { category: 'executor', title: 'Preflight bloqueado', detail: 'O diagnóstico interrompeu o fluxo antes de criar tentativa externa.' },
  kill_switch_engaged: { category: 'safety', title: 'Kill Switch acionado', detail: 'As escritas foram bloqueadas explicitamente.' },
  kill_switch_released: { category: 'safety', title: 'Kill Switch liberado', detail: 'A trava foi liberada, sem autorizar escrita por si só.' },
  meta_write_validation_protocol_prepared: { category: 'safety', title: 'Protocolo real preparado', detail: 'As onze evidências externas foram definidas, ainda não coletadas.' },
};

const PERMISSIONS: Record<OperatorRole, OperatorPermission[]> = {
  owner: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
    'decide_approval',
    'manage_execution_preflight',
    'decide_execution_authorization',
    'manage_kill_switch',
    'prepare_write_validation',
    'configure_tenant',
  ],
  operator: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
    'manage_execution_preflight',
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
    @Inject(AUDIT_TIMELINE_REPOSITORY)
    private readonly auditTimeline: AuditTimelineRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: OperatorPlanSelectionRepository,
    @Inject(OPERATIONAL_READINESS_REPOSITORY)
    private readonly readiness: OperationalReadinessRepository,
    @Inject(OPERATOR_WORK_QUEUE_SNAPSHOT_REPOSITORY)
    private readonly workQueueSnapshots: OperatorWorkQueueSnapshotRepository,
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly campaignContextSelection: OperatorCampaignContextSelectionRepository,
    private readonly campaignContexts: CampaignContextService,
    private readonly executionPlans: ExecutionPlanService,
    private readonly approvalService: ApprovalService,
    private readonly operationalReadiness: OperationalReadinessService,
    private readonly executionSimulations: ExecutionSimulationService,
    private readonly creativePackages: CreativePackageService,
    private readonly executionManifests: ExecutionManifestService,
    private readonly executionAuthorizations: ExecutionAuthorizationService,
    private readonly killSwitch: KillSwitchService,
    private readonly metaWriteValidation: MetaWriteValidationService,
  ) {}

  async authorizeTenantConfiguration(
    authorizationHeader: string | undefined,
    tenantId: string,
  ) {
    const context = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(context.membership.role, 'configure_tenant');
    return context;
  }

  async authorizeCampaignPreparation(
    authorizationHeader: string | undefined,
    tenantId: string,
  ) {
    const context = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertCanPrepareCampaign(context.membership.role);
    return context;
  }

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

  async portfolio(authorizationHeader: string | undefined): Promise<OperatorPortfolioV1> {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const rows = await Promise.all(memberships.map(async (membership) => {
      const plans = await this.plans.listLatestForTenant(membership.tenantId);
      return Promise.all(plans.map(async (plan): Promise<OperatorPortfolioItemV1> => {
        if (plan.tenantId !== membership.tenantId) throw new ServiceUnavailableException({
          code: 'portfolio_scope_inconsistent', message: 'Portfolio scope is inconsistent',
        });
        const decision = await this.readiness.latestForPlan(membership.tenantId, plan.executionPlanId);
        if (decision && (decision.tenantId !== membership.tenantId
          || decision.campaignId !== plan.campaignId
          || decision.executionPlanId !== plan.executionPlanId)) {
          throw new ServiceUnavailableException({
            code: 'portfolio_readiness_inconsistent', message: 'Portfolio readiness is inconsistent',
          });
        }
        return {
          tenantId: membership.tenantId,
          tenantDisplayName: membership.tenantDisplayName,
          role: membership.role,
          campaignId: plan.campaignId,
          executionPlanId: plan.executionPlanId,
          planStatus: plan.status,
          readinessStatus: decision?.status ?? 'not_evaluated',
          headline: decision?.headline ?? 'Prontidão operacional ainda não calculada',
          nextAction: decision?.nextAction ?? 'Calcular a prontidão operacional deste plano.',
          blockerCount: decision?.blockers.length ?? 0,
          maximumPlannedSpendMinor: plan.financials.maximumPlannedSpendMinor,
          currency: plan.financials.currency,
          updatedAt: decision?.generatedAt ?? plan.createdAt,
        };
      }));
    }));
    const priority = { blocked: 0, action_required: 1, not_evaluated: 2,
      ready_for_executor_validation: 3 } as const;
    const items = rows.flat().sort((a, b) => priority[a.readinessStatus]
      - priority[b.readinessStatus] || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
      || a.campaignId.localeCompare(b.campaignId));
    const generatedAt = new Date().toISOString();
    await Promise.all(memberships.map((membership) => this.audit.append(
      this.portfolioAccessEvent(membership.tenantId, membership.membershipId,
        operator.subject, generatedAt),
    )));
    return {
      items,
      summary: {
        authorizedTenantCount: memberships.length,
        campaignCount: items.length,
        blockedCount: items.filter((item) => item.readinessStatus === 'blocked').length,
        actionRequiredCount: items.filter((item) => item.readinessStatus === 'action_required').length,
        readyCount: items.filter((item) => item.readinessStatus === 'ready_for_executor_validation').length,
        notEvaluatedCount: items.filter((item) => item.readinessStatus === 'not_evaluated').length,
      },
      boundaries: { tenantAccessDerivedFromMembership: true, latestPlanPerCampaign: true,
        priorityRuleIsDeterministic: true, publicationAuthorized: false,
        externalWritesAllowed: false, externalWritesPerformed: false },
      generatedAt,
    };
  }

  async workQueue(authorizationHeader: string | undefined): Promise<OperatorWorkQueueV1> {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const rows = await Promise.all(memberships.map(async (membership) => {
      const plans = await this.plans.listLatestForTenant(membership.tenantId);
      return Promise.all(plans.map(async (plan): Promise<OperatorWorkItemV1[]> => {
        if (plan.tenantId !== membership.tenantId) throw new ServiceUnavailableException({
          code: 'work_queue_scope_inconsistent', message: 'Work queue scope is inconsistent',
        });
        const decision = await this.readiness.latestForPlan(membership.tenantId, plan.executionPlanId);
        if (decision && (decision.tenantId !== membership.tenantId
          || decision.campaignId !== plan.campaignId
          || decision.executionPlanId !== plan.executionPlanId)) {
          throw new ServiceUnavailableException({
            code: 'work_queue_readiness_inconsistent', message: 'Work queue readiness is inconsistent',
          });
        }
        const common = { tenantId: membership.tenantId,
          tenantDisplayName: membership.tenantDisplayName, role: membership.role,
          campaignId: plan.campaignId, executionPlanId: plan.executionPlanId };
        if (!decision) return [{ ...common,
          workItemId: this.workItemId(plan.executionPlanId, 'readiness_not_evaluated'),
          source: 'readiness_not_evaluated', blockerCode: 'readiness_not_evaluated',
          owner: 'system', priority: 'normal',
          meaning: 'A prontidão operacional deste plano ainda não foi calculada.',
          nextAction: 'Calcular a prontidão operacional usando as evidências atuais.',
          evidenceRefs: [`execution_plan:${plan.executionPlanId}`], observedAt: plan.createdAt,
        }];
        return decision.blockers.map((blocker) => ({ ...common,
          workItemId: this.workItemId(plan.executionPlanId, blocker.code),
          source: 'operational_blocker' as const, blockerCode: blocker.code,
          owner: blocker.owner, priority: this.workPriority(decision.status, blocker.owner),
          meaning: blocker.meaning, nextAction: blocker.nextAction,
          evidenceRefs: [...blocker.evidenceRefs], observedAt: decision.generatedAt,
        }));
      }));
    }));
    const priority = { critical: 0, high: 1, normal: 2 } as const;
    const items = rows.flat(2).sort((a, b) => priority[a.priority] - priority[b.priority]
      || a.tenantDisplayName.localeCompare(b.tenantDisplayName)
      || a.campaignId.localeCompare(b.campaignId) || a.blockerCode.localeCompare(b.blockerCode));
    const generatedAt = new Date().toISOString();
    const sourceDecisions: OperatorWorkQueueSourceDecisionV1[] = [
      { source: 'campaign_plans', status: 'included',
        reason: 'Planos mais recentes por campanha foram carregados do PostgreSQL.' },
      { source: 'operational_readiness', status: 'included',
        reason: 'Bloqueios atuais foram derivados das decisões persistidas de prontidão.' },
      { source: 'execution_lifecycle', status: 'deferred',
        reason: 'Nenhum registro de execução real autorizado existe neste estágio somente leitura.' },
      { source: 'delivery_metrics', status: 'ignored',
        reason: 'Não existe fonte externa de métricas verificada; nenhum desempenho foi inferido.' },
    ];
    const queueDate = generatedAt.slice(0, 10);
    const snapshots = await Promise.all(memberships.map(async (membership) => {
      const tenantItems = items.filter((item) => item.tenantId === membership.tenantId);
      const snapshotHash = createHash('sha256').update(JSON.stringify({
        tenantId: membership.tenantId, queueDate, items: tenantItems, sourceDecisions,
      })).digest('hex');
      return this.workQueueSnapshots.saveDaily({ snapshotId: randomUUID(),
        tenantId: membership.tenantId, queueDate, calendarBasis: 'UTC', snapshotHash,
        itemCount: tenantItems.length, sourceDecisions, generatedAt }, tenantItems);
    }));
    await Promise.all(memberships.map((membership) => this.audit.append(
      this.workQueueAccessEvent(membership.tenantId, membership.membershipId,
        operator.subject, generatedAt),
    )));
    return { items, snapshots, summary: { authorizedTenantCount: memberships.length,
      pendingItemCount: items.length,
      criticalCount: items.filter((item) => item.priority === 'critical').length,
      operatorCount: items.filter((item) => item.owner === 'operator').length,
      systemCount: items.filter((item) => item.owner === 'system').length,
      metaEnvironmentCount: items.filter((item) => item.owner === 'meta_environment').length },
      boundaries: { derivedFromCurrentReadiness: true, tenantAccessDerivedFromMembership: true,
        priorityRuleIsDeterministic: true, deadlinesFabricated: false, completionInferred: false,
        dailySnapshotsPersisted: true,
        publicationAuthorized: false, externalWritesAllowed: false, externalWritesPerformed: false },
      generatedAt };
  }

  private workPriority(status: 'blocked' | 'action_required' | 'ready_for_executor_validation',
    owner: OperatorWorkItemV1['owner']): OperatorWorkPriority {
    if (status === 'blocked') return 'critical';
    if (status === 'action_required' || owner === 'operator') return 'high';
    return 'normal';
  }

  private workItemId(executionPlanId: string, code: string) {
    return createHash('sha256').update(`${executionPlanId}:${code}`).digest('hex');
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
        ...(plan.meta?.connectionId ? { connectionId: plan.meta.connectionId } : {}),
        ...(plan.meta?.adAccountId ? { adAccountId: plan.meta.adAccountId } : {}),
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

  async campaignTimeline(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, executionPlanId: string): Promise<OperatorCampaignTimelineV1> {
    await this.authorizedMembership(authorizationHeader, tenantId);
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan || plan.campaignId !== campaignId) throw new NotFoundException({
      code: 'campaign_timeline_not_found', message: 'Campaign timeline not found',
    });
    const events = await this.auditTimeline.listForCampaign(tenantId, campaignId, 100);
    const actors: Record<import('../../domain/contracts/audit-event').AuditEvent['actorType'], OperatorTimelineItemV1['actor']> = {
      user: 'Usuário autenticado', system: 'Sistema', contexto_ads: 'Contexto Ads',
      generator: 'Gerador', analyst: 'Analista', meta_adapter: 'Adaptador Meta',
    };
    return {
      tenantId, campaignId, executionPlanId,
      items: events.flatMap((event) => {
        const copy = TIMELINE_COPY[event.eventType];
        return copy ? [{ auditEventId: event.auditEventId, ...copy, result: event.result,
          actor: actors[event.actorType], evidenceRef: `${event.objectType ?? 'audit_event'}:${event.objectId ?? event.auditEventId}`,
          createdAt: event.createdAt }] : [];
      }),
      boundaries: { sanitizedOperationalHistory: true, immutableAuditSource: true,
        secretsExposed: false, publicationAuthorized: false, externalWritesAllowed: false,
        externalWritesPerformed: false }, generatedAt: new Date().toISOString(),
    };
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

  async appendCreativePackage(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, executionPlanId: string, creative?: CreativePackageInputV1) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertCanPrepareCampaign(membership.role);
    const result = await this.creativePackages.appendVersion(
      tenantId, campaignId, executionPlanId, creative, operator.subject,
    );
    return this.creativeReadiness(result);
  }

  async approveCreativePackage(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, version: number, contentHash?: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'decide_approval');
    const result = await this.creativePackages.approve(
      tenantId, campaignId, version, contentHash, operator.subject,
    );
    return this.creativeReadiness(result);
  }

  async latestCreativePackage(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.creativePackages.latest(tenantId, campaignId);
  }

  async prepareExecutionManifest(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string, executionPlanId: string, approvalId?: string) {
    const { membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'manage_execution_preflight');
    return this.executionManifests.prepare(tenantId, campaignId, executionPlanId, approvalId);
  }

  async latestExecutionManifest(authorizationHeader: string | undefined, tenantId: string,
    executionPlanId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.executionManifests.latest(tenantId, executionPlanId);
  }

  async requestExecutionAuthorization(authorizationHeader: string | undefined, tenantId: string,
    executionManifestId: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'manage_execution_preflight');
    return this.executionAuthorizations.request(tenantId, executionManifestId, operator.subject);
  }

  async getExecutionAuthorization(authorizationHeader: string | undefined, tenantId: string,
    executionAuthorizationId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.executionAuthorizations.get(tenantId, executionAuthorizationId);
  }

  async decideExecutionAuthorization(authorizationHeader: string | undefined, tenantId: string,
    executionAuthorizationId: string, decision: string, reason?: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'decide_execution_authorization');
    if (decision === 'approve') return this.executionAuthorizations.approve(
      tenantId, executionAuthorizationId, operator.subject,
    );
    if (decision === 'reject') return this.executionAuthorizations.reject(
      tenantId, executionAuthorizationId, operator.subject, reason,
    );
    if (decision === 'revoke') return this.executionAuthorizations.revoke(
      tenantId, executionAuthorizationId, operator.subject, reason,
    );
    throw new BadRequestException({ code: 'invalid_execution_authorization_decision',
      message: 'Decision must be approve, reject or revoke' });
  }

  async runExecutionPreflight(authorizationHeader: string | undefined, tenantId: string,
    executionAuthorizationId: string) {
    const { membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'manage_execution_preflight');
    return this.executionAuthorizations.preflight(tenantId, executionAuthorizationId);
  }

  async changeKillSwitch(authorizationHeader: string | undefined, tenantId: string,
    scope: 'tenant' | 'campaign', campaignId: string | undefined,
    status: KillSwitchStatus, reason: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'manage_kill_switch');
    if (!['tenant', 'campaign'].includes(scope)) {
      throw new BadRequestException({ code: 'invalid_kill_switch_scope',
        message: 'Scope must be tenant or campaign' });
    }
    return scope === 'tenant'
      ? this.killSwitch.changeTenant(tenantId, status, operator.subject, reason)
      : this.killSwitch.changeCampaign(tenantId, campaignId, status, operator.subject, reason);
  }

  async effectiveKillSwitch(authorizationHeader: string | undefined, tenantId: string,
    campaignId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.killSwitch.effective(tenantId, campaignId);
  }

  async prepareMetaWriteValidation(authorizationHeader: string | undefined, tenantId: string,
    executionManifestId: string) {
    const { operator, membership } = await this.authorizedMembership(authorizationHeader, tenantId);
    this.assertPermission(membership.role, 'prepare_write_validation');
    return this.metaWriteValidation.prepare(tenantId, executionManifestId, operator.subject);
  }

  async latestMetaWriteValidation(authorizationHeader: string | undefined, tenantId: string,
    executionManifestId: string) {
    await this.authorizedMembership(authorizationHeader, tenantId);
    return this.metaWriteValidation.latest(tenantId, executionManifestId);
  }

  private async creativeReadiness(result: Awaited<ReturnType<CreativePackageService['appendVersion']>>) {
    const readiness = await this.operationalReadiness.generate(
      result.executionPlan.tenantId, result.executionPlan.campaignId,
      result.executionPlan.executionPlanId,
    );
    return {
      ...result,
      readiness,
      boundaries: {
        creativeApprovalIsPlanApproval: false as const,
        publicationAuthorized: false as const,
        externalWritesAllowed: false as const,
        externalWritesPerformed: false as const,
      },
    };
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

  private portfolioAccessEvent(
    tenantId: string,
    membershipId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(), tenantId, correlationId: randomUUID(),
      actorType: 'user', actorId: operatorSubject,
      eventType: 'operator_portfolio_viewed', objectType: 'operator_tenant_membership',
      objectId: membershipId,
      newState: { accessType: 'read_only_portfolio', latestPlanPerCampaign: true,
        publicationAuthorized: false, externalWritesAllowed: false },
      result: 'info', createdAt,
    };
  }

  private workQueueAccessEvent(tenantId: string, membershipId: string,
    operatorSubject: string, createdAt: string): AuditEvent {
    return { auditEventId: randomUUID(), tenantId, correlationId: randomUUID(),
      actorType: 'user', actorId: operatorSubject, eventType: 'operator_work_queue_viewed',
      objectType: 'operator_tenant_membership', objectId: membershipId,
      newState: { accessType: 'read_only_work_queue', derivedFromCurrentReadiness: true,
        deadlinesFabricated: false, publicationAuthorized: false, externalWritesAllowed: false },
      result: 'info', createdAt };
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
