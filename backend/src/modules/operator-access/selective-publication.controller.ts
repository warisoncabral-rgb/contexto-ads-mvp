import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { SelectiveMetaPublicationService } from '../meta-execution/selective-meta-publication.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator/campaigns/v1')
export class SelectivePublicationController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly status: CampaignPackageStatusService,
    private readonly publication: SelectiveMetaPublicationService,
  ) {}

  @Post('action-publish-selected-ads')
  @HttpCode(200)
  async publishSelectedAds(
    @Body() body: {
      package_id?: unknown;
      active_ad_ids?: unknown;
      paused_ad_ids?: unknown;
      confirmation?: unknown;
    },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    if (body?.confirmation !== 'PUBLISH_SELECTED_ADS') {
      throw new BadRequestException({
        code: 'explicit_selective_publish_command_required',
        message: 'A publicação seletiva exige a confirmação literal PUBLISH_SELECTED_ADS.',
      });
    }
    const packageId = this.uuid(body?.package_id, 'package_id');
    const auth = this.operatorAuthorization(authorization, operatorKey);
    const resolved = await this.resolvePackage(auth, packageId);
    if (resolved.snapshot.creative?.status !== 'approved'
      || resolved.snapshot.plan_approval?.status !== 'approved') {
      throw new ConflictException({
        code: 'campaign_not_fully_approved',
        message: 'A campanha ainda não possui todas as aprovações necessárias.',
      });
    }
    const { operator } = await this.access.authorizeCampaignPreparation(
      auth, resolved.tenantId,
    );
    const result = await this.publication.publishSelected(
      resolved.tenantId,
      resolved.snapshot.execution_plan.execution_plan_id,
      operator.subject,
      body.active_ad_ids,
      body.paused_ad_ids,
    );
    return {
      action_status: 'SELECTIVE_PUBLICATION_APPLIED',
      package_id: packageId,
      campaign_id: packageId,
      execution_plan_id: resolved.snapshot.execution_plan.execution_plan_id,
      meta_publication: result,
      human_message: 'A campanha e o conjunto foram ativados mantendo apenas os anúncios explicitamente selecionados em ACTIVE. Os demais anúncios declarados permaneceram PAUSED.',
      boundaries: {
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

  private operatorAuthorization(
    authorization: string | undefined,
    operatorKey: string | undefined,
  ): string | undefined {
    if (authorization?.trim()) return authorization;
    const token = operatorKey?.trim();
    return token ? `Bearer ${token}` : undefined;
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value.trim();
  }
}
