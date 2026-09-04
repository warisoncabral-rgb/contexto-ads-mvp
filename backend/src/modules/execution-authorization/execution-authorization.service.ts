import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightCheckV1,
  ExecutionPreflightV1,
  MetaPreflightDiagnosticV1,
} from '../../domain/contracts/execution-authorization';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { MetaAssetBinding } from '../../domain/contracts/meta-connection';
import { MetaCapabilityType } from '../../domain/contracts/capability';
import {
  ExecutionAuthorizationRepository,
  ExecutionManifestRepository,
  ExecutionPlanRepository,
  MetaConnectionRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_AUTHORIZATION_REPOSITORY,
  EXECUTION_MANIFEST_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  META_CONNECTION_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaWriteAdapter } from '../meta-adapter/meta-write.adapter';
import { parseMetaGeography } from '../meta-execution/meta-geography';

const AUTHORIZATION_VALIDITY_MS = 15 * 60 * 1000;
const PREFLIGHT_META_CAPABILITIES: MetaCapabilityType[] = [
  'DISCOVER_ASSETS',
  'READ_AD_ACCOUNT',
  'CREATE_CAMPAIGN',
  'CREATE_ADSET',
  'CREATE_CREATIVE',
  'CREATE_AD',
  'MANAGE_AD_STATUS',
  'CLICK_TO_WHATSAPP',
];

@Injectable()
export class ExecutionAuthorizationService {
  constructor(
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
    @Inject(EXECUTION_AUTHORIZATION_REPOSITORY)
    private readonly authorizations: ExecutionAuthorizationRepository,
    private readonly killSwitch: KillSwitchService,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly validationProtocols: MetaWriteValidationProtocolRepository,
    @Optional() @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans?: ExecutionPlanRepository,
    @Optional() @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections?: MetaConnectionRepository,
    @Optional() private readonly writeAdapter?: MetaWriteAdapter,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly readonlyAdapter?: MetaReadonlyAdapter,
  ) {}

  async request(
    tenantId: unknown,
    executionManifestId: unknown,
    requestedBy: unknown,
  ): Promise<ExecutionAuthorizationV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionManifestId, 'executionManifestId');
    const actor = this.assertActor(requestedBy, 'requestedBy');
    const manifest = await this.currentManifest(tenantId, executionManifestId);
    const preparedProtocol = await this.validationProtocols.latestForManifest(
      tenantId, executionManifestId,
    );
    const protocolCurrent = ['prepared_external_validation_required', 'external_validation_succeeded']
      .includes(preparedProtocol?.status ?? '')
      && preparedProtocol?.manifestHash === manifest.manifestHash;
    const authorizedOperationCount = protocolCurrent
      ? preparedProtocol!.operations.length
      : manifest.operations.length;
    const now = new Date();
    const authorization: ExecutionAuthorizationV1 = {
      executionAuthorizationId: randomUUID(),
      tenantId,
      campaignId: manifest.campaignId,
      executionPlanId: manifest.executionPlanId,
      executionManifestId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      actionType: 'authorize_controlled_paused_creation',
      riskLevel: 'high',
      scope: [
        `campaign:${manifest.campaignId}`,
        `execution_plan:${manifest.executionPlanId}`,
        `plan_hash:${manifest.planHash}`,
        `execution_manifest:${manifest.executionManifestId}`,
        `manifest_hash:${manifest.manifestHash}`,
        `operations:${authorizedOperationCount}`,
        ...(protocolCurrent && preparedProtocol
          ? [`validation_protocol:${preparedProtocol.metaWriteValidationProtocolId}`]
          : []),
        'intended_lifecycle_status:PAUSED',
        'external_write_currently_allowed:false',
      ],
      requestedBy: actor,
      status: 'pending',
      expiresAt: new Date(now.getTime() + AUTHORIZATION_VALIDITY_MS).toISOString(),
      correlationId: randomUUID(),
      boundaries: {
        effectiveExecutionPermission: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const requestEvent = this.event(
      authorization, actor, 'execution_authorization_requested',
      { status: 'pending', expiresAt: authorization.expiresAt }, 'success',
      authorization.createdAt,
    );
    const saved = await this.authorizations.request(
      authorization,
      requestEvent,
    );
    if (['pending', 'approved'].includes(saved.status)
      && new Date(saved.expiresAt).getTime() <= now.getTime()) {
      await this.authorizations.expireOrInvalidate(
        tenantId,
        saved.executionAuthorizationId,
        now.toISOString(),
        this.event(saved, undefined, 'execution_authorization_refreshed', {},
          'blocked', now.toISOString()),
      );
      return this.authorizations.request(authorization, requestEvent);
    }
    return saved;
  }

  async get(
    tenantId: unknown,
    executionAuthorizationId: unknown,
  ): Promise<ExecutionAuthorizationV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionAuthorizationId, 'executionAuthorizationId');
    return this.refresh(tenantId, executionAuthorizationId);
  }

  async approve(
    tenantId: unknown,
    executionAuthorizationId: unknown,
    approvedBy: unknown,
  ): Promise<ExecutionAuthorizationV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionAuthorizationId, 'executionAuthorizationId');
    const actor = this.assertActor(approvedBy, 'approvedBy');
    const current = await this.refresh(tenantId, executionAuthorizationId);
    this.assertStatus(current, ['pending']);
    const now = new Date().toISOString();
    const approved = await this.authorizations.approveIfCurrent(
      tenantId,
      executionAuthorizationId,
      actor,
      now,
      this.event(current, actor, 'execution_authorization_approved', {
        status: 'approved',
        effectiveExecutionPermission: false,
        expiresAt: current.expiresAt,
      }, 'success', now),
    );
    if (approved) return approved;
    throw new ConflictException({
      code: 'execution_authorization_no_longer_valid',
      message: 'Authorization expired or its manifest is no longer current',
    });
  }

  async reject(
    tenantId: unknown,
    executionAuthorizationId: unknown,
    actor: unknown,
    reason: unknown,
  ): Promise<ExecutionAuthorizationV1> {
    return this.transition(
      tenantId, executionAuthorizationId, actor, reason,
      ['pending'], 'rejected', 'execution_authorization_rejected',
    );
  }

  async revoke(
    tenantId: unknown,
    executionAuthorizationId: unknown,
    actor: unknown,
    reason: unknown,
  ): Promise<ExecutionAuthorizationV1> {
    return this.transition(
      tenantId, executionAuthorizationId, actor, reason,
      ['approved'], 'revoked', 'execution_authorization_revoked',
    );
  }

  async preflight(
    tenantId: unknown,
    executionAuthorizationId: unknown,
  ): Promise<ExecutionPreflightV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionAuthorizationId, 'executionAuthorizationId');
    const authorization = await this.refresh(tenantId, executionAuthorizationId);
    const manifest = await this.manifests.findById(
      tenantId, authorization.executionManifestId,
    );
    if (!manifest) throw new NotFoundException('Execution manifest not found');
    const latest = await this.manifests.latestForPlan(tenantId, manifest.executionPlanId);
    const current = latest?.executionManifestId === manifest.executionManifestId
      && latest.manifestHash === manifest.manifestHash;
    const effectiveKillSwitch = await this.killSwitch.effective(
      tenantId, manifest.campaignId,
    );
    const validationProtocol = await this.validationProtocols.latestForManifest(
      tenantId, manifest.executionManifestId,
    );
    const plan = await this.plans?.findById(tenantId, manifest.executionPlanId);
    const connectionId = plan?.meta.connectionId;
    const adAccountReady = typeof plan?.meta.adAccountId === 'string'
      && /^act_\d+$/.test(plan.meta.adAccountId);
    const connection = connectionId
      ? await this.connections?.findById(tenantId, connectionId) : undefined;
    const bindings = connectionId
      ? await this.connections?.listBindings(tenantId, connectionId) ?? [] : [];
    const pageReady = bindings.filter((item) =>
      item.assetType === 'facebook_page' && item.selected).length === 1;
    const whatsappReady = bindings.filter((item) =>
      item.assetType === 'whatsapp' && item.selected).length === 1;
    const protocolReady = ['prepared_external_validation_required', 'external_validation_succeeded']
      .includes(validationProtocol?.status ?? '');
    const connectionReady = Boolean(connection?.credentialRef
      && ['connected', 'ready'].includes(connection.status));
    const targetReady = Boolean(plan && connectionId && adAccountReady
      && connectionReady
      && pageReady && whatsappReady);
    const metaDiagnostic = await this.buildMetaDiagnostic(
      tenantId,
      connectionId,
      connection?.status,
      connection?.credentialRef,
      plan?.meta.adAccountId,
      bindings,
    );
    const geography = plan?.objectsToCreate?.find((item) => item.type === 'ad_set')
      ?.logicalConfig.geography;
    const geographyCheck = targetReady && connection?.credentialRef
      ? await this.validateGeography(tenantId, connection.credentialRef, geography)
      : { passed: false, evidenceRefs: [] as string[],
        meaning: 'A geografia não pôde ser validada porque o destino Meta ainda não está pronto.' };
    const realMetaReady = protocolReady && targetReady && metaDiagnostic.status === 'passed';
    const adapterReady = this.writeAdapter?.enabled() === true;
    const tenantKillSwitchPassed = effectiveKillSwitch.tenant.known
      && effectiveKillSwitch.tenant.status === 'released';
    const campaignKillSwitchPassed = effectiveKillSwitch.campaign.known
      && effectiveKillSwitch.campaign.status === 'released';
    const checks: ExecutionPreflightCheckV1[] = [
      {
        key: 'manifest_current',
        status: current ? 'passed' : 'blocked',
        evidenceRefs: current ? [
          `execution_manifest:${manifest.executionManifestId}`,
          `manifest_hash:${manifest.manifestHash}`,
        ] : [],
        meaning: current
          ? 'O manifesto ainda é o mais recente para o plano.'
          : 'O manifesto foi substituído e não pode iniciar uma tentativa.',
      },
      {
        key: 'specific_execution_authorization',
        status: authorization.status === 'approved' ? 'passed' : 'blocked',
        evidenceRefs: authorization.status === 'approved'
          ? [`execution_authorization:${authorization.executionAuthorizationId}`]
          : [],
        meaning: authorization.status === 'approved'
          ? 'A autorização específica está aprovada e dentro da validade.'
          : `A autorização específica está ${authorization.status}.`,
      },
      {
        key: 'tenant_kill_switch',
        status: tenantKillSwitchPassed ? 'passed' : 'blocked',
        evidenceRefs: effectiveKillSwitch.tenant.stateId
          ? [`kill_switch:${effectiveKillSwitch.tenant.stateId}`] : [],
        meaning: tenantKillSwitchPassed
          ? 'O Kill Switch do tenant possui estado conhecido e liberado.'
          : effectiveKillSwitch.tenant.status === 'engaged'
            ? 'O Kill Switch do tenant está acionado.'
            : 'O Kill Switch do tenant não possui estado; o padrão é bloquear.',
      },
      {
        key: 'campaign_kill_switch',
        status: campaignKillSwitchPassed ? 'passed' : 'blocked',
        evidenceRefs: effectiveKillSwitch.campaign.stateId
          ? [`kill_switch:${effectiveKillSwitch.campaign.stateId}`] : [],
        meaning: campaignKillSwitchPassed
          ? 'O Kill Switch da campanha possui estado conhecido e liberado.'
          : effectiveKillSwitch.campaign.status === 'engaged'
            ? 'O Kill Switch da campanha está acionado.'
            : 'O Kill Switch da campanha não possui estado; o padrão é bloquear.',
      },
      {
        key: 'meta_geography_resolved',
        status: geographyCheck.passed ? 'passed' : 'blocked',
        evidenceRefs: geographyCheck.evidenceRefs,
        meaning: geographyCheck.meaning,
      },
      {
        key: 'real_meta_write_validation', status: realMetaReady ? 'passed' : 'blocked',
        evidenceRefs: [
          ...(validationProtocol
            ? [`meta_write_validation_protocol:${validationProtocol.metaWriteValidationProtocolId}`]
            : []),
          ...(metaDiagnostic.connection.oauthSubjectId
            ? [`meta_oauth_subject:${metaDiagnostic.connection.oauthSubjectId}`]
            : []),
          ...(metaDiagnostic.adAccount.recognizedId
            ? [`meta_ad_account:${metaDiagnostic.adAccount.recognizedId}`]
            : []),
          ...(metaDiagnostic.facebookPage.selectedId
            ? [`meta_page:${metaDiagnostic.facebookPage.selectedId}`]
            : []),
          ...(metaDiagnostic.whatsapp.selectedId
            ? [`meta_whatsapp:${metaDiagnostic.whatsapp.selectedId}`]
            : []),
        ],
        meaning: realMetaReady
          ? validationProtocol?.status === 'external_validation_succeeded'
            ? 'O protocolo já foi validado com sucesso para este manifesto; a execução é idempotente e reutilizará os objetos PAUSED já comprovados, sem duplicar escrita.'
            : 'O protocolo, a conta de anúncios, a conexão, a Página, o WhatsApp e as permissões foram comprovados por leitura autenticada da Meta.'
          : !protocolReady
            ? `O protocolo real não está preparado para iniciar (estado: ${validationProtocol?.status ?? 'missing'}).`
            : metaDiagnostic.failureCode
              ? `Diagnóstico Meta bloqueou o preflight: ${metaDiagnostic.failureCode}.`
              : !plan || !connectionId || !adAccountReady
                ? 'O plano não possui um destino Meta executável e atual.'
                : !connectionReady
                  ? `A conexão Meta não está pronta (estado: ${connection?.status ?? 'missing'}).`
                  : !pageReady || !whatsappReady
                    ? 'A Página e o WhatsApp selecionados não estão completos ou são ambíguos.'
                    : 'O destino Meta real não pôde ser comprovado.',
      },
      {
        key: 'write_adapter_enabled', status: adapterReady ? 'passed' : 'blocked',
        evidenceRefs: adapterReady ? ['runtime:meta_write_adapter_enabled'] : [],
        meaning: adapterReady
          ? 'O adapter de escrita está habilitado no ambiente hospedado controlado.'
          : 'O adapter de escrita não está habilitado neste ambiente.',
      },
    ];
    const blockers = checks.filter((check) => check.status === 'blocked')
      .map((check) => check.key);
    const boundaries: ExecutionPreflightV1['boundaries'] = {
      executionRecordCreated: false,
      externalAttemptStarted: false,
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    };
    const semantic = {
      purpose: 'execution_preflight_v1',
      tenantId,
      executionAuthorizationId,
      executionManifestId: manifest.executionManifestId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      authorizationStatus: authorization.status,
      checks,
      blockers,
      metaDiagnostic,
      boundaries,
    };
    const generatedAt = new Date().toISOString();
    const preflight: ExecutionPreflightV1 = {
      executionPreflightId: randomUUID(),
      tenantId,
      campaignId: manifest.campaignId,
      executionPlanId: manifest.executionPlanId,
      executionManifestId: manifest.executionManifestId,
      executionAuthorizationId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      preflightHash: this.hash(semantic),
      status: 'blocked_before_attempt',
      checks,
      blockers,
      metaDiagnostic,
      nextAction: blockers.length
        ? this.nextAction(blockers[0])
        : validationProtocol?.status === 'external_validation_succeeded'
          ? 'Reutilizar de forma idempotente a validação Meta já concluída para este manifesto e retornar os objetos PAUSED existentes.'
          : 'Executar uma única criação controlada, mantendo todos os objetos em PAUSED.',
      boundaries,
      generatedAt,
    };
    return this.authorizations.savePreflightIdempotent(
      preflight,
      this.event(authorization, undefined, 'execution_preflight_blocked', {
        status: preflight.status,
        blockers,
        metaDiagnosticStatus: metaDiagnostic.status,
        metaDiagnosticFailureCode: metaDiagnostic.failureCode,
        executionRecordCreated: false,
      }, 'blocked', generatedAt, preflight.executionPreflightId, 'execution_preflight'),
    );
  }

  private async buildMetaDiagnostic(
    tenantId: string,
    connectionId: string | undefined,
    connectionStatus: string | undefined,
    credentialRef: string | undefined,
    configuredAdAccountId: string | undefined,
    bindings: MetaAssetBinding[],
  ): Promise<MetaPreflightDiagnosticV1> {
    const observedAt = new Date().toISOString();
    const selectedPages = bindings.filter((item) =>
      item.assetType === 'facebook_page' && item.selected);
    const selectedWhatsapp = bindings.filter((item) =>
      item.assetType === 'whatsapp' && item.selected);
    const selectedAdAccounts = bindings.filter((item) =>
      item.assetType === 'ad_account' && item.selected);
    const base = {
      observedAt,
      connection: {
        status: 'blocked' as const,
        ...(connectionId ? { connectionId } : {}),
        ...(connectionStatus ? { connectionStatus } : {}),
      },
      adAccount: {
        status: 'blocked' as const,
        ...(configuredAdAccountId ? { configuredId: configuredAdAccountId } : {}),
      },
      facebookPage: {
        status: 'blocked' as const,
        selectedId: selectedPages[0]?.externalId,
        selectedDisplayName: selectedPages[0]?.displayName,
        discovered: false,
      },
      whatsapp: {
        status: 'blocked' as const,
        selectedId: selectedWhatsapp[0]?.externalId,
        selectedDisplayName: selectedWhatsapp[0]?.displayName,
        recognizedNumber: selectedWhatsapp[0]?.displayName,
        discovered: false,
      },
      relationships: {
        status: 'blocked' as const,
        selectedPageCount: selectedPages.length,
        selectedWhatsappCount: selectedWhatsapp.length,
        selectedAdAccountCount: selectedAdAccounts.length,
      },
      permissions: {
        status: 'blocked' as const,
        required: [] as string[],
        granted: [] as string[],
        missing: [] as string[],
        capabilities: [] as MetaPreflightDiagnosticV1['permissions']['capabilities'],
      },
    };

    if (!connectionId || !credentialRef || !['connected', 'ready'].includes(connectionStatus ?? '')) {
      return {
        ...base,
        status: 'blocked',
        failureCode: 'meta_connection_not_ready',
        connection: {
          ...base.connection,
          reason: 'A conexão Meta não possui credencial válida e estado connected/ready.',
        },
      };
    }
    if (!this.readonlyAdapter) {
      return {
        ...base,
        status: 'blocked',
        failureCode: 'meta_read_diagnostic_unavailable',
        connection: {
          ...base.connection,
          reason: 'O adapter Meta somente-leitura não está disponível no runtime.',
        },
      };
    }

    const connectionRead = await this.readonlyAdapter.validateConnection(tenantId, credentialRef);
    if (!connectionRead.success || !connectionRead.data) {
      return {
        ...base,
        status: 'blocked',
        observedAt: connectionRead.observedAt,
        failureCode: 'meta_connection_validation_failed',
        connection: {
          ...base.connection,
          normalizedError: connectionRead.normalizedError,
          reason: 'A Meta recusou ou não confirmou a identidade OAuth da conexão.',
        },
      };
    }

    const connectedBase = {
      ...base,
      observedAt: connectionRead.observedAt,
      connection: {
        status: 'passed' as const,
        connectionId,
        connectionStatus,
        oauthSubjectId: connectionRead.data.subjectId,
      },
    };
    if (!configuredAdAccountId || !/^act_\d+$/.test(configuredAdAccountId)) {
      return {
        ...connectedBase,
        status: 'blocked',
        failureCode: 'ad_account_missing_or_invalid',
        adAccount: {
          ...connectedBase.adAccount,
          reason: 'O plano não contém uma conta de anúncios executável no formato act_<id>.',
        },
      };
    }

    const [assetsRead, adAccountRead, permissionsRead] = await Promise.all([
      this.readonlyAdapter.discoverAssets(credentialRef, tenantId),
      this.readonlyAdapter.readAdAccount(tenantId, credentialRef, configuredAdAccountId),
      this.readonlyAdapter.validateCapabilities(
        tenantId, credentialRef, bindings, PREFLIGHT_META_CAPABILITIES,
      ),
    ]);

    const adData = adAccountRead.success && adAccountRead.data
      ? adAccountRead.data : undefined;
    const recognizedAdId = typeof adData?.id === 'string' ? adData.id : undefined;
    const adAccountPassed = recognizedAdId === configuredAdAccountId;
    const adAccount: MetaPreflightDiagnosticV1['adAccount'] = {
      status: adAccountPassed ? 'passed' : 'blocked',
      configuredId: configuredAdAccountId,
      ...(recognizedAdId ? { recognizedId: recognizedAdId } : {}),
      ...(typeof adData?.name === 'string' ? { name: adData.name } : {}),
      ...(['string', 'number'].includes(typeof adData?.account_status)
        ? { accountStatus: adData?.account_status as string | number } : {}),
      ...(typeof adData?.currency === 'string' ? { currency: adData.currency } : {}),
      ...(typeof adData?.timezone_name === 'string' ? { timezoneName: adData.timezone_name } : {}),
      ...(!adAccountRead.success && adAccountRead.normalizedError
        ? { normalizedError: adAccountRead.normalizedError } : {}),
      ...(!adAccountPassed ? { reason: 'A conta configurada não foi confirmada por leitura autenticada da Meta.' } : {}),
    };
    if (!adAccountPassed) {
      return {
        ...connectedBase,
        status: 'blocked',
        failureCode: 'ad_account_not_recognized',
        adAccount,
      };
    }

    if (selectedPages.length !== 1) {
      return {
        ...connectedBase,
        status: 'blocked',
        adAccount,
        failureCode: 'facebook_page_missing_or_ambiguous',
        facebookPage: {
          ...connectedBase.facebookPage,
          reason: `É necessário exatamente uma Página selecionada; encontradas ${selectedPages.length}.`,
        },
      };
    }
    if (selectedWhatsapp.length !== 1) {
      return {
        ...connectedBase,
        status: 'blocked',
        adAccount,
        failureCode: 'whatsapp_missing_or_ambiguous',
        whatsapp: {
          ...connectedBase.whatsapp,
          reason: `É necessário exatamente um WhatsApp selecionado; encontrados ${selectedWhatsapp.length}.`,
        },
      };
    }

    const discoveredAssets = assetsRead.success ? assetsRead.data ?? [] : [];
    const pageDiscovered = discoveredAssets.some((item) =>
      item.assetType === 'facebook_page' && item.externalId === selectedPages[0].externalId);
    const whatsappDiscovered = discoveredAssets.some((item) =>
      item.assetType === 'whatsapp' && item.externalId === selectedWhatsapp[0].externalId);
    const discoveredWhatsapp = discoveredAssets.find((item) =>
      item.assetType === 'whatsapp' && item.externalId === selectedWhatsapp[0].externalId);
    const facebookPage: MetaPreflightDiagnosticV1['facebookPage'] = {
      status: pageDiscovered ? 'passed' : 'blocked',
      selectedId: selectedPages[0].externalId,
      selectedDisplayName: selectedPages[0].displayName,
      discovered: pageDiscovered,
      ...(!pageDiscovered ? { reason: assetsRead.success
        ? 'A Página selecionada não apareceu na descoberta autenticada de ativos.'
        : `A descoberta de ativos falhou (${assetsRead.normalizedError ?? 'UNKNOWN'}).` } : {}),
    };
    if (!pageDiscovered) {
      return {
        ...connectedBase,
        status: 'blocked',
        adAccount,
        facebookPage,
        failureCode: 'facebook_page_not_discovered',
      };
    }

    const whatsapp: MetaPreflightDiagnosticV1['whatsapp'] = {
      status: whatsappDiscovered ? 'passed' : 'blocked',
      selectedId: selectedWhatsapp[0].externalId,
      selectedDisplayName: selectedWhatsapp[0].displayName,
      recognizedNumber: discoveredWhatsapp?.displayName ?? selectedWhatsapp[0].displayName,
      discovered: whatsappDiscovered,
      ...(!whatsappDiscovered ? { reason: assetsRead.success
        ? 'O WhatsApp selecionado não apareceu na descoberta autenticada de ativos da Meta.'
        : `A descoberta de ativos falhou (${assetsRead.normalizedError ?? 'UNKNOWN'}).` } : {}),
    };
    if (!whatsappDiscovered) {
      return {
        ...connectedBase,
        status: 'blocked',
        adAccount,
        facebookPage,
        whatsapp,
        failureCode: 'whatsapp_not_discovered',
      };
    }

    const relationships: MetaPreflightDiagnosticV1['relationships'] = {
      status: 'passed',
      selectedPageCount: selectedPages.length,
      selectedWhatsappCount: selectedWhatsapp.length,
      selectedAdAccountCount: selectedAdAccounts.length,
      reason: 'Conta do plano, Página selecionada e WhatsApp selecionado foram reconhecidos na mesma conexão Meta.',
    };

    const capabilityEvidence = permissionsRead.success ? permissionsRead.data ?? [] : [];
    const required = [...new Set(capabilityEvidence.flatMap((item) => item.requiredPermissions))];
    const granted = [...new Set(capabilityEvidence.flatMap((item) => item.grantedPermissions))];
    const missing = required.filter((permission) => !granted.includes(permission));
    const unavailable = capabilityEvidence.filter((item) => !item.available);
    const permissionsPassed = permissionsRead.success
      && capabilityEvidence.length > 0
      && missing.length === 0
      && unavailable.length === 0;
    const permissions: MetaPreflightDiagnosticV1['permissions'] = {
      status: permissionsPassed ? 'passed' : 'blocked',
      required,
      granted,
      missing,
      capabilities: capabilityEvidence.map((item) => ({
        capability: item.capability,
        available: item.available,
        ...(item.assetScope ? { assetScope: item.assetScope } : {}),
        ...(item.reason ? { reason: item.reason } : {}),
      })),
      ...(!permissionsRead.success && permissionsRead.normalizedError
        ? { normalizedError: permissionsRead.normalizedError } : {}),
      ...(!permissionsPassed ? { reason: permissionsRead.success
        ? 'Uma ou mais permissões/capabilities exigidas pela campanha não estão disponíveis para os ativos selecionados.'
        : 'A Meta não permitiu validar as permissões do token.' } : {}),
    };
    if (!permissionsPassed) {
      return {
        ...connectedBase,
        status: 'blocked',
        adAccount,
        facebookPage,
        whatsapp,
        relationships,
        permissions,
        failureCode: 'meta_permissions_missing',
      };
    }

    return {
      ...connectedBase,
      status: 'passed',
      adAccount,
      facebookPage,
      whatsapp,
      relationships,
      permissions,
    };
  }

  private async transition(
    tenantIdValue: unknown,
    idValue: unknown,
    actorValue: unknown,
    reasonValue: unknown,
    from: ExecutionAuthorizationV1['status'][],
    to: ExecutionAuthorizationV1['status'],
    eventType: string,
  ): Promise<ExecutionAuthorizationV1> {
    this.assertUuid(tenantIdValue, 'tenantId');
    this.assertUuid(idValue, 'executionAuthorizationId');
    const actor = this.assertActor(actorValue, 'actor');
    const reason = this.assertReason(reasonValue);
    const current = await this.refresh(tenantIdValue, idValue);
    this.assertStatus(current, from);
    const now = new Date().toISOString();
    const result = await this.authorizations.transition(
      tenantIdValue, idValue, from, to, now, reason,
      this.event(current, actor, eventType, { status: to, reason }, 'success', now),
    );
    if (!result) throw new ConflictException('Authorization state changed');
    return result;
  }

  private async refresh(
    tenantId: string,
    id: string,
  ): Promise<ExecutionAuthorizationV1> {
    const current = await this.authorizations.findById(tenantId, id);
    if (!current) throw new NotFoundException('Execution authorization not found');
    if (!['pending', 'approved'].includes(current.status)) return current;
    const now = new Date().toISOString();
    return await this.authorizations.expireOrInvalidate(
      tenantId, id, now,
      this.event(current, undefined, 'execution_authorization_refreshed', {},
        'blocked', now),
    ) ?? current;
  }

  private async currentManifest(
    tenantId: string,
    executionManifestId: string,
  ): Promise<ExecutionManifestV1> {
    const manifest = await this.manifests.findById(tenantId, executionManifestId);
    if (!manifest) throw new NotFoundException('Execution manifest not found');
    const latest = await this.manifests.latestForPlan(tenantId, manifest.executionPlanId);
    if (!latest || latest.executionManifestId !== executionManifestId
      || latest.manifestHash !== manifest.manifestHash) {
      throw new ConflictException('Only the latest execution manifest can be authorized');
    }
    return manifest;
  }

  private nextAction(blocker?: ExecutionPreflightCheckV1['key']): string {
    const actions: Record<ExecutionPreflightCheckV1['key'], string> = {
      manifest_current: 'Prepare e autorize o manifesto mais recente.',
      specific_execution_authorization: 'Aprove uma autorização específica ainda válida.',
      tenant_kill_switch: 'Implementar e validar o Kill Switch fail-closed do tenant.',
      campaign_kill_switch: 'Implementar e validar o Kill Switch da campanha.',
      meta_geography_resolved: 'Corrigir ou selecionar uma geografia reconhecida pela Meta.',
      real_meta_write_validation: 'Corrigir o item exato indicado em metaDiagnostic e repetir somente o preflight.',
      write_adapter_enabled: 'Habilitar o adapter somente após os demais gates.',
    };
    return blocker ? actions[blocker] : 'Nenhuma ação externa foi autorizada.';
  }

  private async validateGeography(
    tenantId: string,
    credentialRef: string,
    geography: unknown,
  ): Promise<{ passed: boolean; evidenceRefs: string[]; meaning: string }> {
    if (typeof geography !== 'string') return {
      passed: false,
      evidenceRefs: [],
      meaning: 'O plano não possui uma geografia executável.',
    };
    let targets;
    try {
      targets = parseMetaGeography(
        geography,
        Number(this.config?.get<string>('META_CITY_RADIUS_KM') ?? '40'),
      );
    } catch {
      return { passed: false, evidenceRefs: [],
        meaning: 'A geografia do plano está em um formato inválido.' };
    }
    const evidenceRefs: string[] = [];
    for (const target of targets) {
      const result = await this.writeAdapter?.searchCity(
        tenantId, credentialRef, target.city, 'BR',
      );
      if (!result?.success || !result.data) return {
        passed: false,
        evidenceRefs,
        meaning: `A Meta não reconheceu a cidade ${target.city} para segmentação.`,
      };
      evidenceRefs.push(`meta_geography:${result.data.key}:${target.radius}km`);
    }
    return {
      passed: true,
      evidenceRefs,
      meaning: 'Todas as cidades e raios foram reconhecidos pela Meta sem realizar escrita.',
    };
  }

  private assertStatus(
    authorization: ExecutionAuthorizationV1,
    allowed: ExecutionAuthorizationV1['status'][],
  ): void {
    if (!allowed.includes(authorization.status)) {
      throw new ConflictException(`Authorization status is ${authorization.status}`);
    }
  }

  private event(
    authorization: ExecutionAuthorizationV1,
    actorId: string | undefined,
    eventType: string,
    newState: unknown,
    result: AuditEvent['result'],
    createdAt: string,
    objectId = authorization.executionAuthorizationId,
    objectType = 'execution_authorization',
  ): AuditEvent {
    return {
      auditEventId: randomUUID(), tenantId: authorization.tenantId,
      correlationId: authorization.correlationId,
      actorType: actorId ? 'user' : 'system',
      ...(actorId ? { actorId } : {}), eventType, objectType, objectId,
      newState, result, createdAt,
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertActor(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 200) {
      throw new BadRequestException(`${field} must have between 2 and 200 characters`);
    }
    return value.trim();
  }

  private assertReason(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 1000) {
      throw new BadRequestException('reason must have between 3 and 1000 characters');
    }
    return value.trim();
  }

  private assertUuid(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }
}
