import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ApprovalV1 } from '../../domain/contracts/approval';
import { CapabilityRecord } from '../../domain/contracts/capability';
import {
  ExecutionSimulationCheck,
  ExecutionSimulationReportV1,
  SimulatedOperation,
} from '../../domain/contracts/execution-simulation';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  ApprovalRepository,
  ExecutionPlanRepository,
  ExecutionSimulationRepository,
} from '../../domain/ports/repositories';
import {
  APPROVAL_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  EXECUTION_SIMULATION_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { ApprovalService } from '../approval/approval.service';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

@Injectable()
export class ExecutionSimulationService {
  constructor(
    private readonly connections: MetaConnectionService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly approvalService: ApprovalService,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(APPROVAL_REPOSITORY)
    private readonly approvals: ApprovalRepository,
    @Inject(EXECUTION_SIMULATION_REPOSITORY)
    private readonly simulations: ExecutionSimulationRepository,
  ) {}

  async bindTarget(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    connectionId: unknown,
    adAccountId: unknown,
  ): Promise<ExecutionPlanV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    this.assertUuid(connectionId, 'connectionId');
    this.assertAdAccountId(adAccountId);
    const source = await this.currentPlan(tenantId, campaignId, executionPlanId);
    const connection = await this.connections.getConnection(tenantId, connectionId);
    if (!['connected', 'ready'].includes(connection.status)) {
      throw new ConflictException({
        code: 'meta_connection_not_ready',
        message: 'Meta connection must be connected before target binding',
      });
    }
    const assets = await this.connections.listAssets(tenantId, connectionId);
    const account = assets.find(
      (asset) => asset.assetType === 'ad_account' && asset.externalId === adAccountId,
    );
    if (!account) throw new NotFoundException('Discovered Meta ad account not found');

    if (source.meta.connectionId === connectionId
      && source.meta.adAccountId === adAccountId) {
      await this.approvals.invalidateForCampaignExceptHash(
        tenantId,
        campaignId,
        source.planHash,
        new Date().toISOString(),
      );
      return source;
    }

    const readiness = source.readiness.map((check) => check.key === 'meta_execution_target'
      ? {
        key: 'meta_execution_target',
        status: 'passed' as const,
        meaning: 'A conexão e a conta de anúncios foram vinculadas a partir dos ativos descobertos.',
        evidenceRefs: [
          `meta_connection:${connectionId}`,
          `meta_ad_account:${adAccountId}`,
        ],
        source: 'system' as const,
      }
      : check);
    const decisions = [
      ...source.decisions.filter((decision) => decision.category !== 'execution_target'),
      {
        decisionId: 'execution_target_binding',
        category: 'execution_target' as const,
        ruleId: 'discovered_tenant_asset_only_v1',
        inputRefs: [
          `meta_connection:${connectionId}`,
          `meta_ad_account:${adAccountId}`,
        ],
        outcome: { connectionId, adAccountId },
        rationale: 'O alvo foi aceito somente após comprovar que pertence aos ativos descobertos do tenant.',
      },
    ];
    const risks = source.risks.filter((risk) => risk.code !== 'meta_target_not_selected');
    const planHash = this.hash({
      purpose: 'execution_target_binding_v1',
      sourcePlanHash: source.planHash,
      tenantId,
      campaignId,
      connectionId,
      adAccountId,
    });
    const derived: ExecutionPlanV1 = {
      ...source,
      executionPlanId: randomUUID(),
      correlationId: randomUUID(),
      planHash,
      idempotencyKey: this.hash({
        purpose: 'execution_target_binding_idempotency_v1',
        tenantId,
        campaignId,
        sourcePlanHash: source.planHash,
        connectionId,
        adAccountId,
      }),
      status: 'draft',
      meta: {
        connectionId,
        adAccountId,
        assetBindings: [`ad_account:${adAccountId}`],
        requiredCapabilities: source.meta.requiredCapabilities,
      },
      readiness,
      decisions,
      risks,
      autonomy: { level: 'A0', approvalRequired: true },
      externalEffects: { writesAllowed: false, writesPerformed: false },
      createdAt: new Date().toISOString(),
    };
    const persisted = await this.plans.saveIdempotent(derived);
    await this.approvals.invalidateForCampaignExceptHash(
      tenantId,
      campaignId,
      persisted.planHash,
      persisted.createdAt,
    );
    return persisted;
  }

  async simulate(
    tenantId: unknown,
    campaignId: unknown,
    executionPlanId: unknown,
    approvalId?: unknown,
  ): Promise<ExecutionSimulationReportV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    if (approvalId !== undefined) this.assertUuid(approvalId, 'approvalId');
    const plan = await this.currentPlan(tenantId, campaignId, executionPlanId);
    const checks: ExecutionSimulationCheck[] = [{
      key: 'plan_current',
      status: 'passed',
      meaning: 'O plano informado é a versão mais recente da campanha.',
      evidenceRefs: [`execution_plan:${plan.executionPlanId}`, `plan_hash:${plan.planHash}`],
    }];

    const graph = this.operationSequence(plan);
    checks.push(graph.valid ? {
      key: 'dependency_graph',
      status: 'passed',
      meaning: 'As dependências formam uma sequência executável sem ciclos.',
      evidenceRefs: graph.operations.map((operation) =>
        `logical_object:${operation.internalObjectId}`),
    } : {
      key: 'dependency_graph',
      status: 'blocked',
      meaning: graph.reason,
      nextAction: 'Gerar um novo plano com dependências completas e sem ciclos.',
      evidenceRefs: [],
    });

    const target = await this.targetChecks(tenantId, plan);
    checks.push(...target.checks);
    checks.push(this.capabilityCheck(plan, target.capabilities));
    checks.push(await this.approvalCheck(tenantId, plan, approvalId as string | undefined));
    checks.push(this.creativeCheck(plan));
    checks.push(plan.externalEffects.writesAllowed || plan.externalEffects.writesPerformed ? {
      key: 'external_write_guard',
      status: 'blocked',
      meaning: 'O plano contém sinalização incompatível com uma simulação segura.',
      nextAction: 'Regenerar o plano com efeitos externos desabilitados.',
      evidenceRefs: [],
    } : {
      key: 'external_write_guard',
      status: 'passed',
      meaning: 'A simulação está tecnicamente impedida de realizar escrita externa.',
      evidenceRefs: ['system:writes_allowed_false', 'system:writes_performed_false'],
    });

    const blockers = checks
      .filter((check) => check.status === 'blocked')
      .map((check) => check.key);
    const report: ExecutionSimulationReportV1 = {
      simulationId: randomUUID(),
      tenantId,
      campaignId,
      executionPlanId,
      planHash: plan.planHash,
      ...(approvalId ? { approvalId } : {}),
      status: blockers.length === 0 ? 'ready_for_execution' : 'blocked',
      checks,
      operations: graph.operations,
      blockers,
      externalEffects: { writesAllowed: false, writesPerformed: false },
      generatedAt: new Date().toISOString(),
    };
    await this.simulations.save(report);
    return report;
  }

  async latestSimulation(
    tenantId: unknown,
    executionPlanId: unknown,
  ): Promise<ExecutionSimulationReportV1 | null> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionPlanId, 'executionPlanId');
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    return this.simulations.latestForPlan(tenantId, executionPlanId);
  }

  private async currentPlan(
    tenantId: string,
    campaignId: string,
    executionPlanId: string,
  ): Promise<ExecutionPlanV1> {
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
        message: 'Only the latest campaign plan can be used',
      });
    }
    return plan;
  }

  private async targetChecks(
    tenantId: string,
    plan: ExecutionPlanV1,
  ): Promise<{ checks: ExecutionSimulationCheck[]; capabilities: CapabilityRecord[] }> {
    const connectionId = plan.meta.connectionId;
    const adAccountId = plan.meta.adAccountId;
    if (!connectionId || !adAccountId) {
      return {
        checks: [
          {
            key: 'meta_connection',
            status: 'blocked',
            meaning: 'Nenhuma conexão Meta foi vinculada ao plano.',
            nextAction: 'Vincular uma conexão e conta descobertas ao plano.',
            evidenceRefs: [],
          },
          {
            key: 'ad_account_binding',
            status: 'blocked',
            meaning: 'Nenhuma conta de anúncios foi vinculada ao plano.',
            nextAction: 'Selecionar uma conta descoberta do mesmo tenant.',
            evidenceRefs: [],
          },
        ],
        capabilities: [],
      };
    }
    try {
      const connection = await this.connections.getConnection(tenantId, connectionId);
      const connectionReady = ['connected', 'ready'].includes(connection.status);
      const assets = connectionReady
        ? await this.connections.listAssets(tenantId, connectionId)
        : [];
      const account = assets.find(
        (asset) => asset.assetType === 'ad_account' && asset.externalId === adAccountId,
      );
      const capabilities = connectionReady
        ? await this.capabilities.list(tenantId, connectionId)
        : [];
      return {
        checks: [
          connectionReady ? {
            key: 'meta_connection',
            status: 'passed',
            meaning: 'A conexão Meta vinculada continua pronta.',
            evidenceRefs: [`meta_connection:${connectionId}`],
          } : {
            key: 'meta_connection',
            status: 'blocked',
            meaning: `A conexão Meta está no estado ${connection.status}.`,
            nextAction: 'Restabelecer e validar a conexão antes da execução.',
            evidenceRefs: [`meta_connection:${connectionId}`],
          },
          account ? {
            key: 'ad_account_binding',
            status: 'passed',
            meaning: 'A conta de anúncios permanece no snapshot descoberto da conexão.',
            evidenceRefs: [`meta_ad_account:${adAccountId}`],
          } : {
            key: 'ad_account_binding',
            status: 'blocked',
            meaning: 'A conta vinculada não está no snapshot atual de ativos descobertos.',
            nextAction: 'Redescobrir ativos e vincular uma conta válida.',
            evidenceRefs: [],
          },
        ],
        capabilities,
      };
    } catch {
      return {
        checks: [
          {
            key: 'meta_connection',
            status: 'blocked',
            meaning: 'A conexão vinculada não pôde ser comprovada para este tenant.',
            nextAction: 'Reconectar a conta Meta dentro do tenant correto.',
            evidenceRefs: [],
          },
          {
            key: 'ad_account_binding',
            status: 'blocked',
            meaning: 'A propriedade da conta de anúncios não pôde ser comprovada.',
            nextAction: 'Executar novamente a descoberta de ativos.',
            evidenceRefs: [],
          },
        ],
        capabilities: [],
      };
    }
  }

  private capabilityCheck(
    plan: ExecutionPlanV1,
    capabilities: CapabilityRecord[],
  ): ExecutionSimulationCheck {
    const available = capabilities.filter((record) => record.status === 'available');
    const missing = plan.meta.requiredCapabilities.filter((required) =>
      !available.some((record) => record.capabilityType === required
        && (!record.assetScope || record.assetScope === plan.meta.adAccountId)));
    return missing.length === 0 ? {
      key: 'write_capabilities',
      status: 'passed',
      meaning: 'Todas as capacidades exigidas pelo plano possuem evidência disponível.',
      evidenceRefs: available
        .filter((record) => plan.meta.requiredCapabilities.includes(record.capabilityType))
        .map((record) => `capability:${record.capabilityId}`),
    } : {
      key: 'write_capabilities',
      status: 'blocked',
      meaning: `Capacidades ainda não comprovadas: ${missing.join(', ')}.`,
      nextAction: 'Validar as permissões e capacidades de escrita no ambiente Meta real.',
      evidenceRefs: [],
    };
  }

  private async approvalCheck(
    tenantId: string,
    plan: ExecutionPlanV1,
    approvalId?: string,
  ): Promise<ExecutionSimulationCheck> {
    if (!approvalId) {
      return {
        key: 'plan_approval',
        status: 'blocked',
        meaning: 'Nenhuma aprovação foi apresentada para o plano.',
        nextAction: 'Solicitar e concluir a aprovação do hash atual.',
        evidenceRefs: [],
      };
    }
    let approval: ApprovalV1;
    try {
      approval = await this.approvalService.get(tenantId, approvalId);
    } catch {
      return {
        key: 'plan_approval',
        status: 'blocked',
        meaning: 'A aprovação não pôde ser comprovada para este tenant.',
        nextAction: 'Apresentar uma aprovação válida do plano atual.',
        evidenceRefs: [],
      };
    }
    const scopeMatches = approval.scope.includes(
      `maximum_spend_minor:${plan.financials.maximumPlannedSpendMinor}`,
    ) && approval.scope.includes(`currency:${plan.financials.currency}`)
      && approval.scope.includes('external_write:false');
    const valid = approval.status === 'approved'
      && approval.executionPlanId === plan.executionPlanId
      && approval.approvedPlanHash === plan.planHash
      && scopeMatches;
    return valid ? {
      key: 'plan_approval',
      status: 'passed',
      meaning: 'A aprovação corresponde ao plano, hash e teto financeiro atuais.',
      evidenceRefs: [`approval:${approval.approvalId}`],
    } : {
      key: 'plan_approval',
      status: 'blocked',
      meaning: `A aprovação apresentada está no estado ${approval.status} ou possui escopo divergente.`,
      nextAction: 'Aprovar novamente o plano e o teto financeiro atuais.',
      evidenceRefs: [`approval:${approval.approvalId}`],
    };
  }

  private creativeCheck(plan: ExecutionPlanV1): ExecutionSimulationCheck {
    const creatives = plan.objectsToCreate.filter((object) => object.type === 'creative');
    const approved = creatives.length > 0
      && creatives.every((creative) => creative.logicalConfig.copyStatus === 'approved');
    return approved ? {
      key: 'creative_approval',
      status: 'passed',
      meaning: 'Todo conteúdo criativo do plano está marcado como aprovado.',
      evidenceRefs: creatives.map((creative) => `creative:${creative.internalObjectId}`),
    } : {
      key: 'creative_approval',
      status: 'blocked',
      meaning: 'O plano ainda contém briefing sem conteúdo criativo aprovado.',
      nextAction: 'Gerar, revisar e aprovar textos e peças antes da execução.',
      evidenceRefs: creatives.map((creative) => `creative:${creative.internalObjectId}`),
    };
  }

  private operationSequence(plan: ExecutionPlanV1): {
    valid: boolean;
    reason: string;
    operations: SimulatedOperation[];
  } {
    const ids = new Set(plan.objectsToCreate.map((object) => object.internalObjectId));
    const missing = plan.objectsToCreate.flatMap((object) =>
      object.dependsOn.filter((dependency) => !ids.has(dependency)));
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Dependências ausentes: ${[...new Set(missing)].join(', ')}.`,
        operations: [],
      };
    }
    const remaining = [...plan.objectsToCreate];
    const emitted = new Set<string>();
    const ordered: ExecutionPlanV1['objectsToCreate'] = [];
    while (remaining.length > 0) {
      const ready = remaining.filter((object) =>
        object.dependsOn.every((dependency) => emitted.has(dependency)));
      if (ready.length === 0) {
        return {
          valid: false,
          reason: 'O grafo de dependências contém um ciclo.',
          operations: [],
        };
      }
      for (const object of ready) {
        ordered.push(object);
        emitted.add(object.internalObjectId);
        remaining.splice(remaining.indexOf(object), 1);
      }
    }
    const actionByType = {
      campaign: 'create_campaign',
      ad_set: 'create_ad_set',
      creative: 'create_creative',
      ad: 'create_ad',
    } as const;
    return {
      valid: true,
      reason: '',
      operations: ordered.map((object, index) => ({
        order: index + 1,
        internalObjectId: object.internalObjectId,
        objectType: object.type,
        action: actionByType[object.type],
        dependsOn: object.dependsOn,
        intendedLifecycleStatus: 'PAUSED',
        willExecute: false,
      })),
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertAdAccountId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !/^act_\d+$/.test(value)) {
      throw new BadRequestException('adAccountId must use the act_<digits> format');
    }
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
