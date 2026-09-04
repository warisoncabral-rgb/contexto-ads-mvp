import {
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Body,
} from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { MetaWriteValidationProtocolRepository } from '../../domain/ports/repositories';
import { META_WRITE_VALIDATION_PROTOCOL_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator/campaign-packages/v1')
export class OperatorCampaignExecutionResultController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly status: CampaignPackageStatusService,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly protocols: MetaWriteValidationProtocolRepository,
  ) {}

  @Post('action-result')
  @HttpCode(200)
  async result(
    @Body() body: { package_id?: unknown; execution_authorization_id?: unknown },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const auth = this.operatorAuthorization(authorization, operatorKey);
    const packageId = this.uuid(body?.package_id, 'package_id');
    const executionAuthorizationId = this.uuid(
      body?.execution_authorization_id,
      'execution_authorization_id',
    );
    const resolved = await this.resolvePackage(auth, packageId);
    const executionAuthorization = await this.access.getExecutionAuthorization(
      auth,
      resolved.tenantId,
      executionAuthorizationId,
    );
    if (executionAuthorization.campaignId !== packageId) {
      throw new ConflictException({
        code: 'execution_authorization_scope_mismatch',
        message: 'Não consegui confirmar que este resultado pertence à campanha atual.',
      });
    }

    const protocol = await this.protocols.latestForManifest(
      resolved.tenantId,
      executionAuthorization.executionManifestId,
    );
    if (!protocol) {
      throw new NotFoundException({
        code: 'execution_result_not_found',
        message: 'Ainda não encontrei o resultado da criação desta campanha.',
      });
    }

    const byKey = new Map<string, any>();
    for (const item of protocol.reconciledOperations ?? []) {
      byKey.set(item.operationKey, {
        operation_key: item.operationKey,
        object_type: item.objectType,
        external_object_id: item.externalObjectId ?? null,
        observed_status: 'PAUSED',
        status: 'succeeded',
        source: 'reconciled',
      });
    }
    for (const item of protocol.execution?.operations ?? []) {
      byKey.set(item.operationKey, {
        operation_key: item.operationKey,
        object_type: item.objectType,
        external_object_id: item.externalObjectId ?? null,
        observed_status: item.observedStatus ?? null,
        status: item.status,
        source: 'execution',
      });
    }
    const createdObjects = [...byKey.values()];
    const campaign = createdObjects.find((item) => item.object_type === 'campaign');
    const adset = createdObjects.find((item) => item.object_type === 'adset');
    const creatives = createdObjects.filter((item) => item.object_type === 'creative');
    const ads = createdObjects.filter((item) => item.object_type === 'ad');

    return {
      action_status: 'META_CREATION_RESULT_READY',
      user_view: {
        title: 'Criação conferida na Meta',
        message: campaign?.external_object_id
          ? 'A campanha e os demais objetos foram identificados com seus IDs reais da Meta.'
          : 'Os objetos foram conferidos, mas o ID da campanha ainda não pôde ser identificado com segurança.',
        next_step: campaign?.external_object_id
          ? 'Use estes IDs como referência oficial da campanha antes da ativação.'
          : 'Não ative a campanha até o ID principal ser recuperado.',
      },
      package_id: packageId,
      execution_authorization_id: executionAuthorizationId,
      meta_campaign_id: campaign?.external_object_id ?? null,
      meta_adset_id: adset?.external_object_id ?? null,
      meta_creative_ids: creatives.map((item) => item.external_object_id).filter(Boolean),
      meta_ad_ids: ads.map((item) => item.external_object_id).filter(Boolean),
      created_objects: createdObjects,
      boundaries: {
        campaign_active: false,
        delivery_authorized: false,
        spend_authorized: false,
        activation_requires_new_explicit_authorization: true,
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
    await this.access.authorizeCampaignPreparation(authorization, found[0].tenantId);
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
      throw new ConflictException({
        code: `${field}_invalid`,
        message: 'Não consegui identificar a campanha com segurança. Volte à campanha atual e tente novamente.',
      });
    }
    return value.trim();
  }
}
