import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExecutionManifestRepository,
  ExecutionPlanRepository,
  MetaConnectionRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_MANIFEST_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  META_CONNECTION_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { ExecutionManifestOperationV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import { MetaWriteAdapter } from '../meta-adapter/meta-write.adapter';
import { ExecutionAuthorizationService } from '../execution-authorization/execution-authorization.service';
import { KillSwitchService } from '../kill-switch/kill-switch.service';

type ExternalIds = Record<string, string>;

@Injectable()
export class AutomatedMetaPublicationService {
  constructor(
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections: MetaConnectionRepository,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly protocols: MetaWriteValidationProtocolRepository,
    private readonly authorizations: ExecutionAuthorizationService,
    private readonly killSwitch: KillSwitchService,
    private readonly adapter: MetaWriteAdapter,
    private readonly config: ConfigService,
  ) {}

  async executePaused(
    tenantIdValue: unknown,
    executionAuthorizationIdValue: unknown,
    actorValue: unknown,
  ): Promise<MetaWriteValidationProtocolV1> {
    const tenantId = this.uuid(tenantIdValue, 'tenantId');
    const executionAuthorizationId = this.uuid(
      executionAuthorizationIdValue,
      'executionAuthorizationId',
    );
    const actor = this.actor(actorValue);
    if (!this.adapter.enabled()) throw new ConflictException({
      code: 'meta_write_adapter_disabled', message: 'O executor real da Meta não está habilitado.',
    });
    const authorization = await this.authorizations.get(tenantId, executionAuthorizationId);
    if (authorization.status !== 'approved') throw new ConflictException({
      code: 'execution_authorization_not_approved', message: 'A autorização técnica não está aprovada.',
    });
    const manifest = await this.manifests.findById(tenantId, authorization.executionManifestId);
    if (!manifest || manifest.manifestHash !== authorization.manifestHash) {
      throw new ConflictException('O manifesto autorizado não é mais atual.');
    }
    const latestManifest = await this.manifests.latestForPlan(tenantId, manifest.executionPlanId);
    if (!latestManifest || latestManifest.manifestHash !== manifest.manifestHash) {
      throw new ConflictException('Somente o manifesto mais recente pode ser executado.');
    }
    const switches = await this.killSwitch.effective(tenantId, manifest.campaignId);
    if (switches.tenant.status !== 'released' || switches.campaign.status !== 'released') {
      throw new ConflictException({ code: 'kill_switch_closed', message: 'As travas de segurança não estão liberadas.' });
    }
    const plan = await this.plans.findById(tenantId, manifest.executionPlanId);
    const prepared = await this.protocols.latestForManifest(tenantId, manifest.executionManifestId);
    if (!plan || plan.planHash !== manifest.planHash) throw new ConflictException('O plano está ausente ou desatualizado.');
    if (!prepared) throw new ConflictException('O protocolo de validação da Meta está ausente.');
    if (prepared.status === 'external_validation_succeeded') return prepared;
    if (prepared.status !== 'prepared_external_validation_required') throw new ConflictException({
      code: 'meta_execution_already_started', message: `Estado do protocolo: ${prepared.status}`,
    });

    const connectionId = plan.meta.connectionId;
    const adAccountId = plan.meta.adAccountId;
    if (!connectionId || !adAccountId || !/^act_\d+$/.test(adAccountId)) {
      throw new ConflictException('A conta de anúncios vinculada não é válida.');
    }
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection?.credentialRef || !['connected', 'ready'].includes(connection.status)) {
      throw new ConflictException('A conexão Meta não está pronta.');
    }
    const bindings = await this.connections.listBindings(tenantId, connectionId);
    const pageId = this.selected(bindings, 'facebook_page');
    const whatsappId = this.selected(bindings, 'whatsapp');
    if (!pageId || !whatsappId) throw new ConflictException('Página e WhatsApp selecionados são obrigatórios.');

    let state: MetaWriteValidationProtocolV1 = {
      ...prepared,
      status: 'external_validation_running',
      boundaries: {
        ...prepared.boundaries,
        protocolIsExecutionCommand: true,
        executionRecordCreated: true,
        externalAttemptStarted: true,
        writeAdapterEnabled: true,
        externalWritesAllowed: true,
        externalWritesPerformed: false,
      },
      execution: {
        executionAuthorizationId,
        startedAt: new Date().toISOString(),
        operations: prepared.operations.map((operation) => ({
          operationKey: operation.operationKey,
          objectType: operation.objectType,
          status: 'pending',
        })),
      },
    };
    const begun = await this.protocols.beginExecution(state, this.eventState(state, actor, 'meta_write_execution_started'));
    if (!begun) throw new ConflictException('A execução real já foi iniciada.');
    state = begun;

    const ids: ExternalIds = {};
    try {
      const configs = new Map(plan.objectsToCreate.map((item) => [item.internalObjectId, item.logicalConfig]));
      const cityKeys = await this.cityKeys(tenantId, connection.credentialRef, plan);
      const executable = new Set(prepared.operations.map((item) => item.operationKey));
      for (const operation of [...manifest.operations]
        .filter((item) => executable.has(item.operationKey))
        .sort((a, b) => a.order - b.order)) {
        const config = configs.get(operation.internalObjectId);
        if (!config) throw new Error('MANIFEST_CONFIG_MISSING');
        const operationState = state.execution?.operations.find((item) => item.operationKey === operation.operationKey);
        if (!operationState) throw new Error('PROTOCOL_OPERATION_MISSING');

        let videoId: string | undefined;
        if (operation.objectType === 'creative') {
          const asset = this.record(config.asset, 'creative.asset');
          if (asset.mimeType === 'video/mp4') {
            const storageRef = this.httpsUrl(asset.storageRef, 'creative.storageRef');
            const uploaded = await this.adapter.create(
              tenantId,
              connection.credentialRef,
              `/${adAccountId}/advideos`,
              { file_url: storageRef, title: `Contexto Ads video ${operation.idempotencyKey.slice(0, 10)}` },
            );
            if (!uploaded.success || !uploaded.data) throw new Error(uploaded.normalizedError ?? 'VIDEO_UPLOAD_FAILED');
            videoId = uploaded.data.id;
            operationState.mediaExternalObjectId = videoId;
            state.boundaries.externalWritesPerformed = true;
            state = await this.protocols.updateExecution(state, this.eventState(state, actor, 'meta_video_upload_succeeded'));
          }
        }

        const request = this.requestFor(operation, config, plan, ids, pageId, whatsappId, cityKeys, videoId);
        const result = await this.adapter.create(
          tenantId,
          connection.credentialRef,
          `/${adAccountId}/${request.edge}`,
          request.params,
        );
        if (!result.success || !result.data) {
          operationState.status = result.retryable ? 'uncertain' : 'failed';
          operationState.normalizedError = result.normalizedError ?? 'UNKNOWN';
          operationState.diagnosticCode = result.diagnosticCode;
          throw new Error(result.normalizedError ?? 'UNKNOWN');
        }
        ids[operation.internalObjectId] = result.data.id;
        const observed = await this.adapter.read(
          tenantId,
          connection.credentialRef,
          result.data.id,
          operation.objectType !== 'creative',
        );
        if (!observed.success || !observed.data) {
          operationState.status = observed.retryable ? 'uncertain' : 'failed';
          operationState.externalObjectId = result.data.id;
          throw new Error(observed.normalizedError ?? 'META_READ_FAILED');
        }
        if (operation.objectType !== 'creative'
          && !this.paused(observed.data.configuredStatus, observed.data.effectiveStatus)) {
          operationState.status = 'failed';
          operationState.externalObjectId = result.data.id;
          operationState.observedStatus = observed.data.configuredStatus
            ?? observed.data.effectiveStatus ?? 'UNKNOWN';
          throw new Error('UNEXPECTED_ACTIVE_STATE');
        }
        operationState.status = 'succeeded';
        operationState.externalObjectId = result.data.id;
        operationState.observedStatus = operation.objectType === 'creative'
          ? 'CREATED_NO_DELIVERY_STATE'
          : observed.data.configuredStatus ?? observed.data.effectiveStatus ?? 'PAUSED';
        state.boundaries.externalWritesPerformed = true;
        state = await this.protocols.updateExecution(state, this.eventState(state, actor, 'meta_write_operation_succeeded'));
      }
      state = {
        ...state,
        status: 'external_validation_succeeded',
        requiredEvidence: state.requiredEvidence.map((item) => ({
          ...item,
          status: 'collected',
          evidenceRefs: [`meta_execution:${state.metaWriteValidationProtocolId}:${item.key}`],
        })),
        boundaries: { ...state.boundaries, realMetaWriteValidated: true, externalWritesAllowed: false },
        execution: state.execution ? { ...state.execution, completedAt: new Date().toISOString() } : undefined,
      };
      return this.protocols.updateExecution(state, this.eventState(state, actor, 'meta_write_validation_succeeded'));
    } catch (error) {
      await this.killSwitch.changeCampaign(
        tenantId,
        manifest.campaignId,
        'engaged',
        actor,
        'Execução Meta interrompida automaticamente para reconciliação segura.',
      );
      const failed: MetaWriteValidationProtocolV1 = {
        ...state,
        status: 'external_validation_failed',
        boundaries: { ...state.boundaries, externalWritesAllowed: false },
        execution: state.execution ? { ...state.execution, completedAt: new Date().toISOString() } : undefined,
      };
      return this.protocols.updateExecution(failed, this.eventState(failed, actor, 'meta_write_validation_failed'));
    }
  }

  async publish(
    tenantIdValue: unknown,
    executionPlanIdValue: unknown,
    actorValue: unknown,
    roundTrip = false,
  ) {
    const tenantId = this.uuid(tenantIdValue, 'tenantId');
    const executionPlanId = this.uuid(executionPlanIdValue, 'executionPlanId');
    const actor = this.actor(actorValue);
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    const latestPlan = await this.plans.latest(tenantId, plan.campaignId);
    if (!latestPlan || latestPlan.executionPlanId !== executionPlanId || latestPlan.planHash !== plan.planHash) {
      throw new ConflictException('Somente o plano atual pode ser publicado.');
    }
    const manifest = await this.manifests.latestForPlan(tenantId, executionPlanId);
    if (!manifest || manifest.planHash !== plan.planHash) throw new ConflictException('Manifesto atual ausente.');
    const protocol = await this.protocols.latestForManifest(tenantId, manifest.executionManifestId);
    if (!protocol || protocol.status !== 'external_validation_succeeded') {
      throw new ConflictException({ code: 'paused_validation_required', message: 'A validação real em PAUSED deve ser concluída antes da publicação.' });
    }
    const switches = await this.killSwitch.effective(tenantId, plan.campaignId);
    if (switches.tenant.status !== 'released' || switches.campaign.status !== 'released') {
      throw new ConflictException('As travas de segurança não estão liberadas.');
    }
    const connectionId = plan.meta.connectionId;
    if (!connectionId) throw new ConflictException('Conexão Meta ausente.');
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection?.credentialRef) throw new ConflictException('Credencial Meta ausente.');
    const lifecycle = (protocol.execution?.operations ?? [])
      .filter((item) => item.externalObjectId && ['campaign', 'ad_set', 'ad'].includes(item.objectType))
      .map((item) => ({ objectType: item.objectType, id: item.externalObjectId! }));
    if (!lifecycle.some((item) => item.objectType === 'campaign')
      || !lifecycle.some((item) => item.objectType === 'ad_set')
      || !lifecycle.some((item) => item.objectType === 'ad')) {
      throw new ConflictException('Os objetos validados na Meta estão incompletos.');
    }
    const priority: Record<string, number> = { campaign: 0, ad_set: 1, ad: 2 };
    lifecycle.sort((a, b) => priority[a.objectType] - priority[b.objectType]);
    const activated: typeof lifecycle = [];
    try {
      for (const object of lifecycle) {
        const current = await this.adapter.read(tenantId, connection.credentialRef, object.id, true);
        if (current.success && current.data?.configuredStatus === 'ACTIVE') {
          activated.push(object);
          continue;
        }
        const result = await this.adapter.updateStatus(tenantId, connection.credentialRef, object.id, 'ACTIVE');
        if (!result.success || result.data?.configuredStatus !== 'ACTIVE') throw new Error('ACTIVATION_FAILED');
        activated.push(object);
      }
      if (roundTrip) {
        for (const object of [...activated].reverse()) {
          const paused = await this.adapter.updateStatus(tenantId, connection.credentialRef, object.id, 'PAUSED');
          if (!paused.success || paused.data?.configuredStatus !== 'PAUSED') throw new Error('ROUNDTRIP_PAUSE_FAILED');
        }
        return {
          status: 'ACTIVATION_ROUNDTRIP_PASSED',
          campaign_id: plan.campaignId,
          execution_plan_id: executionPlanId,
          objects: lifecycle,
          campaign_active: false,
          delivery_authorized: false,
          spend_authorized: false,
        };
      }
      return {
        status: 'PUBLISHED_ACTIVE_CONFIGURED',
        campaign_id: plan.campaignId,
        execution_plan_id: executionPlanId,
        objects: lifecycle,
        campaign_active: true,
        delivery_authorized: true,
        spend_authorized: true,
      };
    } catch (error) {
      for (const object of [...activated].reverse()) {
        await this.adapter.updateStatus(tenantId, connection.credentialRef, object.id, 'PAUSED').catch(() => undefined);
      }
      await this.killSwitch.changeCampaign(
        tenantId,
        plan.campaignId,
        'engaged',
        actor,
        'Falha na ativação; rollback para PAUSED executado automaticamente.',
      );
      throw new ConflictException({
        code: 'publication_activation_failed',
        message: 'A ativação não foi concluída e os objetos foram devolvidos ao estado PAUSED.',
      });
    }
  }

  async pause(
    tenantIdValue: unknown,
    executionPlanIdValue: unknown,
    actorValue: unknown,
    reasonValue: unknown,
  ) {
    const tenantId = this.uuid(tenantIdValue, 'tenantId');
    const executionPlanId = this.uuid(executionPlanIdValue, 'executionPlanId');
    const actor = this.actor(actorValue);
    const reason = this.string(reasonValue, 'reason');
    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    const latestPlan = await this.plans.latest(tenantId, plan.campaignId);
    if (!latestPlan || latestPlan.executionPlanId !== executionPlanId
      || latestPlan.planHash !== plan.planHash) {
      throw new ConflictException('Somente o plano atual pode ser pausado.');
    }
    const manifest = await this.manifests.latestForPlan(tenantId, executionPlanId);
    if (!manifest || manifest.planHash !== plan.planHash) {
      throw new ConflictException('Manifesto atual ausente.');
    }
    const protocol = await this.protocols.latestForManifest(tenantId, manifest.executionManifestId);
    if (!protocol || protocol.status !== 'external_validation_succeeded') {
      throw new ConflictException('Os objetos Meta validados não estão disponíveis para pausa.');
    }
    const connectionId = plan.meta.connectionId;
    if (!connectionId) throw new ConflictException('Conexão Meta ausente.');
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection?.credentialRef) throw new ConflictException('Credencial Meta ausente.');
    const lifecycle = (protocol.execution?.operations ?? [])
      .filter((item) => item.externalObjectId && ['campaign', 'ad_set', 'ad'].includes(item.objectType))
      .map((item) => ({ objectType: item.objectType, id: item.externalObjectId! }));
    if (!lifecycle.some((item) => item.objectType === 'campaign')
      || !lifecycle.some((item) => item.objectType === 'ad_set')
      || !lifecycle.some((item) => item.objectType === 'ad')) {
      throw new ConflictException('Os objetos validados na Meta estão incompletos.');
    }
    const priority: Record<string, number> = { ad: 0, ad_set: 1, campaign: 2 };
    lifecycle.sort((a, b) => priority[a.objectType] - priority[b.objectType]);
    const failures: Array<{ objectType: string; id: string }> = [];
    for (const object of lifecycle) {
      const current = await this.adapter.read(tenantId, connection.credentialRef, object.id, true);
      if (current.success && current.data?.configuredStatus === 'PAUSED') continue;
      const paused = await this.adapter.updateStatus(
        tenantId, connection.credentialRef, object.id, 'PAUSED',
      );
      if (!paused.success || paused.data?.configuredStatus !== 'PAUSED') failures.push(object);
    }
    await this.killSwitch.changeCampaign(
      tenantId, plan.campaignId, 'engaged', actor,
      `Piloto ativo pausado automaticamente: ${reason}`,
    );
    if (failures.length) {
      throw new ConflictException({
        code: 'campaign_pause_incomplete',
        message: 'A trava foi acionada, mas nem todos os objetos confirmaram PAUSED.',
        failed_object_count: failures.length,
      });
    }
    return {
      status: 'PAUSED_CONFIRMED',
      campaign_id: plan.campaignId,
      execution_plan_id: executionPlanId,
      objects: lifecycle,
      reason,
      campaign_active: false,
      delivery_authorized: false,
      spend_authorized: false,
      kill_switch_engaged: true,
    };
  }

  private async cityKeys(
    tenantId: string,
    credentialRef: string,
    plan: ExecutionPlanV1,
  ) {
    const adSet = plan.objectsToCreate.find((item) => item.type === 'ad_set');
    const geography = adSet?.logicalConfig.geography;
    if (typeof geography !== 'string') throw new Error('GEOGRAPHY_MISSING');
    const entries = geography.split(';').map((item) => item.trim()).filter(Boolean);
    const results: Array<{ key: string; radius: number; distance_unit: 'kilometer' }> = [];
    for (const entry of entries) {
      if (/^Excluir\s+/i.test(entry)) continue;
      const cleaned = entry.replace(/^Incluir\s+/i, '').trim();
      const match = /^(.+?),\s*([A-Z]{2}),\s*[^()]+?(?:\s*\(([0-9.]+)\s*km\))?$/i.exec(cleaned);
      if (!match) throw new Error('GEOGRAPHY_INVALID');
      const city = match[1].trim();
      const radius = match[3] ? Number(match[3]) : Number(this.config.get<string>('META_CITY_RADIUS_KM') ?? '40');
      if (!Number.isFinite(radius) || radius < 1 || radius > 80) throw new Error('GEOGRAPHY_RADIUS_INVALID');
      const found = await this.adapter.searchCity(tenantId, credentialRef, city, 'BR');
      if (!found.success || !found.data) throw new Error('GEOGRAPHY_LOOKUP_FAILED');
      results.push({ key: found.data.key, radius: Math.round(radius), distance_unit: 'kilometer' });
    }
    if (!results.length || results.length > 20) throw new Error('GEOGRAPHY_INVALID');
    return results;
  }

  private requestFor(
    operation: ExecutionManifestOperationV1,
    config: Record<string, unknown>,
    plan: ExecutionPlanV1,
    ids: ExternalIds,
    pageId: string,
    whatsappId: string,
    cityKeys: Array<{ key: string; radius: number; distance_unit: 'kilometer' }>,
    videoId?: string,
  ): { edge: 'campaigns' | 'adsets' | 'adcreatives' | 'ads'; params: Record<string, any> } {
    const suffix = operation.idempotencyKey.slice(0, 10);
    if (operation.objectType === 'campaign') return { edge: 'campaigns', params: {
      name: `${this.string(config.name, 'campaign.name')} [CTX-${suffix}]`,
      objective: this.string(config.objective, 'campaign.objective'),
      status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false,
    } };
    if (operation.objectType === 'creative') {
      const copy = this.record(config.copy, 'creative.copy');
      const asset = this.record(config.asset, 'creative.asset');
      const callToAction = { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
      if (asset.mimeType === 'video/mp4') {
        if (!videoId) throw new Error('VIDEO_ID_MISSING');
        return { edge: 'adcreatives', params: {
          name: `Contexto Ads video creative [CTX-${suffix}]`,
          object_story_spec: {
            page_id: pageId,
            video_data: {
              video_id: videoId,
              message: this.string(copy.primaryText, 'creative.primaryText'),
              title: this.string(copy.headline, 'creative.headline'),
              call_to_action: callToAction,
            },
          },
        } };
      }
      return { edge: 'adcreatives', params: {
        name: `Contexto Ads image creative [CTX-${suffix}]`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link: 'https://api.whatsapp.com/send',
            picture: this.httpsUrl(asset.storageRef, 'creative.storageRef'),
            message: this.string(copy.primaryText, 'creative.primaryText'),
            name: this.string(copy.headline, 'creative.headline'),
            ...(typeof copy.description === 'string' ? { description: copy.description } : {}),
            call_to_action: callToAction,
          },
        },
      } };
    }
    if (operation.objectType === 'ad_set') {
      const campaignId = this.dependencyId(operation, ids, 'campaign');
      const budget = this.record(config.budget, 'ad_set.budget');
      const durationDays = this.integer(config.durationDays, 'ad_set.durationDays');
      const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
      return { edge: 'adsets', params: {
        name: `Contexto Ads | WhatsApp [CTX-${suffix}]`,
        campaign_id: campaignId,
        billing_event: 'IMPRESSIONS', optimization_goal: 'CONVERSATIONS',
        destination_type: 'WHATSAPP', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        daily_budget: this.integer(budget.amountMinor, 'ad_set.budget.amountMinor'),
        start_time: start.toISOString(), end_time: end.toISOString(),
        promoted_object: { page_id: pageId },
        targeting: { geo_locations: { cities: cityKeys }, publisher_platforms: ['facebook', 'instagram'] },
        status: 'PAUSED',
      } };
    }
    const adSetId = this.dependencyId(operation, ids, 'ad_set');
    const creativeInternalId = this.string(config.creativeInternalObjectId, 'ad.creativeInternalObjectId');
    const creativeId = ids[creativeInternalId];
    if (!creativeId) throw new Error('CREATIVE_DEPENDENCY_MISSING');
    return { edge: 'ads', params: {
      name: `Contexto Ads ad [CTX-${suffix}]`, adset_id: adSetId,
      creative: { creative_id: creativeId }, status: 'PAUSED',
    } };
  }

  private dependencyId(operation: ExecutionManifestOperationV1, ids: ExternalIds, objectType: 'campaign' | 'ad_set') {
    const entry = Object.entries(ids).find(([internalId]) =>
      operation.dependsOnOperationKeys.length > 0 && internalId.endsWith(`:${objectType}`));
    if (!entry) throw new Error(`${objectType.toUpperCase()}_DEPENDENCY_MISSING`);
    return entry[1];
  }

  private selected(bindings: Awaited<ReturnType<MetaConnectionRepository['listBindings']>>, type: 'facebook_page' | 'whatsapp') {
    const selected = bindings.filter((item) => item.assetType === type && item.selected);
    return selected.length === 1 ? selected[0].externalId : undefined;
  }

  private paused(configured?: string, effective?: string) {
    if (configured) return configured === 'PAUSED';
    return ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'].includes(effective ?? '');
  }

  private eventState(protocol: MetaWriteValidationProtocolV1, actor: string, eventType: string): any {
    return {
      auditEventId: crypto.randomUUID(), tenantId: protocol.tenantId,
      correlationId: protocol.correlationId, actorType: 'user', actorId: actor,
      eventType, objectType: 'meta_write_validation_protocol',
      objectId: protocol.metaWriteValidationProtocolId,
      newState: { status: protocol.status, externalWritesPerformed: protocol.boundaries.externalWritesPerformed },
      result: eventType.includes('failed') ? 'blocked' : 'success',
      createdAt: new Date().toISOString(),
    };
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private actor(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 2 || value.length > 200) throw new BadRequestException('actor is invalid');
    return value.trim();
  }

  private record(value: unknown, field: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
    return value as Record<string, any>;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field.toUpperCase()}_MISSING`);
    return value.trim();
  }

  private httpsUrl(value: unknown, field: string): string {
    const result = this.string(value, field);
    const url = new URL(result);
    if (url.protocol !== 'https:') throw new Error(`${field.toUpperCase()}_HTTPS_REQUIRED`);
    return url.toString();
  }

  private integer(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${field.toUpperCase()}_INVALID`);
    return value as number;
  }
}
