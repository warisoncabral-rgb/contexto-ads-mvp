import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import {
  AnalystAnalyzeInputV1,
  AnalystBusinessConstraintsV1,
} from '../../domain/contracts/analyst';
import { MetaInsightsService } from '../meta-insights/meta-insights.service';
import { OperatorAccessService } from '../operator-access/operator-access.service';
import { AnalystService } from './analyst.service';

interface CollectMetaBody {
  metaCampaignId: string;
  since: string;
  until: string;
  businessConstraints?: AnalystBusinessConstraintsV1;
}

@Controller('operator/tenants/:tenantId/campaigns/:campaignId/analyst')
export class AnalystController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly analyst: AnalystService,
    private readonly metaInsights: MetaInsightsService,
  ) {}

  @Post('analyze')
  async analyze(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: AnalystAnalyzeInputV1,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.analyst.analyze(tenantId, campaignId, body, operator.subject);
  }

  @Post('collect-meta')
  async collectMeta(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: CollectMetaBody,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    const meta = await this.metaInsights.readSelectedCampaign(
      tenantId,
      body?.metaCampaignId,
      body?.since,
      body?.until,
    );
    if (!meta.success || !meta.data) {
      return {
        action_status: 'UNAVAILABLE',
        meta_insights: meta,
        analysis: null,
        boundaries: {
          shadow_mode: true,
          meta_write_performed: false,
          external_writes_allowed: false,
          recommendation_auto_executed: false,
        },
      };
    }

    const periodStart = `${body.since}T00:00:00.000Z`;
    const periodEnd = `${body.until}T23:59:59.999Z`;
    const campaignAgeHours = this.hoursBetween(meta.data.createdTime, periodEnd);
    const hoursSinceLastChange = meta.data.updatedTime
      ? this.hoursBetween(meta.data.updatedTime, periodEnd)
      : undefined;
    const analyzed = await this.analyst.analyze(
      tenantId,
      campaignId,
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
      meta_insights: meta.data,
      ...analyzed,
      boundaries: {
        shadow_mode: true,
        meta_write_performed: false,
        external_writes_allowed: false,
        recommendation_auto_executed: false,
        financial_action_authorized: false,
      },
    };
  }

  @Get('latest')
  async latest(
    @Param('tenantId') tenantId: string,
    @Param('campaignId') campaignId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.analyst.latest(tenantId, campaignId);
  }

  private hoursBetween(from: string | undefined, to: string): number {
    if (!from || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return 0;
    return Math.max(0, (Date.parse(to) - Date.parse(from)) / 3_600_000);
  }
}
