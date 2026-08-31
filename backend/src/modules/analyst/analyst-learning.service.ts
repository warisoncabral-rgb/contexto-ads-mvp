import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AnalystContextualLearningV1 } from '../../domain/contracts/analyst-learning';
import { AnalystMetricsV1, AnalystSnapshotV1 } from '../../domain/contracts/analyst';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { AnalystRepository } from '../../domain/ports/analyst.repository';
import { AuditRepository } from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  DATABASE_POOL,
} from '../../infrastructure/database/database.tokens';
import { ANALYST_REPOSITORY } from './analyst.tokens';
import { AnalystService } from './analyst.service';

interface LearningRow {
  audit_event_id: string;
  new_state: {
    learning?: string;
    evidence?: string[];
    confidence?: 'low' | 'moderate';
  } | null;
  created_at: Date;
}

interface LearningDraft {
  learning: string;
  evidence: string[];
  confidence: 'low' | 'moderate';
}

@Injectable()
export class AnalystLearningService {
  constructor(
    private readonly analyst: AnalystService,
    @Inject(ANALYST_REPOSITORY) private readonly repository: AnalystRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async refresh(
    tenantId: string,
    campaignId: string,
    actor: string,
  ): Promise<AnalystContextualLearningV1> {
    const latest = await this.analyst.latest(tenantId, campaignId);
    if (!latest.analysis || !latest.snapshot) {
      return this.none(tenantId, campaignId, 'NO_ANALYSIS', null,
        'Aguarde a primeira análise comparável da campanha.');
    }
    const existing = await this.learningRow(tenantId, latest.analysis.analysisId);
    if (existing) return this.fromRow(tenantId, campaignId, latest.analysis.analysisId, existing);

    const previous = await this.repository.previousSnapshot(
      tenantId,
      campaignId,
      latest.snapshot.collectedAt,
    );
    if (!previous) {
      return this.none(tenantId, campaignId, 'NO_LEARNING', latest.analysis.analysisId,
        'É necessário pelo menos mais um período comparável para registrar aprendizado.');
    }

    const draft = this.derive(latest.snapshot, previous);
    if (!draft) {
      return this.none(tenantId, campaignId, 'NO_LEARNING', latest.analysis.analysisId,
        'Os períodos ainda não oferecem evidência suficiente para registrar aprendizado contextual.');
    }

    const learningId = randomUUID();
    const recordedAt = new Date().toISOString();
    const event: AuditEvent = {
      auditEventId: learningId,
      tenantId,
      correlationId: randomUUID(),
      actorType: 'analyst',
      actorId: actor,
      eventType: 'analyst_learning_recorded',
      objectType: 'analyst_analysis',
      objectId: latest.analysis.analysisId,
      newState: {
        learning: draft.learning,
        evidence: draft.evidence,
        confidence: draft.confidence,
        snapshotId: latest.snapshot.snapshotId,
        previousSnapshotId: previous.snapshotId,
        contextualOnly: true,
        universalRuleCreated: false,
      },
      result: 'success',
      createdAt: recordedAt,
    };
    await this.audit.append(event);
    return {
      ...this.boundaries(),
      actionStatus: 'RECORDED',
      tenantId,
      campaignId,
      analysisId: latest.analysis.analysisId,
      learningId,
      learning: draft.learning,
      evidence: draft.evidence,
      confidence: draft.confidence,
      recordedAt,
      nextStep: 'Use este aprendizado apenas como referência para esta campanha e continue validando nas próximas janelas.',
    };
  }

  async latest(
    tenantId: string,
    campaignId: string,
  ): Promise<AnalystContextualLearningV1> {
    const latest = await this.analyst.latest(tenantId, campaignId);
    if (!latest.analysis) {
      return this.none(tenantId, campaignId, 'NO_ANALYSIS', null,
        'Aguarde a primeira análise comparável da campanha.');
    }
    const row = await this.learningRow(tenantId, latest.analysis.analysisId);
    if (!row) {
      return this.none(tenantId, campaignId, 'NO_LEARNING', latest.analysis.analysisId,
        'O ciclo atual ainda não gerou aprendizado contextual confiável.');
    }
    return this.fromRow(tenantId, campaignId, latest.analysis.analysisId, row);
  }

  private derive(current: AnalystSnapshotV1, previous: AnalystSnapshotV1): LearningDraft | null {
    const currentCpr = this.costPerResult(current.metrics);
    const previousCpr = this.costPerResult(previous.metrics);
    if (currentCpr !== null && previousCpr !== null && previousCpr > 0) {
      const ratio = currentCpr / previousCpr;
      const change = Math.round(Math.abs(ratio - 1) * 100);
      if (ratio <= 0.9) {
        return {
          learning: `Nesta campanha e nesta janela comparada, o custo por resultado melhorou aproximadamente ${change}%.`,
          evidence: [
            `current_cost_per_result_minor=${Math.round(currentCpr)}`,
            `previous_cost_per_result_minor=${Math.round(previousCpr)}`,
            `current_results=${current.metrics.results}`,
            `previous_results=${previous.metrics.results}`,
          ],
          confidence: current.metrics.impressions >= 1500 ? 'moderate' : 'low',
        };
      }
      if (ratio >= 1.2) {
        return {
          learning: `Nesta campanha e nesta janela comparada, o custo por resultado piorou aproximadamente ${change}%.`,
          evidence: [
            `current_cost_per_result_minor=${Math.round(currentCpr)}`,
            `previous_cost_per_result_minor=${Math.round(previousCpr)}`,
            `current_results=${current.metrics.results}`,
            `previous_results=${previous.metrics.results}`,
          ],
          confidence: current.metrics.impressions >= 1500 ? 'moderate' : 'low',
        };
      }
      if (current.metrics.impressions >= 500 && previous.metrics.impressions >= 500) {
        return {
          learning: 'Nesta campanha e nesta janela comparada, o custo por resultado permaneceu relativamente estável.',
          evidence: [
            `current_cost_per_result_minor=${Math.round(currentCpr)}`,
            `previous_cost_per_result_minor=${Math.round(previousCpr)}`,
            `current_results=${current.metrics.results}`,
            `previous_results=${previous.metrics.results}`,
          ],
          confidence: 'low',
        };
      }
    }

    if (
      previous.metrics.results > 0
      && current.metrics.results === 0
      && current.metrics.spendMinor >= Math.max(100, previous.metrics.spendMinor * 0.5)
    ) {
      return {
        learning: 'Nesta campanha e nesta janela comparada, houve perda de resultados apesar de investimento relevante.',
        evidence: [
          `current_results=${current.metrics.results}`,
          `previous_results=${previous.metrics.results}`,
          `current_spend_minor=${Math.round(current.metrics.spendMinor)}`,
          `previous_spend_minor=${Math.round(previous.metrics.spendMinor)}`,
        ],
        confidence: current.metrics.impressions >= 1500 ? 'moderate' : 'low',
      };
    }
    return null;
  }

  private costPerResult(metrics: AnalystMetricsV1): number | null {
    if (metrics.costPerResultMinor !== undefined) return metrics.costPerResultMinor;
    return metrics.results > 0 ? metrics.spendMinor / metrics.results : null;
  }

  private async learningRow(tenantId: string, analysisId: string): Promise<LearningRow | null> {
    const result = await this.pool.query<LearningRow>(
      `select audit_event_id, new_state, created_at
       from audit_events
       where tenant_id = $1 and object_id = $2
         and event_type = 'analyst_learning_recorded'
       order by created_at desc, audit_event_id desc limit 1`,
      [tenantId, analysisId],
    );
    return result.rows[0] ?? null;
  }

  private fromRow(
    tenantId: string,
    campaignId: string,
    analysisId: string,
    row: LearningRow,
  ): AnalystContextualLearningV1 {
    return {
      ...this.boundaries(),
      actionStatus: 'RECORDED',
      tenantId,
      campaignId,
      analysisId,
      learningId: row.audit_event_id,
      learning: row.new_state?.learning ?? null,
      evidence: row.new_state?.evidence ?? [],
      confidence: row.new_state?.confidence ?? null,
      recordedAt: row.created_at.toISOString(),
      nextStep: 'Use este aprendizado apenas como referência para esta campanha e continue validando nas próximas janelas.',
    };
  }

  private none(
    tenantId: string,
    campaignId: string,
    actionStatus: 'NO_LEARNING' | 'NO_ANALYSIS',
    analysisId: string | null,
    nextStep: string,
  ): AnalystContextualLearningV1 {
    return {
      ...this.boundaries(),
      actionStatus,
      tenantId,
      campaignId,
      analysisId,
      learningId: null,
      learning: null,
      evidence: [],
      confidence: null,
      recordedAt: null,
      nextStep,
    };
  }

  private boundaries() {
    return {
      boundaries: {
        contextualOnly: true as const,
        universalRuleCreated: false as const,
        autonomousTrainingPerformed: false as const,
        metaWritePerformed: false as const,
        externalWritesAllowed: false as const,
        recommendationAutoExecuted: false as const,
      },
    };
  }
}
