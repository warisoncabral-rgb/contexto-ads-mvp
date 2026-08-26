import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { MetaOAuthService } from '../meta-oauth/meta-oauth.service';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { ReadinessService } from '../readiness/readiness.service';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator/tenants/:tenantId/meta')
export class OperatorMetaController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly connections: MetaConnectionService,
    private readonly oauth: MetaOAuthService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly readiness: ReadinessService,
  ) {}

  @Post('connections/start-oauth')
  async startOAuth(
    @Param('tenantId') tenantId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    const connection = await this.connections.beginConnection(tenantId);
    const oauth = await this.oauth.start(tenantId, connection.connectionId);
    return {
      connectionId: connection.connectionId,
      authorizationUrl: oauth.authorizationUrl,
      expiresAt: oauth.expiresAt,
      boundaries: {
        requestedScopesAreReadOnly: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
    };
  }

  @Post('connections/:connectionId/request-ads-management')
  async requestAdsManagement(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    const oauth = await this.oauth.startExecutionAuthorization(tenantId, connectionId);
    return {
      connectionId: oauth.connectionId,
      authorizationUrl: oauth.authorizationUrl,
      expiresAt: oauth.expiresAt,
      boundaries: {
        requestedPermission: 'ads_management' as const,
        publicationAuthorized: false as const,
        externalWritesAllowed: false as const,
        externalWritesPerformed: false as const,
      },
    };
  }

  @Get('connections/:connectionId/assets')
  async listAssets(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.connections.listAssets(tenantId, connectionId);
  }

  @Get('selected-execution-target')
  async selectedExecutionTarget(
    @Param('tenantId') tenantId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeCampaignPreparation(authorization, tenantId);
    return this.connections.selectedExecutionTarget(tenantId);
  }

  @Post('connections/:connectionId/assets/selection')
  async selectAssets(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: { assets?: unknown },
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.connections.selectAssets(tenantId, connectionId, body?.assets);
  }

  @Get('connections/:connectionId')
  async getConnection(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.connections.getConnection(tenantId, connectionId);
  }

  @Post('connections/:connectionId/discover-assets')
  async discoverAssets(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.connections.discoverAssets(tenantId, connectionId);
  }

  @Post('connections/:connectionId/capabilities/validate')
  async validateCapabilities(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.capabilities.validateReadOnly(tenantId, connectionId);
  }

  @Post('connections/:connectionId/capabilities/validate-execution')
  async validateExecutionCapabilities(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    const result = await this.capabilities.validateForExecution(tenantId, connectionId);
    return {
      ...result,
      validationMode: 'permission_and_asset_read_only' as const,
      boundaries: {
        permissionsChanged: false as const,
        externalWritesAllowed: false as const,
        externalWritesPerformed: false as const,
      },
    };
  }

  @Post('connections/:connectionId/smoke-test')
  async smokeTest(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.readiness.runReadOnlySmokeTest(tenantId, connectionId);
  }

  @Get('connections/:connectionId/smoke-test/latest')
  async latestSmokeTest(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.authorizeTenantConfiguration(authorization, tenantId);
    return this.readiness.latestReadOnlySmokeTest(tenantId, connectionId);
  }
}
