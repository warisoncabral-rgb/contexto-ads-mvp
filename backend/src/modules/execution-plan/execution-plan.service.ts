import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CampaignContextFacts,
  CampaignContextPackageV1,
  CampaignObjective,
} from '../../domain/contracts/campaign-context';
import { MetaCapabilityType } from '../../domain/contracts/capability';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import {
  CampaignContextRepository,
  ExecutionPlanRepository,
} from '../../domain/ports/repositories';
import {
  CAMPAIGN_CONTEXT_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
} from '../../infrastructure/database/database.tokens';

const PLAN_VERSION = '1.0';
const OBJECTIVE_MAP: Record<CampaignObjective, string> = {
  awareness: 'OUTCOME_AWARENESS',
  traffic: 'OUTCOME_TRAFFIC',
  engagement: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  app_promotion: 'OUTCOME_APP_PROMOTION',
  sales: 'OUTCOME_SALES',
};

type CompleteFacts = Required<CampaignContextFacts>;

@Injectable()
export class ExecutionPlanService {
  constructor(
    @Inject(CAMPAIGN_CONTEXT_REPOSITORY)
    private readonly contexts: CampaignContextRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
  ) {}

  async generate(
    tenantId: unknown,
    campaignId: unknown,
    contextVersion?: unknown,
  ): Promise<ExecutionPlanV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const context = contextVersion === undefined
      ? await this.contexts.latest(tenantId, campaignId)
      : await this.versionedContext(tenantId, campaignId, contextVersion);
    if (!context) throw new NotFoundException('Campaign context not found');
    const facts = this.assertReadyContext(context);
    const plan = this.buildPlan(context, facts);
    return this.plans.saveIdempotent(plan);
  }

  async latest(tenantId: unknown, campaignId: unknown): Promise<ExecutionPlanV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const plan = await this.plans.latest(tenantId, campaignId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    return plan;
  }

  private async versionedContext(
    tenantId: string,
    campaignId: string,
    version: unknown,
  ) {
    if (!Number.isInteger(version) || (version as number) < 1) {
      throw new BadRequestException('contextVersion must be a positive integer');
    }
    return this.contexts.findVersion(tenantId, campaignId, version as number);
  }

  private assertReadyContext(context: CampaignContextPackageV1): CompleteFacts {
    const required = [
      'businessName', 'offer', 'objective', 'audience', 'destination',
      'geography', 'budget', 'durationDays',
    ] as const;
    const missing = required.filter((field) => !context.facts[field]);
    if (context.status !== 'ready_for_generation'
      || context.validationIssues.length > 0
      || missing.length > 0) {
      throw new ConflictException({
        code: 'campaign_context_not_ready',
        message: 'Campaign context is not ready for plan generation',
        blockers: context.validationIssues,
        missingFields: missing,
        contextVersion: context.version,
      });
    }
    return context.facts as CompleteFacts;
  }

  private buildPlan(
    context: CampaignContextPackageV1,
    facts: CompleteFacts,
  ): ExecutionPlanV1 {
    const objective = facts.objective.value;
    const destination = facts.destination.value;
    const budget = facts.budget.value;
    const durationDays = facts.durationDays.value;
    const maximumPlannedSpendMinor = budget.mode === 'daily'
      ? budget.amountMinor * durationDays
      : budget.amountMinor;
    if (!Number.isSafeInteger(maximumPlannedSpendMinor)) {
      throw new ConflictException({
        code: 'planned_spend_overflow',
        message: 'The planned spend cannot be represented safely',
      });
    }

    const campaignObjectId = `${context.campaignId}:campaign`;
    const adSetObjectId = `${context.campaignId}:ad_set`;
    const creativeObjectId = `${context.campaignId}:creative`;
    const adObjectId = `${context.campaignId}:ad`;
    const requiredCapabilities: MetaCapabilityType[] = [
      'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_CREATIVE', 'CREATE_AD',
      ...(destination === 'whatsapp' ? ['CLICK_TO_WHATSAPP' as const] : []),
    ];
    const financials: ExecutionPlanV1['financials'] = {
      currency: budget.currency,
      budgetMode: budget.mode,
      configuredAmountMinor: budget.amountMinor,
      maximumPlannedSpendMinor,
      calculation: budget.mode === 'daily'
        ? `${budget.amountMinor} x ${durationDays} days`
        : `${budget.amountMinor} lifetime total`,
    };
    const decisions: ExecutionPlanV1['decisions'] = [
      {
        decisionId: 'objective_mapping',
        category: 'objective',
        ruleId: 'meta_objective_mapping_v1',
        inputRefs: ['campaign_context:objective'],
        outcome: { metaObjective: OBJECTIVE_MAP[objective] },
        rationale: 'O objetivo técnico é mapeado diretamente do objetivo informado.',
      },
      {
        decisionId: 'budget_ceiling',
        category: 'budget',
        ruleId: 'maximum_spend_v1',
        inputRefs: ['campaign_context:budget', 'campaign_context:durationDays'],
        outcome: { maximumPlannedSpendMinor, currency: budget.currency },
        rationale: 'O teto financeiro é calculado antes de qualquer aprovação ou execução.',
      },
      {
        decisionId: 'schedule_duration',
        category: 'schedule',
        ruleId: 'duration_days_v1',
        inputRefs: ['campaign_context:durationDays'],
        outcome: { durationDays },
        rationale: 'A duração permanece exatamente como foi informada no contexto.',
      },
      {
        decisionId: 'audience_scope',
        category: 'audience',
        ruleId: 'source_only_audience_v1',
        inputRefs: ['campaign_context:audience', 'campaign_context:geography'],
        outcome: {
          audienceDescription: facts.audience.value,
          geography: facts.geography.value,
        },
        rationale: 'O plano não amplia nem inventa público ou localização.',
      },
      {
        decisionId: 'destination_mapping',
        category: 'destination',
        ruleId: 'source_only_destination_v1',
        inputRefs: ['campaign_context:destination'],
        outcome: { destination },
        rationale: 'O destino da conversão é preservado sem substituição automática.',
      },
      {
        decisionId: 'creative_guardrail',
        category: 'creative_safety',
        ruleId: 'no_unverified_claims_v1',
        inputRefs: ['campaign_context:businessName', 'campaign_context:offer'],
        outcome: { copyStatus: 'requires_generation_and_approval' },
        rationale: 'O gerador cria um briefing, mas não inventa promessas, provas ou condições.',
      },
    ];
    const risks: ExecutionPlanV1['risks'] = [
      {
        code: 'meta_target_not_selected',
        severity: 'high',
        meaning: 'A conexão e a conta de anúncios ainda não foram vinculadas ao plano.',
        mitigation: 'Selecionar somente uma conta descoberta e validada antes da execução.',
        blocksExecution: true,
      },
      {
        code: 'write_capabilities_not_validated',
        severity: 'high',
        meaning: 'As capacidades necessárias para escrita ainda não foram comprovadas.',
        mitigation: 'Validar permissões e ativos no ambiente Meta real antes da execução.',
        blocksExecution: true,
      },
      {
        code: 'creative_content_not_approved',
        severity: 'high',
        meaning: 'O briefing criativo ainda não contém peças e textos aprovados.',
        mitigation: 'Gerar, revisar e aprovar conteúdo sem alegações não comprovadas.',
        blocksExecution: true,
      },
      {
        code: 'financial_commitment_requires_approval',
        severity: 'medium',
        meaning: `O plano pode comprometer até ${maximumPlannedSpendMinor} unidades mínimas de ${budget.currency}.`,
        mitigation: 'Exigir aprovação vinculada ao hash exato do plano.',
        blocksExecution: true,
      },
    ];
    const objectsToCreate: ExecutionPlanV1['objectsToCreate'] = [
      {
        internalObjectId: campaignObjectId,
        type: 'campaign',
        dependsOn: [],
        logicalConfig: {
          name: `${facts.businessName.value} | ${objective}`,
          objective: OBJECTIVE_MAP[objective],
          lifecycleStatus: 'PAUSED',
        },
      },
      {
        internalObjectId: adSetObjectId,
        type: 'ad_set',
        dependsOn: [campaignObjectId],
        logicalConfig: {
          audienceDescription: facts.audience.value,
          geography: facts.geography.value,
          destination,
          budget,
          durationDays,
          lifecycleStatus: 'PAUSED',
        },
      },
      {
        internalObjectId: creativeObjectId,
        type: 'creative',
        dependsOn: [],
        logicalConfig: {
          brief: {
            businessName: facts.businessName.value,
            offer: facts.offer.value,
            audience: facts.audience.value,
            destination,
          },
          copyStatus: 'requires_generation_and_approval',
          claimsPolicy: 'source_only',
        },
      },
      {
        internalObjectId: adObjectId,
        type: 'ad',
        dependsOn: [adSetObjectId, creativeObjectId],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      },
    ];
    const readiness: ExecutionPlanV1['readiness'] = [
      {
        key: 'campaign_context',
        status: 'passed',
        meaning: 'O contexto obrigatório está completo e versionado.',
        evidenceRefs: [
          `campaign_context:${context.packageId}`,
          `campaign_context_hash:${context.contentHash}`,
        ],
        source: 'campaign_package',
      },
      {
        key: 'meta_execution_target',
        status: 'pending',
        meaning: 'A conexão e a conta de anúncios ainda não foram selecionadas.',
        nextAction: 'Vincular uma conta descoberta do tenant antes da execução.',
        evidenceRefs: [],
        source: 'system',
      },
      {
        key: 'meta_write_capabilities',
        status: 'pending',
        meaning: 'As capacidades de escrita ainda não foram validadas.',
        nextAction: 'Comprovar as capacidades exigidas no ambiente Meta real.',
        evidenceRefs: [],
        source: 'system',
      },
      {
        key: 'creative_approval',
        status: 'pending',
        meaning: 'O briefing existe, mas conteúdo e peças ainda precisam de aprovação.',
        nextAction: 'Gerar e aprovar o pacote criativo vinculado a este plano.',
        evidenceRefs: [],
        source: 'system',
      },
    ];
    const semanticPlan = {
      tenantId: context.tenantId,
      campaignId: context.campaignId,
      campaignPackageVersion: context.version,
      campaignContextHash: context.contentHash,
      planVersion: PLAN_VERSION,
      requiredCapabilities,
      objectsToCreate,
      readiness,
      financials,
      decisions,
      risks,
    };
    const planHash = this.hash(semanticPlan);
    return {
      executionPlanId: randomUUID(),
      tenantId: context.tenantId,
      campaignId: context.campaignId,
      campaignPackageVersion: context.version,
      planVersion: PLAN_VERSION,
      correlationId: randomUUID(),
      planHash,
      idempotencyKey: this.hash({
        purpose: 'execution_plan_generation_v1',
        tenantId: context.tenantId,
        campaignId: context.campaignId,
        contextVersion: context.version,
        planHash,
      }),
      status: 'draft',
      meta: { assetBindings: [], requiredCapabilities },
      objectsToCreate,
      readiness,
      autonomy: { level: 'A0', approvalRequired: true },
      financials,
      decisions,
      risks,
      externalEffects: { writesAllowed: false, writesPerformed: false },
      createdAt: new Date().toISOString(),
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
