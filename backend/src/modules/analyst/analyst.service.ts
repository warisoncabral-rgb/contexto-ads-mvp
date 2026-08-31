import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  AnalystAnalysisV1,
  AnalystAnalyzeInputV1,
  AnalystLatestV1,
  AnalystMetricsV1,
  AnalystSnapshotV1,
} from '../../domain/contracts/analyst';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AnalystRepository } from '../../domain/ports/analyst.repository';
import { ANALYST_REPOSITORY } from './analyst.tokens';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONAL_PROBLEM_STATUSES = new Set([
  'ERROR',
  'DISAPPROVED',
  'NOT_DELIVERING',
  'DELIVERY_ERROR',
  'PAYMENT_ERROR',
]);

@Injectable()
export class AnalystService {
  constructor(
    @Inject(ANALYST_REPOSITORY)
    private readonly repository: AnalystRepository,
  ) {}

  async analyze(
    tenantId: unknown,
    campaignId: unknown,
    input: unknown,
    actor: unknown,
  ): Promise<{ snapshot: AnalystSnapshotV1; analysis: AnalystAnalysisV1 }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const operator = this.assertActor(actor);
    const prepared = this.prepareInput(input);
    const collectedAt = new Date().toISOString();
    const metrics = this.normalizeMetrics(prepared.snapshot.metrics);
    const snapshotHash = this.hash({
      tenantId,
      campaignId,
      periodStart: prepared.snapshot.periodStart,
      periodEnd: prepared.snapshot.periodEnd,
      campaignStatus: prepared.snapshot.campaignStatus,
      campaignAgeHours: prepared.snapshot.campaignAgeHours,
      hoursSinceLastChange: prepared.snapshot.hoursSinceLastChange ?? null,
      source: prepared.snapshot.source ?? 'manual_shadow',
      metrics,
    });
    const draftSnapshot: AnalystSnapshotV1 = {
      snapshotId: randomUUID(),
      snapshotHash,
      tenantId,
      campaignId,
      periodStart: prepared.snapshot.periodStart,
      periodEnd: prepared.snapshot.periodEnd,
      campaignStatus: prepared.snapshot.campaignStatus.trim(),
      campaignAgeHours: prepared.snapshot.campaignAgeHours,
      ...(prepared.snapshot.hoursSinceLastChange === undefined
        ? {}
        : { hoursSinceLastChange: prepared.snapshot.hoursSinceLastChange }),
      source: prepared.snapshot.source ?? 'manual_shadow',
      metrics,
      collectedAt,
    };
    const snapshot = await this.repository.saveSnapshot(
      draftSnapshot,
      this.auditEvent(
        tenantId,
        campaignId,
        operator,
        'analyst_snapshot_recorded',
        'analyst_snapshot',
        draftSnapshot.snapshotId,
        {
          snapshotHash,
          source: draftSnapshot.source,
          shadowMode: true,
          metaWritePerformed: false,
        },
        collectedAt,
      ),
    );
    const previous = await this.repository.previousSnapshot(
      tenantId,
      campaignId,
      snapshot.collectedAt,
    );
    const analysisDraft = this.buildAnalysis(
      tenantId,
      campaignId,
      snapshot,
      previous,
      prepared,
    );
    const analysis = await this.repository.saveAnalysis(
      analysisDraft,
      this.auditEvent(
        tenantId,
        campaignId,
        operator,
        'analyst_analysis_generated',
        'analyst_analysis',
        analysisDraft.analysisId,
        {
          snapshotId: snapshot.snapshotId,
          recommendedAction: analysisDraft.recommendedAction,
          healthStatus: analysisDraft.healthStatus,
          confidence: analysisDraft.confidence,
          shadowMode: true,
          recommendationAutoExecuted: false,
        },
        analysisDraft.generatedAt,
      ),
    );
    return { snapshot, analysis };
  }

  async latest(tenantId: unknown, campaignId: unknown): Promise<AnalystLatestV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(campaignId, 'campaignId');
    const [snapshot, analysis] = await Promise.all([
      this.repository.latestSnapshot(tenantId, campaignId),
      this.repository.latestAnalysis(tenantId, campaignId),
    ]);
    return { snapshot, analysis };
  }

  private buildAnalysis(
    tenantId: string,
    campaignId: string,
    snapshot: AnalystSnapshotV1,
    previous: AnalystSnapshotV1 | null,
    input: AnalystAnalyzeInputV1,
  ): AnalystAnalysisV1 {
    const generatedAt = new Date().toISOString();
    const minimumObservationHours = input.businessConstraints?.minimumObservationHours ?? 6;
    const maturity = this.dataMaturity(snapshot, minimumObservationHours);
    const evidence = this.evidence(snapshot, previous);
    const boundaries = {
      shadowMode: true as const,
      metaWritePerformed: false as const,
      externalWritesAllowed: false as const,
      recommendationAutoExecuted: false as const,
      financialActionAuthorized: false as const,
    };
    const base = {
      analysisId: randomUUID(),
      tenantId,
      campaignId,
      snapshotId: snapshot.snapshotId,
      previousSnapshotId: previous?.snapshotId ?? null,
      learning: null,
      dataMaturity: maturity,
      evidence,
      generatedAt,
      boundaries,
    };

    const status = snapshot.campaignStatus.trim().toUpperCase();
    if (OPERATIONAL_PROBLEM_STATUSES.has(status)) {
      return {
        ...base,
        observation: `A campanha está em estado ${status} e não deve ser otimizada como se estivesse entregando normalmente.`,
        diagnosis: 'Existe um problema operacional explícito antes de qualquer conclusão estratégica.',
        hypotheses: ['Falha de entrega, configuração, aprovação ou cobrança deve ser investigada no fluxo operacional.'],
        confidence: 'high',
        healthStatus: 'OPERATIONAL_PROBLEM',
        recommendedAction: 'AJUSTAR',
        reason: 'Resolver o bloqueio operacional antes de interpretar eficiência de público, criativo ou oferta.',
        expectedImpact: 'high',
        risk: 'low',
        urgency: 'high',
        requiresApproval: true,
        nextReview: this.addHours(snapshot.periodEnd, 2),
      };
    }

    if (maturity === 'insufficient') {
      const waitHours = this.remainingObservationHours(snapshot, minimumObservationHours);
      return {
        ...base,
        observation: 'Os dados ainda não atingiram a janela mínima prudente para intervenção.',
        diagnosis: 'Dados insuficientes para separar oscilação normal de um problema consistente.',
        hypotheses: ['A campanha pode estar apenas acumulando entrega e aprendizado inicial.'],
        confidence: 'low',
        healthStatus: 'INSUFFICIENT_DATA',
        recommendedAction: 'AGUARDAR',
        reason: 'Intervir agora aumentaria o risco de sobreotimização sem evidência suficiente.',
        expectedImpact: 'none',
        risk: 'low',
        urgency: 'low',
        requiresApproval: false,
        nextReview: this.addHours(snapshot.periodEnd, waitHours),
      };
    }

    if (!previous) {
      return {
        ...base,
        observation: 'Existe um snapshot utilizável, mas ainda não há ciclo histórico anterior comparável.',
        diagnosis: 'É necessário formar uma linha de base antes de atribuir tendência às métricas atuais.',
        hypotheses: ['O comportamento atual pode ser normal para esta campanha e ainda não possui referência temporal própria.'],
        confidence: maturity === 'mature' ? 'moderate' : 'low',
        healthStatus: 'OBSERVATION',
        recommendedAction: 'OBSERVAR',
        reason: 'Registrar a linha de base e comparar o próximo ciclo antes de recomendar mudança.',
        expectedImpact: 'none',
        risk: 'low',
        urgency: 'low',
        requiresApproval: false,
        nextReview: this.addHours(snapshot.periodEnd, maturity === 'mature' ? 12 : 6),
      };
    }

    const currentCpr = this.costPerResult(snapshot.metrics);
    const previousCpr = this.costPerResult(previous.metrics);
    const targetCpr = input.businessConstraints?.targetCostPerResultMinor;
    const noResultSpendThreshold = Math.max(
      5000,
      targetCpr ? targetCpr * 2 : previousCpr ? previousCpr * 2 : 0,
    );

    if (
      maturity === 'mature'
      && snapshot.metrics.results === 0
      && snapshot.metrics.spendMinor >= noResultSpendThreshold
    ) {
      return {
        ...base,
        observation: 'A janela madura acumulou investimento relevante sem registrar resultado.',
        diagnosis: 'Há evidência suficiente para investigar perda de eficiência ou bloqueio no caminho de conversão.',
        hypotheses: [
          'O criativo pode não estar gerando resposta suficiente.',
          'O público pode estar pouco aderente à oferta.',
          'O caminho até a conversão pode conter fricção ou problema operacional não refletido no status.',
        ],
        confidence: 'moderate',
        healthStatus: 'INTERVENTION_RECOMMENDED',
        recommendedAction: 'AJUSTAR',
        reason: 'Continuar sem revisão pode ampliar investimento sem aprendizado proporcional.',
        expectedImpact: 'medium',
        risk: 'medium',
        urgency: 'medium',
        requiresApproval: true,
        nextReview: this.addHours(snapshot.periodEnd, 12),
      };
    }

    if (currentCpr !== null && previousCpr !== null && previousCpr > 0) {
      const ratio = currentCpr / previousCpr;
      if (maturity === 'mature' && ratio >= 1.35 && snapshot.metrics.results <= previous.metrics.results) {
        return {
          ...base,
          observation: `O custo por resultado piorou ${Math.round((ratio - 1) * 100)}% em relação ao ciclo anterior, sem aumento de resultados.`,
          diagnosis: 'A deterioração é relevante e merece uma hipótese controlada de intervenção.',
          hypotheses: [
            'Pode existir redução de resposta ao criativo.',
            'A audiência pode estar respondendo com menor eficiência.',
            'Também pode existir uma oscilação externa; por isso a recomendação continua supervisionada.',
          ],
          confidence: 'moderate',
          healthStatus: 'INTERVENTION_RECOMMENDED',
          recommendedAction: 'AJUSTAR',
          reason: 'A mudança supera o limiar shadow de deterioração e aparece junto de estagnação de resultados.',
          expectedImpact: 'medium',
          risk: 'medium',
          urgency: 'medium',
          requiresApproval: true,
          nextReview: this.addHours(snapshot.periodEnd, 12),
        };
      }
      if (ratio >= 1.15) {
        return {
          ...base,
          observation: `O custo por resultado subiu ${Math.round((ratio - 1) * 100)}% frente ao ciclo anterior.`,
          diagnosis: 'Existe deterioração emergente, mas ainda não forte o bastante para justificar alteração imediata.',
          hypotheses: ['Pode ser flutuação normal ou o início de uma perda de eficiência.'],
          confidence: 'moderate',
          healthStatus: 'ATTENTION',
          recommendedAction: 'OBSERVAR',
          reason: 'Aguardar um novo ciclo preserva a capacidade de distinguir ruído de tendência.',
          expectedImpact: 'none',
          risk: 'low',
          urgency: 'low',
          requiresApproval: false,
          nextReview: this.addHours(snapshot.periodEnd, 12),
        };
      }
      if (snapshot.metrics.results >= previous.metrics.results && ratio <= 1.1) {
        return {
          ...base,
          observation: 'Resultados e custo por resultado permanecem estáveis ou melhores que no ciclo anterior.',
          diagnosis: 'Não há evidência atual que justifique intervenção.',
          hypotheses: ['A campanha está mantendo eficiência dentro da variação esperada deste shadow mode.'],
          confidence: maturity === 'mature' && snapshot.metrics.impressions >= 3000 ? 'high' : 'moderate',
          healthStatus: 'HEALTHY',
          recommendedAction: 'MANTER',
          reason: 'Alterar uma campanha estável sem sinal consistente criaria risco de sobreotimização.',
          expectedImpact: 'none',
          risk: 'low',
          urgency: 'low',
          requiresApproval: false,
          nextReview: this.addHours(snapshot.periodEnd, 24),
        };
      }
    }

    return {
      ...base,
      observation: 'Os dados são utilizáveis, mas não formam um sinal forte o suficiente para intervenção.',
      diagnosis: 'O comportamento atual deve continuar em observação até surgir tendência consistente.',
      hypotheses: ['As diferenças atuais podem permanecer dentro da flutuação normal da campanha.'],
      confidence: maturity === 'mature' ? 'moderate' : 'low',
      healthStatus: 'OBSERVATION',
      recommendedAction: maturity === 'mature' && snapshot.metrics.results > 0 ? 'MANTER' : 'OBSERVAR',
      reason: 'A decisão prudente é preservar a campanha enquanto a evidência não sustenta uma mudança específica.',
      expectedImpact: 'none',
      risk: 'low',
      urgency: 'low',
      requiresApproval: false,
      nextReview: this.addHours(snapshot.periodEnd, maturity === 'mature' ? 24 : 12),
    };
  }

  private dataMaturity(
    snapshot: AnalystSnapshotV1,
    minimumObservationHours: number,
  ): AnalystAnalysisV1['dataMaturity'] {
    if (
      snapshot.campaignAgeHours < minimumObservationHours
      || snapshot.metrics.impressions < 500
      || (snapshot.hoursSinceLastChange !== undefined
        && snapshot.hoursSinceLastChange < minimumObservationHours)
    ) return 'insufficient';
    if (snapshot.campaignAgeHours < 24 || snapshot.metrics.impressions < 1500) return 'emerging';
    return 'mature';
  }

  private remainingObservationHours(
    snapshot: AnalystSnapshotV1,
    minimumObservationHours: number,
  ): number {
    const campaignRemaining = Math.max(0, minimumObservationHours - snapshot.campaignAgeHours);
    const changeRemaining = snapshot.hoursSinceLastChange === undefined
      ? 0
      : Math.max(0, minimumObservationHours - snapshot.hoursSinceLastChange);
    return Math.max(1, Math.ceil(campaignRemaining), Math.ceil(changeRemaining), 3);
  }

  private evidence(snapshot: AnalystSnapshotV1, previous: AnalystSnapshotV1 | null): string[] {
    const values = [
      `campaign_status=${snapshot.campaignStatus}`,
      `campaign_age_hours=${snapshot.campaignAgeHours}`,
      `impressions=${snapshot.metrics.impressions}`,
      `spend_minor=${snapshot.metrics.spendMinor}`,
      `results=${snapshot.metrics.results}`,
      `clicks=${snapshot.metrics.clicks}`,
    ];
    if (snapshot.hoursSinceLastChange !== undefined) {
      values.push(`hours_since_last_change=${snapshot.hoursSinceLastChange}`);
    }
    if (previous) values.push(`previous_snapshot_id=${previous.snapshotId}`);
    return values;
  }

  private normalizeMetrics(metrics: AnalystMetricsV1): AnalystMetricsV1 {
    const normalized = { ...metrics };
    if (normalized.ctr === undefined && normalized.impressions > 0) {
      normalized.ctr = (normalized.clicks / normalized.impressions) * 100;
    }
    if (normalized.cpcMinor === undefined && normalized.clicks > 0) {
      normalized.cpcMinor = normalized.spendMinor / normalized.clicks;
    }
    if (normalized.costPerResultMinor === undefined && normalized.results > 0) {
      normalized.costPerResultMinor = normalized.spendMinor / normalized.results;
    }
    return normalized;
  }

  private costPerResult(metrics: AnalystMetricsV1): number | null {
    if (metrics.costPerResultMinor !== undefined) return metrics.costPerResultMinor;
    return metrics.results > 0 ? metrics.spendMinor / metrics.results : null;
  }

  private prepareInput(input: unknown): AnalystAnalyzeInputV1 {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Analyst input must be an object');
    }
    const prepared = input as Partial<AnalystAnalyzeInputV1>;
    if (!prepared.snapshot || typeof prepared.snapshot !== 'object') {
      throw new BadRequestException('snapshot is required');
    }
    const snapshot = prepared.snapshot;
    if (Number.isNaN(Date.parse(snapshot.periodStart)) || Number.isNaN(Date.parse(snapshot.periodEnd))) {
      throw new BadRequestException('snapshot period must contain valid ISO date-times');
    }
    if (Date.parse(snapshot.periodEnd) <= Date.parse(snapshot.periodStart)) {
      throw new BadRequestException('snapshot periodEnd must be after periodStart');
    }
    if (typeof snapshot.campaignStatus !== 'string' || !snapshot.campaignStatus.trim()) {
      throw new BadRequestException('snapshot campaignStatus is required');
    }
    this.assertNonNegative(snapshot.campaignAgeHours, 'snapshot.campaignAgeHours');
    if (snapshot.hoursSinceLastChange !== undefined) {
      this.assertNonNegative(snapshot.hoursSinceLastChange, 'snapshot.hoursSinceLastChange');
    }
    if (!snapshot.metrics || typeof snapshot.metrics !== 'object') {
      throw new BadRequestException('snapshot.metrics is required');
    }
    for (const field of ['impressions', 'reach', 'spendMinor', 'results', 'clicks'] as const) {
      this.assertNonNegative(snapshot.metrics[field], `snapshot.metrics.${field}`);
    }
    for (const field of ['frequency', 'ctr', 'cpcMinor', 'costPerResultMinor'] as const) {
      const value = snapshot.metrics[field];
      if (value !== undefined) this.assertNonNegative(value, `snapshot.metrics.${field}`);
    }
    const constraints = prepared.businessConstraints;
    if (constraints?.minimumObservationHours !== undefined) {
      this.assertPositive(constraints.minimumObservationHours, 'businessConstraints.minimumObservationHours');
    }
    if (constraints?.targetCostPerResultMinor !== undefined) {
      this.assertPositive(constraints.targetCostPerResultMinor, 'businessConstraints.targetCostPerResultMinor');
    }
    if (constraints?.maximumDailyBudgetMinor !== undefined) {
      this.assertPositive(constraints.maximumDailyBudgetMinor, 'businessConstraints.maximumDailyBudgetMinor');
    }
    return prepared as AnalystAnalyzeInputV1;
  }

  private auditEvent(
    tenantId: string,
    campaignId: string,
    actor: string,
    eventType: string,
    objectType: string,
    objectId: string,
    newState: Record<string, unknown>,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: campaignId,
      actorType: 'user',
      actorId: actor,
      eventType,
      objectType,
      objectId,
      newState,
      result: 'success',
      createdAt,
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  private addHours(value: string, hours: number): string {
    return new Date(Date.parse(value) + hours * 60 * 60 * 1000).toISOString();
  }

  private assertNonNegative(value: unknown, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative number`);
    }
  }

  private assertPositive(value: unknown, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive number`);
    }
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }

  private assertActor(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 255) {
      throw new BadRequestException('actor must be a non-empty identifier');
    }
    return value.trim();
  }
}
