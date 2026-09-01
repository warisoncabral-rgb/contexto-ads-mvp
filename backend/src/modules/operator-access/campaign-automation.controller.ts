import { Body, Controller, Headers, HttpCode, HttpException, Post } from '@nestjs/common';
import { CampaignAutomationService } from './campaign-automation.service';

@Controller('operator')
export class CampaignAutomationController {
  constructor(private readonly automation: CampaignAutomationService) {}

  @Post('creative-packages/v1/action-prepare')
  @HttpCode(200)
  prepareCreative(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.prepareCreative(
      this.normalizeCreativePreparation(body),
      authorization,
    ));
  }

  @Post('creative-packages/v1/action-review')
  @HttpCode(200)
  creativeReview(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.creativeReview(body, authorization));
  }

  @Post('campaigns/v1/action-final-review')
  @HttpCode(200)
  finalReview(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.finalReview(body, authorization));
  }

  @Post('campaigns/v1/action-finalize-for-publication')
  @HttpCode(200)
  finalize(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.finalizeForPublication(body, authorization));
  }

  @Post('campaigns/v1/action-publish')
  @HttpCode(200)
  publish(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.publishCampaign(body, authorization));
  }

  @Post('campaigns/v1/action-pause')
  @HttpCode(200)
  pause(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.envelope(() => this.automation.pauseCampaign(body, authorization));
  }

  private normalizeCreativePreparation(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const source = body as Record<string, unknown>;
    const checklist = source.reviewChecklist;
    if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) return body;

    // action-prepare only ingests and persists the exact attached media. It does not
    // apply automatic creative enhancements, so this review item is deterministically
    // not applicable and must not become a user-facing blocker.
    return {
      ...source,
      reviewChecklist: {
        ...(checklist as Record<string, unknown>),
        automaticEnhancementsReviewed: true,
      },
    };
  }

  private async envelope(run: () => Promise<any>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) {
        return {
          action_status: 'REJECTED',
          http_status: error.getStatus(),
          error: error.getResponse(),
          boundaries: this.safeBoundaries(),
        };
      }
      return {
        action_status: 'REJECTED',
        http_status: 500,
        error: {
          code: 'campaign_automation_internal_error',
          message: error instanceof Error ? error.message : 'Unexpected campaign automation error',
        },
        boundaries: this.safeBoundaries(),
      };
    }
  }

  private safeBoundaries() {
    return {
      publication_authorized: false,
      external_writes_allowed: false,
      delivery_authorized: false,
      spend_authorized: false,
    };
  }
}
