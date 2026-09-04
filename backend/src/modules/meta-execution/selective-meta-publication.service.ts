import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaWriteAdapter } from '../meta-adapter/meta-write.adapter';

@Injectable()
export class SelectiveMetaPublicationService {
  constructor(
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
    @Inject(EXECUTION_PLAN_REPOSITORY)
    private readonly plans: ExecutionPlanRepository,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections: MetaConnectionRepository,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly protocols: MetaWriteValidationProtocolRepository,
    private readonly killSwitch: KillSwitchService,
    private readonly adapter: MetaWriteAdapter,
  ) {}

  async publishSelected(
    tenantIdValue: unknown,
    executionPlanIdValue: unknown,
    actorValue: unknown,
    activeAdIdsValue: unknown,
    pausedAdIdsValue: unknown,
  ) {
    const tenantId = this.uuid(tenantIdValue, 'tenantId');
    const executionPlanId = this.uuid(executionPlanIdValue, 'executionPlanId');
    const actor = this.actor(actorValue);
    const activeAdIds = this.metaIds(activeAdIdsValue, 'active_ad_ids', 1, 20);
    const pausedAdIds = this.metaIds(pausedAdIdsValue, 'paused_ad_ids', 0, 20);
    if (activeAdIds.some((id) => pausedAdIds.includes(id))) {
      throw new BadRequestException({
        code: 'selective_ad_state_overlap',
        message: 'O mesmo anúncio não pode estar nas listas ACTIVE e PAUSED.',
      });
    }
    if (!this.adapter.enabled()) {
      throw new ConflictException({
        code: 'meta_write_adapter_disabled',
        message: 'O executor real da Meta não está habilitado.',
      });
    }

    const plan = await this.plans.findById(tenantId, executionPlanId);
    if (!plan) throw new NotFoundException('Execution plan not found');
    const latestPlan = await this.plans.latest(tenantId, plan.campaignId);
    if (!latestPlan || latestPlan.executionPlanId !== executionPlanId
      || latestPlan.planHash !== plan.planHash) {
      throw new ConflictException({
        code: 'selective_publication_stale_plan',
        message: 'Somente o plano atual pode ser publicado seletivamente.',
      });
    }
    const manifest = await this.manifests.latestForPlan(tenantId, executionPlanId);
    if (!manifest || manifest.planHash !== plan.planHash) {
      throw new ConflictException({
        code: 'selective_publication_manifest_missing',
        message: 'O manifesto atual da campanha não está disponível.',
      });
    }
    const protocol = await this.protocols.latestForManifest(
      tenantId, manifest.executionManifestId,
    );
    if (!protocol || protocol.status !== 'external_validation_succeeded') {
      throw new ConflictException({
        code: 'selective_publication_paused_validation_required',
        message: 'A validação real em PAUSED deve estar concluída antes da publicação seletiva.',
      });
    }
    const switches = await this.killSwitch.effective(tenantId, plan.campaignId);
    if (switches.tenant.status !== 'released' || switches.campaign.status !== 'released') {
      throw new ConflictException({
        code: 'selective_publication_kill_switch_closed',
        message: 'As travas de segurança não estão liberadas.',
      });
    }
    const connectionId = plan.meta.connectionId;
    if (!connectionId) throw new ConflictException('Conexão Meta ausente.');
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection?.credentialRef || !['connected', 'ready'].includes(connection.status)) {
      throw new ConflictException('Credencial Meta ausente ou conexão não pronta.');
    }

    const lifecycle = [
      ...(protocol.reconciledOperations ?? []),
      ...(protocol.execution?.operations ?? []),
    ]
      .filter((item) => item.externalObjectId
        && ['campaign', 'ad_set', 'ad'].includes(item.objectType))
      .map((item) => ({ objectType: item.objectType, id: item.externalObjectId! }))
      .filter((item, index, items) => items.findIndex((candidate) =>
        candidate.objectType === item.objectType && candidate.id === item.id) === index);

    const campaign = lifecycle.find((item) => item.objectType === 'campaign');
    const adSet = lifecycle.find((item) => item.objectType === 'ad_set');
    const validatedAdIds = lifecycle
      .filter((item) => item.objectType === 'ad')
      .map((item) => item.id)
      .sort();
    if (!campaign || !adSet || validatedAdIds.length === 0) {
      throw new ConflictException({
        code: 'selective_publication_objects_incomplete',
        message: 'Os objetos validados na Meta estão incompletos.',
      });
    }
    const requestedAdIds = [...activeAdIds, ...pausedAdIds].sort();
    if (requestedAdIds.length !== validatedAdIds.length
      || requestedAdIds.some((id, index) => id !== validatedAdIds[index])) {
      throw new ConflictException({
        code: 'selective_publication_ad_scope_mismatch',
        message: 'A seleção deve declarar o estado final de todos os anúncios validados desta campanha.',
        validated_ad_ids: validatedAdIds,
      });
    }

    const changed: Array<{ id: string; target: 'ACTIVE' | 'PAUSED' }> = [];
    try {
      // Fail-safe ordering: excluded ads are confirmed PAUSED before campaign delivery is re-opened.
      for (const id of pausedAdIds) {
        await this.ensureStatus(tenantId, connection.credentialRef, id, 'PAUSED');
        changed.push({ id, target: 'PAUSED' });
      }
      await this.ensureStatus(tenantId, connection.credentialRef, campaign.id, 'ACTIVE');
      changed.push({ id: campaign.id, target: 'ACTIVE' });
      await this.ensureStatus(tenantId, connection.credentialRef, adSet.id, 'ACTIVE');
      changed.push({ id: adSet.id, target: 'ACTIVE' });
      for (const id of activeAdIds) {
        await this.ensureStatus(tenantId, connection.credentialRef, id, 'ACTIVE');
        changed.push({ id, target: 'ACTIVE' });
      }

      const finalObjects = [
        { object_type: 'campaign', id: campaign.id, expected_status: 'ACTIVE' as const },
        { object_type: 'ad_set', id: adSet.id, expected_status: 'ACTIVE' as const },
        ...activeAdIds.map((id) => ({ object_type: 'ad', id, expected_status: 'ACTIVE' as const })),
        ...pausedAdIds.map((id) => ({ object_type: 'ad', id, expected_status: 'PAUSED' as const })),
      ];
      const observed = [];
      for (const object of finalObjects) {
        const read = await this.adapter.read(
          tenantId, connection.credentialRef, object.id, true,
        );
        if (!read.success || read.data?.configuredStatus !== object.expected_status) {
          throw new Error('SELECTIVE_PUBLICATION_VERIFICATION_FAILED');
        }
        observed.push({
          object_type: object.object_type,
          external_object_id: object.id,
          configured_status: read.data.configuredStatus,
          effective_status: read.data.effectiveStatus ?? null,
        });
      }
      return {
        status: 'SELECTIVE_PUBLICATION_ACTIVE',
        campaign_id: campaign.id,
        ad_set_id: adSet.id,
        active_ad_ids: activeAdIds,
        paused_ad_ids: pausedAdIds,
        observed_objects: observed,
        campaign_active: true,
        delivery_authorized: true,
        spend_authorized: true,
        budget_change_authorized: false,
      };
    } catch (error) {
      // Safe rollback: prevent any ad delivery if selective activation cannot be proven exactly.
      for (const id of validatedAdIds) {
        await this.adapter.updateStatus(
          tenantId, connection.credentialRef, id, 'PAUSED',
        ).catch(() => undefined);
      }
      await this.adapter.updateStatus(
        tenantId, connection.credentialRef, adSet.id, 'PAUSED',
      ).catch(() => undefined);
      await this.adapter.updateStatus(
        tenantId, connection.credentialRef, campaign.id, 'PAUSED',
      ).catch(() => undefined);
      await this.killSwitch.changeCampaign(
        tenantId,
        plan.campaignId,
        'engaged',
        actor,
        'Falha na publicação seletiva; rollback completo para PAUSED executado automaticamente.',
      );
      throw new ConflictException({
        code: 'selective_publication_failed',
        message: 'A ativação seletiva não foi comprovada e a campanha foi devolvida ao estado PAUSED.',
        attempted_changes: changed,
        normalized_error: error instanceof Error ? error.message : 'UNKNOWN',
      });
    }
  }

  private async ensureStatus(
    tenantId: string,
    credentialRef: string,
    id: string,
    target: 'ACTIVE' | 'PAUSED',
  ) {
    const current = await this.adapter.read(tenantId, credentialRef, id, true);
    if (current.success && current.data?.configuredStatus === target) return;
    const updated = await this.adapter.updateStatus(tenantId, credentialRef, id, target);
    if (!updated.success || updated.data?.configuredStatus !== target) {
      throw new Error(`STATUS_${target}_FAILED:${id}`);
    }
  }

  private metaIds(value: unknown, field: string, min: number, max: number): string[] {
    if (!Array.isArray(value) || value.length < min || value.length > max
      || value.some((item) => typeof item !== 'string' || !/^\d{8,30}$/.test(item))) {
      throw new BadRequestException(`${field} must contain valid Meta object IDs`);
    }
    const unique = [...new Set(value as string[])];
    if (unique.length !== value.length) throw new BadRequestException(`${field} contains duplicates`);
    return unique;
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private actor(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 200) {
      throw new BadRequestException('actor must have between 2 and 200 characters');
    }
    return value.trim();
  }
}
