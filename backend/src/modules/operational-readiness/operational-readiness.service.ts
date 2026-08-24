import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionSimulationCheck } from '../../domain/contracts/execution-simulation';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  OperationalBlockerV1,
  OperationalReadinessDecisionV1,
  OperationalReadinessStatus,
} from '../../domain/contracts/operational-readiness';
import {
  ExecutionPlanRepository,
  OperationalReadinessRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_PLAN_REPOSITORY,
  OPERATIONAL_READINESS_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';

const PRIORITY: Record<ExecutionSimulationCheck['key'], number> = {
  plan_current: 1,
  dependency_graph: 2,
  external_write_guard: 3,
  meta_connection: 4,
  ad_account_binding: 5,
  write_capabilities: 6,
  creative_approval: 7,
  plan_approval: 8,
};

@Injectable()
export class OperationalReadinessService {
  constructor(
    private readonly simulations: ExecutionSimulationService,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(OPERATIONAL_READINESS_REPOSITORY)
    private readonly decisions: OperationalReadinessRepository,
  ) {}

  async generate(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    approvalId?: unknown,
  ): Promise<OperationalReadinessDecisionV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    if (approvalId !== undefined) this.assertUuid(approvalId, 'approvalId');
    const plan = await this.plan(tenantId, campaignId, executionPlanId);
    const previousSimulation = approvalId === undefined
      ? await this.simulations.latestSimulation(tenantId, executionPlanId)
      : null;
    const effectiveApprovalId = approvalId as string | undefined
      ?? previousSimulation?.approvalId;
    const simulation = await this.simulations.simulate(
      tenantId,
      campaignId,
      executionPlanId,
      effectiveApprovalId,
    );
    const blockers = simulation.checks
      .filter((check) => check.status === 'blocked')
      .sort((left, right) => PRIORITY[left.key] - PRIORITY[right.key])
      .map((check): OperationalBlockerV1 => ({
        code: check.key,
        owner: this.owner(check.key),
        meaning: check.meaning,
        nextAction: check.nextAction ?? this.defaultNextAction(check.key),
        evidenceRefs: check.evidenceRefs,
      }));
    const status = this.status(simulation.status, blockers);
    const progress = {
      campaignPreparation: simulation.status === 'ready_for_execution'
        ? 'complete' as const
        : 'incomplete' as const,
      metaEnvironmentValidation: this.passed(
        simulation.checks,
        ['meta_connection', 'ad_account_binding', 'write_capabilities'],
      ) ? 'complete' as const : 'pending' as const,
      creativeApproval: this.passed(simulation.checks, ['creative_approval'])
        ? 'complete' as const : 'pending' as const,
      humanPlanApproval: this.passed(simulation.checks, ['plan_approval'])
        ? 'complete' as const : 'pending' as const,
      executorValidation: 'pending' as const,
      publication: 'not_started' as const,
      activation: 'not_started' as const,
      delivery: 'not_started' as const,
    };
    const boundaries = {
      campaignPublished: false as const,
      campaignActive: false as const,
      campaignDelivering: false as const,
      externalWritesAllowed: false as const,
      externalWritesPerformed: false as const,
    };
    const semantic = {
      purpose: 'operational_readiness_decision_v1',
      tenantId,
      campaignId,
      executionPlanId,
      planHash: plan.planHash,
      status,
      checks: simulation.checks.map((check) => ({
        key: check.key,
        status: check.status,
        meaning: check.meaning,
        nextAction: check.nextAction,
        evidenceRefs: check.evidenceRefs,
      })),
      blockers,
      progress,
      financials: plan.financials,
      autonomy: plan.autonomy,
      boundaries,
    };
    const now = new Date().toISOString();
    const decision: OperationalReadinessDecisionV1 = {
      readinessDecisionId: randomUUID(),
      tenantId,
      campaignId,
      executionPlanId,
      planHash: plan.planHash,
      simulationId: simulation.simulationId,
      decisionHash: this.hash(semantic),
      status,
      headline: this.headline(status),
      plainLanguageSummary: this.summary(status, blockers.length),
      decisionBasis: [
        {
          decision: this.headline(status),
          why: status === 'ready_for_executor_validation'
            ? 'Todos os controles internos passaram, mas o executor real ainda não foi validado.'
            : `${blockers.length} controle(s) ainda impedem avanço seguro.`,
          evidenceRefs: [
            `execution_plan:${plan.executionPlanId}`,
            `plan_hash:${plan.planHash}`,
            `simulation:${simulation.simulationId}`,
          ],
        },
        {
          decision: `Limite financeiro: ${plan.financials.maximumPlannedSpendMinor} unidades mínimas de ${plan.financials.currency}.`,
          why: plan.financials.calculation,
          evidenceRefs: [`plan_hash:${plan.planHash}`],
        },
        {
          decision: 'Manter publicação, ativação e entrega como não iniciadas.',
          why: 'Esta etapa apenas valida e explica; não existe executor de escrita habilitado.',
          evidenceRefs: [
            'system:external_writes_allowed_false',
            'system:external_writes_performed_false',
          ],
        },
      ],
      blockers,
      nextAction: blockers[0]?.nextAction
        ?? 'Validar o executor real em ambiente Meta controlado, mantendo todos os objetos pausados.',
      progress,
      financialScope: {
        currency: plan.financials.currency,
        maximumPlannedSpendMinor: plan.financials.maximumPlannedSpendMinor,
        calculation: plan.financials.calculation,
      },
      autonomy: {
        level: plan.autonomy.level,
        humanApprovalRequired: plan.autonomy.approvalRequired,
      },
      boundaries,
      generatedAt: now,
    };
    return this.decisions.saveIdempotent(
      decision,
      this.event(decision, now),
    );
  }

  async latest(
    tenantId: unknown,
    executionPlanId: unknown,
  ): Promise<OperationalReadinessDecisionV1 | null> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    return this.decisions.latestForPlan(tenantId, executionPlanId);
  }

  private async plan(
    tenantId: string,
    campaignId: string,
    executionPlanId: string,
  ): Promise<ExecutionPlanV1> {
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan || plan.campaignId !== campaignId) {
      throw new NotFoundException('Execution plan not found');
    }
    return plan;
  }

  private status(
    simulationStatus: 'blocked' | 'ready_for_execution',
    blockers: OperationalBlockerV1[],
  ): OperationalReadinessStatus {
    if (simulationStatus === 'ready_for_execution') return 'ready_for_executor_validation';
    return blockers.some((blocker) => blocker.owner === 'system')
      ? 'blocked'
      : 'action_required';
  }

  private owner(key: ExecutionSimulationCheck['key']): OperationalBlockerV1['owner'] {
    if (['meta_connection', 'ad_account_binding', 'write_capabilities'].includes(key)) {
      return 'meta_environment';
    }
    if (['creative_approval', 'plan_approval'].includes(key)) return 'operator';
    return 'system';
  }

  private defaultNextAction(key: ExecutionSimulationCheck['key']): string {
    const actions: Record<ExecutionSimulationCheck['key'], string> = {
      plan_current: 'Gerar uma decisão usando o plano mais recente.',
      dependency_graph: 'Regenerar o plano com dependências válidas.',
      meta_connection: 'Conectar e validar a conta Meta.',
      ad_account_binding: 'Selecionar uma conta de anúncios descoberta.',
      write_capabilities: 'Comprovar as permissões exigidas no ambiente Meta real.',
      creative_approval: 'Revisar e aprovar o pacote criativo mais recente.',
      plan_approval: 'Aprovar o hash e o limite financeiro atuais.',
      external_write_guard: 'Restaurar a trava que proíbe escrita externa.',
    };
    return actions[key];
  }

  private passed(
    checks: ExecutionSimulationCheck[],
    keys: ExecutionSimulationCheck['key'][],
  ): boolean {
    return keys.every((key) => checks.some((check) =>
      check.key === key && check.status === 'passed'));
  }

  private headline(status: OperationalReadinessStatus): string {
    if (status === 'blocked') return 'Há um bloqueio técnico que impede avançar com segurança.';
    if (status === 'action_required') return 'A campanha ainda precisa de ações antes da execução.';
    return 'A preparação interna está completa; falta validar o executor real.';
  }

  private summary(status: OperationalReadinessStatus, blockerCount: number): string {
    if (status === 'blocked') {
      return `O sistema encontrou ${blockerCount} bloqueio(s), incluindo uma falha técnica interna. Nada será publicado.`;
    }
    if (status === 'action_required') {
      return `O sistema encontrou ${blockerCount} pendência(s) de configuração ou aprovação. Nada será publicado até todas serem resolvidas.`;
    }
    return 'Plano, alvo, permissões, criativos e aprovação passaram na simulação. Isso não significa publicado, ativo ou entregando.';
  }

  private event(decision: OperationalReadinessDecisionV1, createdAt: string): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: decision.tenantId,
      correlationId: randomUUID(),
      actorType: 'system',
      eventType: 'operational_readiness_decided',
      objectType: 'operational_readiness_decision',
      objectId: decision.readinessDecisionId,
      newState: {
        status: decision.status,
        decisionHash: decision.decisionHash,
        blockerCodes: decision.blockers.map((blocker) => blocker.code),
        externalWritesAllowed: false,
      },
      result: decision.status === 'blocked' ? 'blocked' : 'info',
      createdAt,
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
