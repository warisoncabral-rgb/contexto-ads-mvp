import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightCheckV1,
  ExecutionPreflightV1,
} from '../../domain/contracts/execution-authorization';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import {
  ExecutionAuthorizationRepository,
  ExecutionManifestRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_AUTHORIZATION_REPOSITORY,
  EXECUTION_MANIFEST_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { KillSwitchService } from '../kill-switch/kill-switch.service';

const AUTHORIZATION_VALIDITY_MS = 15 * 60 * 1000;

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
        `operations:${manifest.operations.length}`,
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
        key: 'real_meta_write_validation', status: 'blocked',
        evidenceRefs: validationProtocol
          ? [`meta_write_validation_protocol:${validationProtocol.metaWriteValidationProtocolId}`]
          : [],
        meaning: validationProtocol
          ? 'O protocolo está preparado, mas as evidências do ambiente Meta real ainda não foram coletadas.'
          : 'O protocolo e a validação da escrita controlada em ambiente Meta real ainda estão ausentes.',
      },
      {
        key: 'write_adapter_enabled', status: 'blocked', evidenceRefs: [],
        meaning: 'Não existe adapter de escrita habilitado.',
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
      nextAction: this.nextAction(blockers[0]),
      boundaries,
      generatedAt,
    };
    return this.authorizations.savePreflightIdempotent(
      preflight,
      this.event(authorization, undefined, 'execution_preflight_blocked', {
        status: preflight.status,
        blockers,
        executionRecordCreated: false,
      }, 'blocked', generatedAt, preflight.executionPreflightId, 'execution_preflight'),
    );
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
      real_meta_write_validation: 'Validar criação pausada em ambiente Meta controlado.',
      write_adapter_enabled: 'Habilitar o adapter somente após os demais gates.',
    };
    return blocker ? actions[blocker] : 'Nenhuma ação externa foi autorizada.';
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
