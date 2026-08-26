import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionManifestOperationV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
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
import { ExecutionAuthorizationService } from '../execution-authorization/execution-authorization.service';
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaWriteAdapter } from '../meta-adapter/meta-write.adapter';

type ExternalIds = Record<string, string>;

@Injectable()
export class MetaExecutionService {
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
      executionAuthorizationIdValue, 'executionAuthorizationId',
    );
    const actor = this.actor(actorValue);
    if (!this.adapter.enabled()) {
      throw new ConflictException({ code: 'meta_write_adapter_disabled',
        message: 'The Meta write adapter is disabled' });
    }
    const authorization = await this.authorizations.get(
      tenantId, executionAuthorizationId,
    );
    if (authorization.status !== 'approved') {
      throw new ConflictException({ code: 'execution_authorization_not_approved',
        message: `Authorization status is ${authorization.status}` });
    }
    const manifest = await this.manifests.findById(
      tenantId, authorization.executionManifestId,
    );
    if (!manifest || manifest.manifestHash !== authorization.manifestHash) {
      throw new ConflictException('The authorized manifest is not current');
    }
    const latestManifest = await this.manifests.latestForPlan(
      tenantId, manifest.executionPlanId,
    );
    if (!latestManifest || latestManifest.executionManifestId !== manifest.executionManifestId
      || latestManifest.manifestHash !== manifest.manifestHash) {
      throw new ConflictException('Only the latest manifest can be executed');
    }
    const switches = await this.killSwitch.effective(tenantId, manifest.campaignId);
    if (!switches.tenant.known || switches.tenant.status !== 'released'
      || !switches.campaign.known || switches.campaign.status !== 'released') {
      throw new ConflictException({ code: 'kill_switch_closed',
        message: 'Both kill switches must be explicitly released' });
    }
    const [plan, prepared] = await Promise.all([
      this.plans.findById(tenantId, manifest.executionPlanId),
      this.protocols.latestForManifest(tenantId, manifest.executionManifestId),
    ]);
    if (!plan || plan.planHash !== manifest.planHash) {
      throw new ConflictException('Execution plan is missing or stale');
    }
    if (!prepared || prepared.protocolHash.length !== 64) {
      throw new ConflictException('The real Meta validation protocol is missing');
    }
    if (prepared.status === 'external_validation_succeeded') return prepared;
    if (prepared.status !== 'prepared_external_validation_required') {
      throw new ConflictException({ code: 'meta_execution_already_started',
        message: `Protocol status is ${prepared.status}` });
    }
    const connectionId = plan.meta.connectionId;
    const adAccountId = plan.meta.adAccountId;
    if (!connectionId || !adAccountId || !/^act_\d+$/.test(adAccountId)) {
      throw new ConflictException('A valid Meta execution target is required');
    }
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection?.credentialRef || !['connected', 'ready'].includes(connection.status)) {
      throw new ConflictException('The Meta connection is not ready');
    }
    const bindings = await this.connections.listBindings(tenantId, connectionId);
    const pageId = this.selected(bindings, 'facebook_page');
    const whatsappId = this.selected(bindings, 'whatsapp');
    if (!pageId || !whatsappId) {
      throw new ConflictException('Selected Page and WhatsApp assets are required');
    }

    const startedAt = new Date().toISOString();
    const running: MetaWriteValidationProtocolV1 = {
      ...prepared,
      status: 'external_validation_running',
      boundaries: {
        protocolIsExecutionCommand: true,
        executionRecordCreated: true,
        externalAttemptStarted: true,
        realMetaWriteValidated: false,
        writeAdapterEnabled: true,
        externalWritesAllowed: true,
        externalWritesPerformed: false,
      },
      execution: {
        executionAuthorizationId,
        startedAt,
        operations: manifest.operations.map((operation) => ({
          operationKey: operation.operationKey,
          objectType: operation.objectType,
          status: 'pending',
        })),
      },
    };
    const begun = await this.protocols.beginExecution(
      running,
      this.event(running, actor, 'meta_write_execution_started', 'info', {
        executionAuthorizationId,
        operationCount: manifest.operations.length,
      }),
    );
    if (!begun) throw new ConflictException('Meta execution already started');
    let state: MetaWriteValidationProtocolV1 = begun;

    const ids: ExternalIds = {};
    try {
      const configs = new Map(plan.objectsToCreate.map((item) => [
        item.internalObjectId, item.logicalConfig,
      ]));
      const cityKeys = await this.cityKeys(
        tenantId, connection.credentialRef, plan,
      );
      for (const operation of [...manifest.operations].sort((a, b) => a.order - b.order)) {
        const config = configs.get(operation.internalObjectId);
        if (!config) throw new Error('MANIFEST_CONFIG_MISSING');
        const request = this.requestFor(
          operation, config, plan, ids, pageId, whatsappId, cityKeys,
        );
        const result = await this.adapter.create(
          tenantId, connection.credentialRef, `/${adAccountId}/${request.edge}`,
          request.params,
        );
        const operationState = state.execution?.operations.find(
          (item) => item.operationKey === operation.operationKey,
        );
        if (!operationState || !result.success || !result.data) {
          if (operationState) {
            operationState.status = result.retryable ? 'uncertain' : 'failed';
            operationState.normalizedError = result.normalizedError ?? 'UNKNOWN';
          }
          throw new Error(result.normalizedError ?? 'UNKNOWN');
        }
        ids[operation.internalObjectId] = result.data.id;
        const observed = await this.adapter.read(
          tenantId, connection.credentialRef, result.data.id,
          operation.objectType !== 'creative',
        );
        if (!observed.success || !observed.data) {
          operationState.status = observed.retryable ? 'uncertain' : 'failed';
          operationState.externalObjectId = result.data.id;
          operationState.normalizedError = observed.normalizedError ?? 'UNKNOWN';
          throw new Error(observed.normalizedError ?? 'UNKNOWN');
        }
        if (operation.objectType !== 'creative'
          && !this.paused(observed.data.configuredStatus, observed.data.effectiveStatus)) {
          operationState.status = 'failed';
          operationState.externalObjectId = result.data.id;
          operationState.observedStatus = observed.data.effectiveStatus
            ?? observed.data.configuredStatus ?? 'UNKNOWN';
          await this.killSwitch.changeCampaign(
            tenantId, manifest.campaignId, 'engaged', actor,
            'Objeto externo observado fora do estado pausado esperado.',
          );
          throw new Error('UNEXPECTED_ACTIVE_STATE');
        }
        operationState.status = 'succeeded';
        operationState.externalObjectId = result.data.id;
        operationState.observedStatus = operation.objectType === 'creative'
          ? 'CREATED_NO_DELIVERY_STATE'
          : observed.data.effectiveStatus ?? observed.data.configuredStatus ?? 'PAUSED';
        operationState.sanitizedResponseRef = this.hash({
          operationKey: operation.operationKey,
          externalObjectId: result.data.id,
          observedAt: observed.observedAt,
        });
        state.boundaries.externalWritesPerformed = true;
        state = await this.protocols.updateExecution(
          state,
          this.event(state, undefined, 'meta_write_operation_succeeded', 'success', {
            operationKey: operation.operationKey,
            objectType: operation.objectType,
            externalObjectId: result.data.id,
            observedStatus: operationState.observedStatus,
          }),
        );
      }
      const completedAt = new Date().toISOString();
      const protocolId = state.metaWriteValidationProtocolId;
      state = {
        ...state,
        status: 'external_validation_succeeded',
        requiredEvidence: state.requiredEvidence.map((item) => ({
          ...item,
          status: 'collected',
          evidenceRefs: [`meta_execution:${protocolId}:${item.key}`],
        })),
        boundaries: {
          ...state.boundaries,
          realMetaWriteValidated: true,
          externalWritesAllowed: false,
        },
        execution: state.execution ? { ...state.execution, completedAt } : undefined,
      };
      return this.protocols.updateExecution(
        state,
        this.event(state, actor, 'meta_write_validation_succeeded', 'success', {
          externalObjectCount: Object.keys(ids).length,
          allObjectsPaused: true,
          zeroDeliveryConfirmed: true,
        }),
      );
    } catch (error) {
      const protocolId = state.metaWriteValidationProtocolId;
      const failed: MetaWriteValidationProtocolV1 = {
        ...state,
        status: 'external_validation_failed',
        requiredEvidence: state.requiredEvidence.map((item) => item.key === 'sanitized_meta_responses'
          ? { ...item, status: 'collected', evidenceRefs: [
            `meta_execution_failure:${protocolId}`,
          ] } : item),
        boundaries: { ...state.boundaries, externalWritesAllowed: false },
        execution: state.execution ? {
          ...state.execution,
          completedAt: new Date().toISOString(),
        } : undefined,
      };
      await this.killSwitch.changeCampaign(
        tenantId, manifest.campaignId, 'engaged', actor,
        'Execução Meta interrompida; dependências bloqueadas para reconciliação.',
      );
      return this.protocols.updateExecution(
        failed,
        this.event(failed, actor, 'meta_write_validation_failed', 'blocked', {
          normalizedError: error instanceof Error ? error.message : 'UNKNOWN',
          externalWritesPerformed: failed.boundaries.externalWritesPerformed,
        }),
      );
    }
  }

  private async cityKeys(
    tenantId: string,
    credentialRef: string,
    plan: ExecutionPlanV1,
  ): Promise<Array<{ key: string; radius: number; distance_unit: 'kilometer' }>> {
    const adSet = plan.objectsToCreate.find((item) => item.type === 'ad_set');
    const geography = adSet?.logicalConfig.geography;
    if (typeof geography !== 'string') throw new Error('GEOGRAPHY_MISSING');
    const cities = geography.split(/\s+e\s+|[,;]/i)
      .map((item) => item.trim().replace(/[-/]\s*[A-Z]{2}$/i, '').trim())
      .filter(Boolean);
    if (cities.length < 1 || cities.length > 20) throw new Error('GEOGRAPHY_INVALID');
    const radius = Number(this.config.get<string>('META_CITY_RADIUS_KM') ?? '40');
    if (!Number.isInteger(radius) || radius < 1 || radius > 80) {
      throw new Error('GEOGRAPHY_RADIUS_INVALID');
    }
    const results = [];
    for (const city of cities) {
      const result = await this.adapter.searchCity(
        tenantId, credentialRef, city, 'BR',
      );
      if (!result.success || !result.data) throw new Error('GEOGRAPHY_LOOKUP_FAILED');
      results.push({ key: result.data.key, radius, distance_unit: 'kilometer' as const });
    }
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
  ): { edge: 'campaigns' | 'adsets' | 'adcreatives' | 'ads'; params: Record<string, string | number | boolean | object | unknown[]> } {
    const suffix = operation.idempotencyKey.slice(0, 10);
    if (operation.objectType === 'campaign') {
      return { edge: 'campaigns', params: {
        name: `${this.string(config.name, 'campaign.name')} [CTX-${suffix}]`,
        objective: this.string(config.objective, 'campaign.objective'),
        status: 'PAUSED',
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false,
      } };
    }
    if (operation.objectType === 'creative') {
      const copy = this.record(config.copy, 'creative.copy');
      const asset = this.record(config.asset, 'creative.asset');
      const publicBase = this.config.get<string>('CONTEXT_ADS_PUBLIC_BASE_URL')?.trim()
        || 'https://contexto-ads-validation-panel.onrender.com';
      const storageRef = this.string(asset.storageRef, 'creative.storageRef');
      const picture = /^https:\/\//.test(storageRef)
        ? storageRef
        : new URL(storageRef.replace(/^\//, ''), `${publicBase.replace(/\/$/, '')}/`).toString();
      return { edge: 'adcreatives', params: {
        name: `Contexto Ads creative [CTX-${suffix}]`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link: 'https://api.whatsapp.com/send',
            picture,
            message: this.string(copy.primaryText, 'creative.primaryText'),
            name: this.string(copy.headline, 'creative.headline'),
            ...(typeof copy.description === 'string' ? { description: copy.description } : {}),
            call_to_action: {
              type: 'WHATSAPP_MESSAGE',
              value: { app_destination: 'WHATSAPP' },
            },
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
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'CONVERSATIONS',
        destination_type: 'WHATSAPP',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        daily_budget: this.integer(budget.amountMinor, 'ad_set.budget.amountMinor'),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        promoted_object: { page_id: pageId },
        targeting: {
          geo_locations: { cities: cityKeys },
          publisher_platforms: ['facebook', 'instagram'],
        },
        status: 'PAUSED',
      } };
    }
    const adSetId = this.dependencyId(operation, ids, 'ad_set');
    const creativeInternalId = this.string(
      config.creativeInternalObjectId, 'ad.creativeInternalObjectId',
    );
    const creativeId = ids[creativeInternalId];
    if (!creativeId) throw new Error('CREATIVE_DEPENDENCY_MISSING');
    return { edge: 'ads', params: {
      name: `Contexto Ads ad [CTX-${suffix}]`,
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
    } };
  }

  private dependencyId(
    operation: ExecutionManifestOperationV1,
    ids: ExternalIds,
    objectType: 'campaign' | 'ad_set',
  ): string {
    const entry = Object.entries(ids).find(([internalId]) =>
      operation.dependsOnOperationKeys.length > 0
      && internalId.endsWith(`:${objectType}`));
    if (!entry) throw new Error(`${objectType.toUpperCase()}_DEPENDENCY_MISSING`);
    return entry[1];
  }

  private selected(
    bindings: Awaited<ReturnType<MetaConnectionRepository['listBindings']>>,
    type: 'facebook_page' | 'whatsapp',
  ): string | undefined {
    const selected = bindings.filter((item) => item.assetType === type && item.selected);
    if (selected.length !== 1) return undefined;
    return selected[0].externalId;
  }

  private paused(configured?: string, effective?: string): boolean {
    const values = [configured, effective].filter(Boolean);
    return values.length > 0 && values.every((value) =>
      value === 'PAUSED' || value === 'CAMPAIGN_PAUSED' || value === 'ADSET_PAUSED');
  }

  private event(
    protocol: MetaWriteValidationProtocolV1,
    actorId: string | undefined,
    eventType: string,
    result: AuditEvent['result'],
    newState: unknown,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(), tenantId: protocol.tenantId,
      correlationId: protocol.correlationId,
      actorType: actorId ? 'user' : 'system',
      ...(actorId ? { actorId } : {}),
      eventType, objectType: 'meta_write_validation_protocol',
      objectId: protocol.metaWriteValidationProtocolId,
      newState, result, createdAt: new Date().toISOString(),
    };
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private actor(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 2 || value.length > 200) {
      throw new BadRequestException('actor must have between 2 and 200 characters');
    }
    return value.trim();
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field.toUpperCase()}_MISSING`);
    return value.trim();
  }

  private integer(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new Error(`${field.toUpperCase()}_INVALID`);
    }
    return value as number;
  }

  private record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${field.toUpperCase()}_INVALID`);
    }
    return value as Record<string, unknown>;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
