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
  MetaWriteValidationEvidenceKey,
  MetaWriteValidationProtocolV1,
} from '../../domain/contracts/meta-write-validation';
import {
  ExecutionManifestRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import {
  EXECUTION_MANIFEST_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
} from '../../infrastructure/database/database.tokens';

const REQUIRED_EVIDENCE: MetaWriteValidationEvidenceKey[] = [
  'meta_app_identity',
  'graph_api_version',
  'oauth_subject',
  'ad_account_binding',
  'ads_management_permission',
  'request_fingerprints',
  'sanitized_meta_responses',
  'external_object_ids',
  'observed_paused_state',
  'reconciliation_completed',
  'zero_delivery_confirmed',
];

@Injectable()
export class MetaWriteValidationService {
  constructor(
    @Inject(EXECUTION_MANIFEST_REPOSITORY)
    private readonly manifests: ExecutionManifestRepository,
    @Inject(META_WRITE_VALIDATION_PROTOCOL_REPOSITORY)
    private readonly protocols: MetaWriteValidationProtocolRepository,
  ) {}

  async prepare(
    tenantId: unknown,
    executionManifestId: unknown,
    preparedBy: unknown,
  ): Promise<MetaWriteValidationProtocolV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionManifestId, 'executionManifestId');
    const actor = this.assertActor(preparedBy);
    const manifest = await this.manifests.findById(tenantId, executionManifestId);
    if (!manifest) throw new NotFoundException('Execution manifest not found');
    const latest = await this.manifests.latestForPlan(tenantId, manifest.executionPlanId);
    if (!latest || latest.executionManifestId !== manifest.executionManifestId
      || latest.manifestHash !== manifest.manifestHash) {
      throw new ConflictException('Only the latest execution manifest can be validated');
    }

    const operations = manifest.operations.map((operation) => ({
      order: operation.order,
      operationKey: operation.operationKey,
      objectType: operation.objectType,
      action: operation.action,
      requestFingerprint: operation.requestFingerprint,
      intendedLifecycleStatus: operation.intendedLifecycleStatus,
    }));
    const allowedActions = [...new Set(operations.map((operation) => operation.action))];
    const limits: MetaWriteValidationProtocolV1['limits'] = {
      exactOperationCount: operations.length,
      allowedActions,
      requiredLifecycleStatus: 'PAUSED',
      activationAllowed: false,
      deliveryAllowed: false,
      budgetIncreaseAllowed: false,
      automaticRetryAllowed: false,
      concurrentAttemptAllowed: false,
    };
    const requiredEvidence: MetaWriteValidationProtocolV1['requiredEvidence'] =
      REQUIRED_EVIDENCE.map((key) => ({
        key,
        status: 'required_not_collected',
        source: 'real_meta_environment',
        evidenceRefs: [],
      }));
    const failurePolicy: MetaWriteValidationProtocolV1['failurePolicy'] = {
      ambiguousOutcome: 'stop_and_reconcile_before_retry',
      partialFailure: 'stop_dependents_and_preserve_evidence',
      unexpectedActiveState: 'engage_kill_switch_and_stop',
      evidenceMissing: 'validation_fails_closed',
    };
    const successCriteria: MetaWriteValidationProtocolV1['successCriteria'] = {
      allOperationsCreatedExactlyOnce: true,
      allObjectsObservedPaused: true,
      noDeliveryObserved: true,
      reconciliationCompleted: true,
      sanitizedEvidenceComplete: true,
    };
    const boundaries: MetaWriteValidationProtocolV1['boundaries'] = {
      protocolIsExecutionCommand: false,
      executionRecordCreated: false,
      externalAttemptStarted: false,
      realMetaWriteValidated: false,
      writeAdapterEnabled: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    };
    const semantic = {
      purpose: 'meta_write_validation_protocol_v1',
      tenantId,
      campaignId: manifest.campaignId,
      executionPlanId: manifest.executionPlanId,
      executionManifestId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      mode: 'controlled_paused_creation',
      operations,
      limits,
      requiredEvidence,
      failurePolicy,
      successCriteria,
      boundaries,
    };
    const preparedAt = new Date().toISOString();
    const correlationId = randomUUID();
    const protocol: MetaWriteValidationProtocolV1 = {
      metaWriteValidationProtocolId: randomUUID(),
      tenantId,
      campaignId: manifest.campaignId,
      executionPlanId: manifest.executionPlanId,
      executionManifestId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      protocolHash: this.hash(semantic),
      version: 1,
      mode: 'controlled_paused_creation',
      status: 'prepared_external_validation_required',
      preparedBy: actor,
      operations,
      limits,
      requiredEvidence,
      failurePolicy,
      successCriteria,
      boundaries,
      correlationId,
      preparedAt,
    };
    return this.protocols.saveIdempotent(
      protocol,
      this.event(protocol, actor),
    );
  }

  async latest(
    tenantId: unknown,
    executionManifestId: unknown,
  ): Promise<MetaWriteValidationProtocolV1> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(executionManifestId, 'executionManifestId');
    const manifest = await this.manifests.findById(tenantId, executionManifestId);
    if (!manifest) throw new NotFoundException('Execution manifest not found');
    const protocol = await this.protocols.latestForManifest(tenantId, executionManifestId);
    if (!protocol) throw new NotFoundException('Meta write validation protocol not found');
    return protocol;
  }

  private event(
    protocol: MetaWriteValidationProtocolV1,
    actorId: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId: protocol.tenantId,
      correlationId: protocol.correlationId,
      actorType: 'user',
      actorId,
      eventType: 'meta_write_validation_protocol_prepared',
      objectType: 'meta_write_validation_protocol',
      objectId: protocol.metaWriteValidationProtocolId,
      newState: {
        status: protocol.status,
        protocolHash: protocol.protocolHash,
        exactOperationCount: protocol.limits.exactOperationCount,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      result: 'success',
      createdAt: protocol.preparedAt,
    };
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertActor(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 2
      || value.trim().length > 200) {
      throw new BadRequestException('preparedBy must have between 2 and 200 characters');
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
