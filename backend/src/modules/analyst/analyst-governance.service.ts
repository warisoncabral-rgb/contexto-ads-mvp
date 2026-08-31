import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  AnalystEssentialAlertV1,
  AnalystRecommendationDecision,
  AnalystRecommendationDecisionV1,
  AnalystRecommendationHandoffTarget,
} from '../../domain/contracts/analyst-governance';
import { AuditRepository } from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  DATABASE_POOL,
} from '../../infrastructure/database/database.tokens';
import { AnalystPresenter } from './analyst.presenter';
import { AnalystService } from './analyst.service';

interface DecisionRow {
  event_type: string;
  actor_id: string | null;
  new_state: {
    decision?: AnalystRecommendationDecision;
    reason?: string | null;
    recommendedAction?: string;
    handoffTarget?: AnalystRecommendationHandoffTarget;
  } | null;
  created_at: Date;
}

@Injectable()
export class AnalystGovernanceService {
  constructor(
    private readonly analyst: AnalystService,
    private readonly presenter: AnalystPresenter,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async decideLatest(
    tenantId: string,
    campaignId: string,
    decisionValue: string,
    actor: string,
    reasonValue?: unknown,
  ): Promise<AnalystRecommendationDecisionV1> {
    const decision = this.decision(decisionValue);
    const reason = this.reason(reasonValue);
    const latest = await this.analyst.latest(tenantId, campaignId);
    const analysis = latest.analysis;
    if (!analysis) return this.noRecommendation(tenantId, campaignId);
    if (!analysis.requiresApproval) {
      return {
        ...this.baseBoundaries(),
        actionStatus: 'NO_APPROVAL_REQUIRED',
        tenantId,
        campaignId,
        analysisId: analysis.analysisId,
        recommendedAction: analysis.recommendedAction,
        decision: null,
        reason: null,
        handoffTarget: null,
        decidedBy: null,
        decidedAt: null,
        userMessage: 'A recomendação atual não exige aprovação do usuário.',
        nextStep: 'Siga o acompanhamento indicado pelo Analista. Nenhuma execução foi autorizada.',
      };
    }

    const previous = await this.latestDecisionRow(tenantId, analysis.analysisId);
    if (previous?.new_state?.decision === decision) {
      return this.fromRow(tenantId, campaignId, analysis.analysisId,
        analysis.recommendedAction, previous);
    }

    const decidedAt = new Date().toISOString();
    const handoffTarget = decision === 'approve'
      ? this.handoffTarget(analysis.recommendedAction)
      : null;
    const event: AuditEvent = {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: actor,
      eventType: decision === 'approve'
        ? 'analyst_recommendation_approved'
        : 'analyst_recommendation_rejected',
      objectType: 'analyst_analysis',
      objectId: analysis.analysisId,
      ...(previous?.new_state ? { previousState: previous.new_state } : {}),
      newState: {
        decision,
        reason,
        recommendedAction: analysis.recommendedAction,
        handoffTarget,
        snapshotId: analysis.snapshotId,
        executionAuthorized: false,
        metaWritePerformed: false,
      },
      result: 'success',
      createdAt: decidedAt,
    };
    await this.audit.append(event);

    return {
      ...this.baseBoundaries(),
      actionStatus: decision === 'approve'
        ? 'APPROVED_RECOMMENDATION'
        : 'REJECTED_RECOMMENDATION',
      tenantId,
      campaignId,
      analysisId: analysis.analysisId,
      recommendedAction: analysis.recommendedAction,
      decision,
      reason,
      handoffTarget,
      decidedBy: actor,
      decidedAt,
      userMessage: decision === 'approve'
        ? 'A recomendação foi aprovada e registrada. Nenhuma alteração foi executada.'
        : 'A recomendação foi rejeitada e registrada. Nenhuma alteração foi executada.',
      nextStep: decision === 'approve'
        ? this.handoffCopy(handoffTarget)
        : 'Mantenha a campanha sob acompanhamento e aguarde a próxima análise.',
    };
  }

  async latestDecision(
    tenantId: string,
    campaignId: string,
  ): Promise<AnalystRecommendationDecisionV1> {
    const latest = await this.analyst.latest(tenantId, campaignId);
    const analysis = latest.analysis;
    if (!analysis) return this.noRecommendation(tenantId, campaignId);
    if (!analysis.requiresApproval) {
      return {
        ...this.baseBoundaries(),
        actionStatus: 'NO_APPROVAL_REQUIRED',
        tenantId,
        campaignId,
        analysisId: analysis.analysisId,
        recommendedAction: analysis.recommendedAction,
        decision: null,
        reason: null,
        handoffTarget: null,
        decidedBy: null,
        decidedAt: null,
        userMessage: 'A recomendação atual não exige aprovação do usuário.',
        nextStep: 'Siga o acompanhamento indicado pelo Analista.',
      };
    }
    const row = await this.latestDecisionRow(tenantId, analysis.analysisId);
    if (!row) {
      return {
        ...this.baseBoundaries(),
        actionStatus: 'NO_RECOMMENDATION',
        tenantId,
        campaignId,
        analysisId: analysis.analysisId,
        recommendedAction: analysis.recommendedAction,
        decision: null,
        reason: null,
        handoffTarget: null,
        decidedBy: null,
        decidedAt: null,
        userMessage: 'Existe uma recomendação aguardando sua decisão.',
        nextStep: 'Aprove ou rejeite a recomendação. Isso não autoriza execução na Meta.',
      };
    }
    return this.fromRow(tenantId, campaignId, analysis.analysisId,
      analysis.recommendedAction, row);
  }

  async essentialAlert(
    tenantId: string,
    campaignId: string,
  ): Promise<AnalystEssentialAlertV1> {
    const latest = await this.analyst.latest(tenantId, campaignId);
    if (!latest.analysis) {
      return {
        actionStatus: 'NO_ANALYSIS',
        level: 'none',
        title: 'Sem alerta',
        message: 'Ainda não existe análise suficiente para esta campanha.',
        nextStep: 'A coleta automática fará a análise quando houver dados e vínculo Meta disponíveis.',
        userActionRequired: false,
        analysisId: null,
        campaignId,
        nextReviewAt: null,
        boundaries: this.alertBoundaries(),
      };
    }
    const analysis = latest.analysis;
    const brief = this.presenter.present(analysis);
    if (brief.operationalState === 'PAUSED') {
      return this.alert('info', 'Campanha pausada', brief.situation, brief.nextStep,
        false, analysis.analysisId, campaignId, analysis.nextReview);
    }
    if (analysis.healthStatus === 'OPERATIONAL_PROBLEM') {
      return this.alert('critical', 'Problema operacional', brief.situation, brief.nextStep,
        true, analysis.analysisId, campaignId, analysis.nextReview);
    }
    if (analysis.healthStatus === 'INTERVENTION_RECOMMENDED') {
      return this.alert('action_required', 'Decisão recomendada', brief.recommendation,
        brief.nextStep, true, analysis.analysisId, campaignId, analysis.nextReview);
    }
    if (analysis.healthStatus === 'ATTENTION') {
      return this.alert('watch', 'Sinal em observação', brief.situation, brief.nextStep,
        false, analysis.analysisId, campaignId, analysis.nextReview);
    }
    return this.alert('none', 'Sem alerta relevante', brief.situation, brief.nextStep,
      false, analysis.analysisId, campaignId, analysis.nextReview);
  }

  private decision(value: string): AnalystRecommendationDecision {
    if (value === 'approve' || value === 'reject') return value;
    throw new BadRequestException('decision must be approve or reject');
  }

  private reason(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('reason must be a string');
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    if (normalized.length > 500) throw new BadRequestException('reason is too long');
    return normalized;
  }

  private handoffTarget(action: string): AnalystRecommendationHandoffTarget {
    if (action === 'GERAR_NOVA_VARIACAO') return 'generator';
    if (action === 'REAVALIAR_ESTRATEGIA') return 'contexto_ads';
    return 'operational_review';
  }

  private handoffCopy(target: AnalystRecommendationHandoffTarget): string {
    if (target === 'generator') {
      return 'A recomendação está pronta para ser encaminhada ao Gerador. A execução continua separada e supervisionada.';
    }
    if (target === 'contexto_ads') {
      return 'A recomendação está pronta para retornar ao Contexto Ads para revisão estratégica.';
    }
    return 'A recomendação está pronta para revisão operacional. Qualquer execução continua exigindo o fluxo oficial de autorização.';
  }

  private async latestDecisionRow(
    tenantId: string,
    analysisId: string,
  ): Promise<DecisionRow | null> {
    const result = await this.pool.query<DecisionRow>(
      `select event_type, actor_id, new_state, created_at
       from audit_events
       where tenant_id = $1 and object_id = $2
         and event_type in ('analyst_recommendation_approved','analyst_recommendation_rejected')
       order by created_at desc, audit_event_id desc limit 1`,
      [tenantId, analysisId],
    );
    return result.rows[0] ?? null;
  }

  private fromRow(
    tenantId: string,
    campaignId: string,
    analysisId: string,
    recommendedAction: any,
    row: DecisionRow,
  ): AnalystRecommendationDecisionV1 {
    const decision = row.new_state?.decision ?? null;
    const handoffTarget = row.new_state?.handoffTarget ?? null;
    return {
      ...this.baseBoundaries(),
      actionStatus: decision === 'approve'
        ? 'APPROVED_RECOMMENDATION'
        : 'REJECTED_RECOMMENDATION',
      tenantId,
      campaignId,
      analysisId,
      recommendedAction,
      decision,
      reason: row.new_state?.reason ?? null,
      handoffTarget,
      decidedBy: row.actor_id,
      decidedAt: row.created_at.toISOString(),
      userMessage: decision === 'approve'
        ? 'A recomendação está aprovada e registrada. Nenhuma alteração foi executada.'
        : 'A recomendação está rejeitada e registrada. Nenhuma alteração foi executada.',
      nextStep: decision === 'approve' && handoffTarget
        ? this.handoffCopy(handoffTarget)
        : 'Mantenha a campanha sob acompanhamento e aguarde a próxima análise.',
    };
  }

  private noRecommendation(tenantId: string, campaignId: string): AnalystRecommendationDecisionV1 {
    return {
      ...this.baseBoundaries(),
      actionStatus: 'NO_RECOMMENDATION',
      tenantId,
      campaignId,
      analysisId: null,
      recommendedAction: null,
      decision: null,
      reason: null,
      handoffTarget: null,
      decidedBy: null,
      decidedAt: null,
      userMessage: 'Ainda não existe recomendação para esta campanha.',
      nextStep: 'Aguarde a próxima coleta e análise.',
    };
  }

  private baseBoundaries() {
    return {
      boundaries: {
        decisionIsExecutionAuthorization: false as const,
        executionAuthorized: false as const,
        metaWritePerformed: false as const,
        externalWritesAllowed: false as const,
        recommendationAutoExecuted: false as const,
        financialActionAuthorized: false as const,
      },
    };
  }

  private alert(
    level: AnalystEssentialAlertV1['level'],
    title: string,
    message: string,
    nextStep: string,
    userActionRequired: boolean,
    analysisId: string,
    campaignId: string,
    nextReviewAt: string,
  ): AnalystEssentialAlertV1 {
    return {
      actionStatus: 'OK',
      level,
      title,
      message,
      nextStep,
      userActionRequired,
      analysisId,
      campaignId,
      nextReviewAt,
      boundaries: this.alertBoundaries(),
    };
  }

  private alertBoundaries() {
    return {
      alertIsExecutionCommand: false as const,
      metaWritePerformed: false as const,
      externalWritesAllowed: false as const,
      recommendationAutoExecuted: false as const,
    };
  }
}
