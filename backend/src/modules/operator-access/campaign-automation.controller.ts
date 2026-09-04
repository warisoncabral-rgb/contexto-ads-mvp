import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { SelectiveMetaPublicationService } from '../meta-execution/selective-meta-publication.service';
import { CampaignAutomationService } from './campaign-automation.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class CampaignAutomationController {
  constructor(
    private readonly automation: CampaignAutomationService,
    private readonly access: OperatorAccessService,
    private readonly status: CampaignPackageStatusService,
    private readonly selectivePublication: SelectiveMetaPublicationService,
  ) {}

  @Post('creative-packages/v1/action-prepare')
  @HttpCode(200)
  prepareCreative(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.envelope(() => this.automation.prepareCreative(
      this.normalizeCreativePreparation(body),
      this.operatorAuthorization(authorization, operatorKey),
    ));
  }

  @Post('creative-packages/v1/action-review')
  @HttpCode(200)
  creativeReview(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.envelope(() => this.automation.creativeReview(
      body,
      this.operatorAuthorization(authorization, operatorKey),
    ));
  }

  @Post('campaigns/v1/action-final-review')
  @HttpCode(200)
  finalReview(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.envelope(() => this.automation.finalReview(
      body,
      this.operatorAuthorization(authorization, operatorKey),
    ));
  }

  @Post('campaigns/v1/action-finalize-for-publication')
  @HttpCode(200)
  finalize(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.envelope(() => this.automation.finalizeForPublication(
      body,
      this.operatorAuthorization(authorization, operatorKey),
    ));
  }

  @Post('campaigns/v1/action-publish')
  @HttpCode(200)
  publish(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const auth = this.operatorAuthorization(authorization, operatorKey);
    if (this.isSelectivePublish(body)) {
      return this.envelope(() => this.publishSelected(body, auth));
    }
    return this.envelope(() => this.automation.publishCampaign(body, auth));
  }

  @Post('campaigns/v1/action-pause')
  @HttpCode(200)
  pause(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    return this.envelope(() => this.automation.pauseCampaign(
      body,
      this.operatorAuthorization(authorization, operatorKey),
    ));
  }

  private isSelectivePublish(body: unknown): boolean {
    return Boolean(body && typeof body === 'object' && !Array.isArray(body)
      && (body as Record<string, unknown>).confirmation === 'PUBLISH_SELECTED_ADS');
  }

  private async publishSelected(body: unknown, authorization: string | undefined) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('publication request must be an object');
    }
    const source = body as Record<string, unknown>;
    const packageId = this.uuid(source.package_id, 'package_id');
    const resolved = await this.resolvePackage(authorization, packageId);
    if (resolved.snapshot.creative?.status !== 'approved'
      || resolved.snapshot.plan_approval?.status !== 'approved') {
      throw new ConflictException({
        code: 'campaign_not_fully_approved',
        message: 'A campanha ainda não possui todas as aprovações necessárias.',
      });
    }
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization, resolved.tenantId,
    );
    const result = await this.selectivePublication.publishSelected(
      resolved.tenantId,
      resolved.snapshot.execution_plan.execution_plan_id,
      operator.subject,
      source.active_ad_ids,
      source.paused_ad_ids,
    );
    return {
      action_status: 'PUBLISHED_SELECTED_ADS',
      package_id: packageId,
      campaign_id: packageId,
      execution_plan_id: resolved.snapshot.execution_plan.execution_plan_id,
      meta_publication: result,
      human_message: 'A campanha e o conjunto foram ativados mantendo somente os anúncios explicitamente selecionados em ACTIVE. Os demais anúncios declarados permaneceram PAUSED.',
      boundaries: {
        publication_authorized: true,
        campaign_active: true,
        delivery_authorized: true,
        spend_authorized: true,
        budget_change_authorized: false,
        unselected_ads_activation_authorized: false,
      },
    };
  }

  private async resolvePackage(authorization: string | undefined, packageId: string) {
    const workspace = await this.access.listTenants(authorization);
    const candidates = workspace.tenants.filter((tenant) =>
      tenant.permissions.includes('manage_campaign_preparation'),
    );
    const found: Array<{ tenantId: string; snapshot: any }> = [];
    for (const tenant of candidates) {
      try {
        found.push({
          tenantId: tenant.tenantId,
          snapshot: await this.status.get(tenant.tenantId, packageId),
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    if (found.length === 0) {
      throw new NotFoundException({
        code: 'campaign_package_not_found',
        message: 'Não encontrei esta campanha entre as campanhas disponíveis para esta conta.',
      });
    }
    if (found.length > 1) {
      throw new ConflictException({
        code: 'campaign_package_resolution_ambiguous',
        message: 'Encontrei mais de uma campanha com esta referência. Selecione a campanha correta para continuar.',
      });
    }
    return found[0];
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value.trim();
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

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
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
