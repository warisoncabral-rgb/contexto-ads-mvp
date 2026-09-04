import {
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';
import { humanizeExecutionBlockers } from './human-decision.presenter';
import { OperatorAccessService } from './operator-access.service';

@Controller('operator/campaign-packages/v1')
export class OperatorCampaignExecutionActionController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly status: CampaignPackageStatusService,
    private readonly connections: MetaConnectionService,
  ) {}

  @Post('action-prepare-paused')
  @HttpCode(200)
  async preparePaused(
    @Body() body: { package_id?: unknown },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const auth = this.operatorAuthorization(authorization, operatorKey);
    const packageId = this.uuid(body?.package_id, 'package_id');
    const resolved = await this.resolvePackage(auth, packageId);
    const snapshot = resolved.snapshot;

    if (snapshot.next_action !== 'PREPARE_PAUSED_CREATION') {
      throw new ConflictException({
        code: 'campaign_not_ready_for_paused_creation',
        message: 'A campanha ainda não está pronta para a criação segura. Conclua a etapa indicada e tente novamente.',
      });
    }
    const approvalId = snapshot.plan_approval?.approval_id;
    if (!approvalId || snapshot.plan_approval?.status !== 'approved') {
      throw new ConflictException({
        code: 'approved_plan_required',
        message: 'Revise e aprove a configuração atual da campanha antes de continuar.',
      });
    }

    const manifest = await this.access.prepareExecutionManifest(
      auth,
      resolved.tenantId,
      packageId,
      snapshot.execution_plan.execution_plan_id,
      approvalId,
    );
    const executionAuthorization = await this.access.requestExecutionAuthorization(
      auth,
      resolved.tenantId,
      manifest.executionManifestId,
    );
    const target = await this.connections.selectedExecutionTarget(resolved.tenantId);

    return {
      action_status: 'AWAITING_HUMAN_CONFIRMATION',
      user_view: {
        title: 'Campanha pronta para criar',
        message: 'A configuração aprovada está preservada. A próxima etapa cria a campanha na Meta em modo pausado, sem ativar e sem gerar gasto.',
        next_step: 'Confirme a criação em modo pausado para continuar.',
      },
      package_id: packageId,
      campaign_id: packageId,
      execution_plan_id: snapshot.execution_plan.execution_plan_id,
      execution_manifest_id: manifest.executionManifestId,
      execution_authorization_id: executionAuthorization.executionAuthorizationId,
      confirmation_required: 'CREATE_PAUSED',
      confirmation_expires_at: executionAuthorization.expiresAt,
      review: {
        maximum_planned_spend_minor: snapshot.execution_plan.maximum_planned_spend_minor,
        currency: snapshot.execution_plan.currency,
        intended_initial_status: 'PAUSED',
        delivery_authorized: false,
        spend_authorized: false,
      },
      meta_payment: this.paymentHandoff(target.adAccountId),
      boundaries: {
        external_writes_allowed: false,
        external_writes_performed: false,
        campaign_active: false,
        delivery_authorized: false,
        spend_authorized: false,
      },
    };
  }

  @Post('action-confirm-paused')
  @HttpCode(200)
  async confirmPaused(
    @Body() body: {
      package_id?: unknown;
      execution_authorization_id?: unknown;
      confirmation?: unknown;
    },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const auth = this.operatorAuthorization(authorization, operatorKey);
    const packageId = this.uuid(body?.package_id, 'package_id');
    const executionAuthorizationId = this.uuid(
      body?.execution_authorization_id,
      'execution_authorization_id',
    );
    if (body?.confirmation !== 'CREATE_PAUSED') {
      throw new ConflictException({
        code: 'explicit_paused_creation_confirmation_required',
        message: 'Confirme a criação em modo pausado para continuar. Nenhuma alteração foi feita na Meta.',
      });
    }

    const resolved = await this.resolvePackage(auth, packageId);
    const currentAuthorization = await this.access.getExecutionAuthorization(
      auth,
      resolved.tenantId,
      executionAuthorizationId,
    );
    if (currentAuthorization.campaignId !== packageId
      || currentAuthorization.executionPlanId !== resolved.snapshot.execution_plan.execution_plan_id) {
      throw new ConflictException({
        code: 'execution_authorization_scope_mismatch',
        message: 'A confirmação não corresponde à versão atual desta campanha. Prepare a criação novamente antes de continuar.',
      });
    }

    const approvedAuthorization = currentAuthorization.status === 'approved'
      ? currentAuthorization
      : await this.access.decideExecutionAuthorization(
        auth,
        resolved.tenantId,
        executionAuthorizationId,
        'approve',
        'Confirmação explícita para criar a campanha em modo pausado.',
      );

    await this.access.prepareMetaWriteValidation(
      auth,
      resolved.tenantId,
      approvedAuthorization.executionManifestId,
    );
    let preflight = await this.access.runExecutionPreflight(
      auth,
      resolved.tenantId,
      executionAuthorizationId,
    );

    if (preflight.blockers?.length === 1
      && preflight.blockers[0] === 'campaign_kill_switch') {
      await this.access.changeKillSwitch(
        auth,
        resolved.tenantId,
        'campaign',
        packageId,
        'released',
        'Liberação automática somente para criação segura em PAUSED após confirmação humana. Ativação, entrega e gasto permanecem bloqueados.',
      );
      preflight = await this.access.runExecutionPreflight(
        auth,
        resolved.tenantId,
        executionAuthorizationId,
      );
    }

    if (preflight.blockers?.length) {
      const humanDecision = humanizeExecutionBlockers(preflight.blockers);
      return {
        action_status: 'ACTION_REQUIRED_BEFORE_CREATION',
        user_view: {
          title: humanDecision.title,
          message: humanDecision.message,
          next_step: humanDecision.nextStep,
          user_decision_required: humanDecision.userDecisionRequired,
        },
        package_id: packageId,
        execution_authorization_id: executionAuthorizationId,
        diagnostics: {
          blockers: preflight.blockers,
          next_action: preflight.nextAction,
        },
        boundaries: {
          external_writes_allowed: false,
          external_writes_performed: false,
          campaign_active: false,
          delivery_authorized: false,
          spend_authorized: false,
        },
      };
    }

    const protocol = await this.access.executeMetaPausedCreation(
      auth,
      resolved.tenantId,
      executionAuthorizationId,
    );
    const target = await this.connections.selectedExecutionTarget(resolved.tenantId);

    return {
      action_status: 'META_OBJECTS_CREATED_PAUSED',
      user_view: {
        title: 'Campanha criada com segurança',
        message: 'A estrutura foi criada na Meta e continua pausada. Nada está rodando e nenhum gasto foi autorizado.',
        next_step: 'Confira os dados criados e depois conclua a forma de pagamento diretamente na Meta.',
      },
      package_id: packageId,
      execution_authorization_id: executionAuthorizationId,
      protocol_status: protocol.status,
      created_objects: protocol.execution?.operations?.map((operation) => ({
        operation_key: operation.operationKey,
        object_type: operation.objectType,
        external_object_id: operation.externalObjectId ?? null,
        observed_status: operation.observedStatus ?? null,
        status: operation.status,
      })) ?? [],
      meta_payment: this.paymentHandoff(target.adAccountId),
      next_action: 'REVIEW_META_OBJECTS_AND_COMPLETE_META_BILLING_BEFORE_ACTIVATION',
      boundaries: {
        campaign_active: false,
        delivery_authorized: false,
        spend_authorized: false,
        activation_requires_new_explicit_authorization: true,
      },
    };
  }

  @Post('action-payment-handoff')
  @HttpCode(200)
  async paymentHandoffAction(
    @Body() body: { package_id?: unknown },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-contexto-operator-key') operatorKey?: string,
  ) {
    const auth = this.operatorAuthorization(authorization, operatorKey);
    const packageId = this.uuid(body?.package_id, 'package_id');
    const resolved = await this.resolvePackage(auth, packageId);
    const target = await this.connections.selectedExecutionTarget(resolved.tenantId);
    return {
      action_status: 'META_BILLING_HANDOFF_READY',
      user_view: {
        title: 'Adicionar forma de pagamento na Meta',
        message: 'O pagamento é feito diretamente na Meta. O Contexto Ads não recebe dinheiro nem armazena dados do cartão.',
        next_step: 'Abra a cobrança da Meta, escolha a conta indicada e conclua a forma de pagamento. Depois volte para continuar.',
      },
      package_id: packageId,
      meta_payment: this.paymentHandoff(target.adAccountId),
      boundaries: {
        context_ads_processes_payment: false,
        context_ads_stores_payment_credentials: false,
        activation_authorized: false,
        spend_authorized: false,
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

  private paymentHandoff(adAccountId: string | undefined) {
    return {
      provider: 'META',
      destination: 'META_ADS_BILLING',
      manage_url: 'https://business.facebook.com/billing_hub',
      ad_account_id: adAccountId ?? null,
      instructions: 'Abra a cobrança da Meta, selecione a conta de anúncios indicada e adicione ou confirme a forma de pagamento diretamente na Meta.',
      payment_is_processed_by_context_ads: false,
      payment_credentials_are_collected_by_context_ads: false,
      return_step: 'Depois de concluir o pagamento na Meta, volte ao Contexto Ads. A ativação continua exigindo uma nova confirmação.',
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
