import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { CampaignPackageHandoffService } from '../campaign-package/campaign-package-handoff.service';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator')
export class OperatorCampaignPackageController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly handoff: CampaignPackageHandoffService,
    private readonly status: CampaignPackageStatusService,
    private readonly connections: MetaConnectionService,
  ) {}

  @Post('campaign-packages/v1/submit')
  async submitAutoResolved(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const workspace = await this.access.listTenants(authorization);
    const candidates = workspace.tenants.filter((tenant) =>
      tenant.permissions.includes('manage_campaign_preparation'),
    );
    const requestedBusiness = this.readBusinessName(body);
    const matching = requestedBusiness
      ? candidates.filter((tenant) =>
        this.normalizeName(tenant.displayName) === this.normalizeName(requestedBusiness),
      )
      : [];
    const selectedTenant = matching.length === 1
      ? matching[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined;

    if (!selectedTenant) {
      throw new ConflictException({
        code: 'tenant_resolution_ambiguous',
        message: 'The authenticated operator has zero or multiple campaign-preparation tenants',
        candidateCount: candidates.length,
      });
    }

    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      selectedTenant.tenantId,
    );
    const target = await this.connections.selectedExecutionTarget(selectedTenant.tenantId);
    const facebookPageId = this.selectedAsset(target.selectedAssets, 'facebook_page');
    const instagramAccountId = this.selectedAsset(target.selectedAssets, 'instagram_account');
    const whatsappAssetId = this.selectedAsset(target.selectedAssets, 'whatsapp');
    const source = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const resolvedBody = {
      ...source,
      meta_connection_id: target.connectionId,
      ad_account_id: target.adAccountId,
      ...(facebookPageId ? { facebook_page_id: facebookPageId } : {}),
      ...(instagramAccountId ? { instagram_account_id: instagramAccountId } : {}),
      ...(whatsappAssetId ? { whatsapp_asset_id: whatsappAssetId } : {}),
    };

    const result = await this.handoff.submit(
      selectedTenant.tenantId,
      resolvedBody,
      operator.subject,
    );

    return {
      ...result,
      resolved_context: {
        tenant_id: selectedTenant.tenantId,
        tenant_display_name: selectedTenant.displayName,
        meta_connection_id: target.connectionId,
        ad_account_id: target.adAccountId,
        facebook_page_id: facebookPageId ?? null,
        instagram_account_id: instagramAccountId ?? null,
        whatsapp_asset_id: whatsappAssetId ?? null,
      },
      boundaries: {
        ...result.boundaries,
        technical_target_auto_resolved: true,
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
      },
    };
  }

  @Post('tenants/:tenantId/campaign-packages/v1/submit')
  async submit(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { operator } = await this.access.authorizeCampaignPreparation(
      authorization,
      tenantId,
    );
    return this.handoff.submit(tenantId, body, operator.subject);
  }

  @Get('tenants/:tenantId/campaign-packages/v1/:packageId/status')
  async getStatus(
    @Param('tenantId') tenantId: string,
    @Param('packageId') packageId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.status.get(tenantId, packageId);
  }

  private readBusinessName(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const value = (body as Record<string, unknown>).business_name;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private normalizeName(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  private selectedAsset(
    assets: Array<{ assetType: string; externalId: string }>,
    assetType: string,
  ): string | undefined {
    return assets.find((asset) => asset.assetType === assetType)?.externalId;
  }
}
