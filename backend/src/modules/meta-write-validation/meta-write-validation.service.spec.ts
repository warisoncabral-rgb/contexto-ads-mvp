import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import {
  ExecutionManifestRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import { MetaWriteValidationService } from './meta-write-validation.service';

describe('MetaWriteValidationService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const manifestId = '22222222-2222-4222-8222-222222222222';
  const manifest: ExecutionManifestV1 = {
    executionManifestId: manifestId,
    tenantId,
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    readinessDecisionId: '55555555-5555-4555-8555-555555555555',
    simulationId: '66666666-6666-4666-8666-666666666666',
    planHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    status: 'prepared_gate_closed',
    operations: [{
      order: 1,
      operationKey: 'operation:campaign',
      idempotencyKey: 'c'.repeat(64),
      requestFingerprint: 'd'.repeat(64),
      internalObjectId: 'campaign:1',
      objectType: 'campaign',
      action: 'create_campaign',
      dependsOnOperationKeys: [],
      intendedLifecycleStatus: 'PAUSED',
      effectState: 'not_started',
      executionAllowed: false,
      preconditions: [],
      recovery: {
        ambiguousOutcome: 'block_and_reconcile_before_retry',
        partialFailure: 'stop_dependents_and_preserve_evidence',
        compensation: 'manual_policy_required_before_any_external_change',
      },
    }],
    executionGate: {
      status: 'closed',
      reason: 'write_path_not_validated_or_enabled',
      requirements: [],
    },
    reconciliationPolicy: {
      sourceOfTruth: 'meta_observed_state_with_internal_execution_record',
      unknownOutcome: 'stop_and_reconcile',
      retry: 'forbidden_until_previous_outcome_is_known',
      successEvidenceRequired: ['external_object_id', 'meta_response', 'observed_state'],
      automaticCorrection: 'only_when_safe_and_explicitly_authorized',
    },
    boundaries: {
      executable: false,
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    generatedAt: '2026-08-24T15:00:00.000Z',
  };
  let manifests: jest.Mocked<ExecutionManifestRepository>;
  let protocols: jest.Mocked<MetaWriteValidationProtocolRepository>;
  let service: MetaWriteValidationService;

  beforeEach(() => {
    manifests = {
      saveIdempotent: jest.fn(),
      findById: jest.fn().mockResolvedValue(manifest),
      latestForPlan: jest.fn().mockResolvedValue(manifest),
    };
    protocols = {
      saveIdempotent: jest.fn(async (
        protocol: MetaWriteValidationProtocolV1,
        _event: AuditEvent,
      ) => protocol),
      latestForManifest: jest.fn(),
      beginExecution: jest.fn(),
      updateExecution: jest.fn(),
    };
    service = new MetaWriteValidationService(manifests, protocols);
  });

  it('prepares exact paused-only limits without enabling execution', async () => {
    const result = await service.prepare(tenantId, manifestId, 'operator-1');

    expect(result.status).toBe('prepared_external_validation_required');
    expect(result.attempt).toBe(1);
    expect(result.limits).toEqual({
      exactOperationCount: 1,
      allowedActions: ['create_campaign'],
      requiredLifecycleStatus: 'PAUSED',
      activationAllowed: false,
      deliveryAllowed: false,
      budgetIncreaseAllowed: false,
      automaticRetryAllowed: false,
      concurrentAttemptAllowed: false,
    });
    expect(result.requiredEvidence.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'ads_management_permission',
        'external_object_ids',
        'observed_paused_state',
        'zero_delivery_confirmed',
      ]),
    );
    expect(result.requiredEvidence.every((item) =>
      item.status === 'required_not_collected' && item.evidenceRefs.length === 0,
    )).toBe(true);
    expect(result.boundaries).toEqual(expect.objectContaining({
      protocolIsExecutionCommand: false,
      externalAttemptStarted: false,
      realMetaWriteValidated: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    }));
  });

  it('produces a deterministic semantic hash for the same manifest', async () => {
    const first = await service.prepare(tenantId, manifestId, 'operator-1');
    const second = await service.prepare(tenantId, manifestId, 'operator-2');
    expect(second.protocolHash).toBe(first.protocolHash);
  });

  it('rejects stale manifests before preparing a protocol', async () => {
    manifests.latestForPlan.mockResolvedValue({
      ...manifest,
      executionManifestId: '77777777-7777-4777-8777-777777777777',
    });
    await expect(service.prepare(tenantId, manifestId, 'operator-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(protocols.saveIdempotent).not.toHaveBeenCalled();
  });

  it('prepares a new manual attempt only after a zero-write failure', async () => {
    const previous = await service.prepare(tenantId, manifestId, 'operator-1');
    protocols.latestForManifest.mockResolvedValueOnce({
      ...previous,
      status: 'external_validation_failed',
      boundaries: { ...previous.boundaries, externalAttemptStarted: true },
      execution: {
        executionAuthorizationId: '77777777-7777-4777-8777-777777777777',
        startedAt: '2026-08-24T15:10:00.000Z',
        completedAt: '2026-08-24T15:10:01.000Z',
        operations: [{
          operationKey: 'operation:campaign',
          objectType: 'campaign',
          status: 'failed',
          normalizedError: 'VALIDATION',
        }],
      },
    });

    const retried = await service.prepare(tenantId, manifestId, 'operator-2');

    expect(retried.attempt).toBe(2);
    expect(retried.replacesProtocolId).toBe(previous.metaWriteValidationProtocolId);
    expect(retried.protocolHash).not.toBe(previous.protocolHash);
    expect(retried.boundaries.externalAttemptStarted).toBe(false);
  });

  it('blocks a new protocol while any external object needs reconciliation', async () => {
    const previous = await service.prepare(tenantId, manifestId, 'operator-1');
    protocols.latestForManifest.mockResolvedValueOnce({
      ...previous,
      status: 'external_validation_failed',
      boundaries: { ...previous.boundaries, externalWritesPerformed: true },
    });

    await expect(service.prepare(tenantId, manifestId, 'operator-2'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('isolates lookup by tenant and validates inputs', async () => {
    manifests.findById.mockResolvedValue(null);
    await expect(service.latest(tenantId, manifestId))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(manifests.findById).toHaveBeenCalledWith(tenantId, manifestId);
    await expect(service.prepare('bad', manifestId, 'operator-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
