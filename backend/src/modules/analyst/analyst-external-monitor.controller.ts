import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { AnalystBusinessConstraintsV1 } from '../../domain/contracts/analyst';
import { AnalystTrackingService } from '../analyst-tracking/analyst-tracking.service';
import { MetaInsightsService } from '../meta-insights/meta-insights.service';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { AnalystPresenter } from './analyst.presenter';
import { AnalystService } from './analyst.service';

interface MonitorExternalBody {
  since: string;
  until: string;
  businessConstraints?: AnalystBusinessConstraintsV1;
}

@Controller('operator/analyst/meta-campaigns')
export class AnalystExternalMonitorController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly tracking: AnalystTrackingService,
    private readonly metaInsights: MetaInsightsService,
    private readonly analyst: AnalystService,
    private readonly presenter: AnalystPresenter,
  ) {}

  @Post(':metaCampaignId/monitor')
  async monitor(
    @Param('metaCampaignId') metaCampaignId: string,
    @Body() body: MonitorExternalBody,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    if (!/^\d+$/.test(metaCampaignId)) {
      throw new BadRequestException('metaCampaignId must contain only digits');
    }
    if (!this.date(body?.since) || !this.date(body?.until)) {
      throw new BadRequestException('since and until must use YYYY-MM-DD');
    }

    const registration = await this.tracking.findByExternalCampaignId(metaCampaignId);
    if (!registration) {
      return {
        action_status: 'NOT_TRACKED',
        meta_campaign_id: metaCampaignId,
        user_message: 'A campanha Meta ainda não está registrada para acompanhamento pelo Analista.',
        user_action_required: false,
        boundaries: this.boundaries(),
      };
    }

    const auth = this.operatorAuthorization(authorization, operatorKey);
    const { operator } = await this.access.authorizeCampaignPreparation(
      auth,
      registration.tenantId,
    );

    const meta = await this.metaInsights.readSelectedCampaign(
      registration.tenantId,
      metaCampaignId,
      body.since,
      body.until,
    );
    if (!meta.success || !meta.data) {
      return {
        action_status: 'UNAVAILABLE',
        meta_campaign_id: metaCampaignId,
        retryable: meta.retryable,
        normalized_error: meta.normalizedError ?? null,
        user_message: meta.retryable
          ? 'A Meta não respondeu de forma conclusiva nesta leitura. Nenhuma alteração foi feita.'
          : 'A leitura autenticada da Meta não pôde ser concluída com a autorização atual.',
        boundaries: this.boundaries(),
      };
    }

    const periodStart = `${body.since}T00:00:00.000Z`;
    const periodEnd = `${body.until}T23:59:59.999Z`;
    const campaignAgeHours = this.hoursBetween(meta.data.createdTime, periodEnd);
    const hoursSinceLastChange = meta.data.updatedTime
      ? this.hoursBetween(meta.data.updatedTime, periodEnd)
      : undefined;

    const analyzed = await this.analyst.analyze(
      registration.tenantId,
      registration.campaignId,
      {
        businessConstraints: body.businessConstraints,
        campaignStatus: {
          meta_campaign_id: meta.data.campaignId,
          meta_effective_status: meta.data.effectiveStatus ?? meta.data.status,
          result_action_type: meta.data.resultActionType,
          currency: meta.data.currency,
          actions: meta.data.actions,
        },
        snapshot: {
          periodStart,
          periodEnd,
          campaignStatus: meta.data.effectiveStatus ?? meta.data.status,
          campaignAgeHours,
          ...(hoursSinceLastChange === undefined ? {} : { hoursSinceLastChange }),
          source: 'meta_readonly' as const,
          metrics: {
            impressions: meta.data.impressions,
            reach: meta.data.reach,
            spendMinor: meta.data.spendMinor,
            results: meta.data.results,
            clicks: meta.data.clicks,
            ...(meta.data.frequency === undefined ? {} : { frequency: meta.data.frequency }),
            ...(meta.data.ctr === undefined ? {} : { ctr: meta.data.ctr }),
            ...(meta.data.cpcMinor === undefined ? {} : { cpcMinor: meta.data.cpcMinor }),
            ...(meta.data.results > 0
              ? { costPerResultMinor: meta.data.spendMinor / meta.data.results }
              : {}),
          },
        },
      },
      operator.subject,
    );

    return {
      action_status: 'ANALYZED',
      meta_campaign_id: metaCampaignId,
      campaign_id: registration.campaignId,
      tenant_id: registration.tenantId,
      meta_insights: meta.data,
      user_brief: this.presenter.present(analyzed.analysis),
      analysis: analyzed.analysis,
      boundaries: this.boundaries(),
    };
  }

  private boundaries() {
    return {
      read_only: true,
      meta_write_performed: false,
      external_writes_allowed: false,
      recommendation_auto_executed: false,
      campaign_status_change_authorized: false,
      budget_change_authorized: false,
    };
  }

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
  }

  private date(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private hoursBetween(from: string | undefined, to: string): number {
    if (!from || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return 0;
    return Math.max(0, (Date.parse(to) - Date.parse(from)) / 3_600_000);
  }
}
