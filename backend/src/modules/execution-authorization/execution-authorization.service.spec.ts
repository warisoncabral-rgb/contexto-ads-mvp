import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightV1,
} from '../../domain/contracts/execution-authorization';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { MetaWriteValidationProtocolV1 } from '../../domain/contracts/meta-write-validation';
import {
  ExecutionAuthorizationRepository,
  ExecutionManifestRepository,
  MetaWriteValidationProtocolRepository,
} from '../../domain/ports/repositories';
import { ExecutionAuthorizationService } from './execution-authorization.service';
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaWriteAdapter } from '../meta-adapter/meta-write.adapter';

describe('ExecutionAuthorizationService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const planId = '33333333-3333-4333-8333-333333333333';
  const manifestId = '44444444-4444-4444-8444-444444444444';
  const authorizationId = '55555555-5555-4555-8555-555555555555';
  const manifest: ExecutionManifestV1 = {
    executionManifestId: manifestId,
    tenantId, campaignId, executionPlanId: planId,
    readinessDecisionId: '66666666-6666-4666-8666-666666666666',
    simulationId: '77777777-7777-4777-8777-777777777777',
    planHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64),
    status: 'prepared_gate_closed', operations: [],
    executionGate: {
      status: 'closed', reason: 'write_path_not_validated_or_enabled', requirements: [],
    },
    reconciliationPolicy: {
      sourceOfTruth: 'meta_observed_state_with_internal_execution_record',
      unknownOutcome: 'stop_and_reconcile',
      retry: 'forbidden_until_previous_outcome_is_known',
      successEvidenceRequired: ['external_object_id', 'meta_response', 'observed_state'],
      automaticCorrection: 'only_when_safe_and_explicitly_authorized',
    },
    boundaries: {
      executable: false, campaignPublished: false, campaignActive: false,
      campaignDelivering: false, externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    generatedAt: '2026-08-24T13:00:00.000Z',
  };
  const pending: ExecutionAuthorizationV1 = {
    executionAuthorizationId: authorizationId,
    tenantId, campaignId, executionPlanId: planId, executionManifestId: manifestId,
    planHash: manifest.planHash, manifestHash: manifest.manifestHash,
    actionType: 'authorize_controlled_paused_creation', riskLevel: 'high', scope: [],
    requestedBy: 'warison', status: 'pending',
    expiresAt: '2099-08-24T13:15:00.000Z',
    correlationId: '88888888-8888-4888-8888-888888888888',
    boundaries: {
      effectiveExecutionPermission: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    createdAt: '2026-08-24T13:00:00.000Z',
    updatedAt: '2026-08-24T13:00:00.000Z',
  };
  let manifests: jest.Mocked<ExecutionManifestRepository>;
  let authorizations: jest.Mocked<ExecutionAuthorizationRepository>;
  let service: ExecutionAuthorizationService;
  let killSwitch: jest.Mocked<KillSwitchService>;
  let validationProtocols: jest.Mocked<MetaWriteValidationProtocolRepository>;

  beforeEach(() => {
    manifests = {
      saveIdempotent: jest.fn(),
      latestForPlan: jest.fn().mockResolvedValue(manifest),
      findById: jest.fn().mockResolvedValue(manifest),
    };
    authorizations = {
      request: jest.fn(async (value: ExecutionAuthorizationV1, _event: AuditEvent) => value),
      findById: jest.fn().mockResolvedValue(pending),
      approveIfCurrent: jest.fn().mockResolvedValue({
        ...pending, status: 'approved', approvedBy: 'warison',
      }),
      transition: jest.fn(),
      expireOrInvalidate: jest.fn().mockResolvedValue(null),
      savePreflightIdempotent: jest.fn(async (
        value: ExecutionPreflightV1, _event: AuditEvent,
      ) => value),
    };
    killSwitch = {
      effective: jest.fn().mockResolvedValue({
        tenantId, campaignId, writesBlocked: true,
        decision: 'blocked_missing_state',
        tenant: { known: false, status: 'missing' },
        campaign: { known: false, status: 'missing' },
        boundaries: { externalWritesAllowed: false, externalWritesPerformed: false },
        evaluatedAt: '2026-08-24T13:00:00.000Z',
      }),
    } as unknown as jest.Mocked<KillSwitchService>;
    validationProtocols = {
      saveIdempotent: jest.fn(),
      latestForManifest: jest.fn().mockResolvedValue(null),
      beginExecution: jest.fn(),
      updateExecution: jest.fn(),
    };
    service = new ExecutionAuthorizationService(
      manifests, authorizations, killSwitch, validationProtocols,
    );
  });

  it('requests a high-risk, short-lived authorization for the exact manifest', async () => {
    const before = Date.now();
    const result = await service.request(tenantId, manifestId, 'warison');
    const validity = new Date(result.expiresAt).getTime() - new Date(result.createdAt).getTime();

    expect(new Date(result.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(validity).toBe(15 * 60 * 1000);
    expect(result).toEqual(expect.objectContaining({
      executionManifestId: manifestId,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      riskLevel: 'high',
      status: 'pending',
    }));
    expect(result.scope).toEqual(expect.arrayContaining([
      `manifest_hash:${manifest.manifestHash}`,
      'intended_lifecycle_status:PAUSED',
      'external_write_currently_allowed:false',
    ]));
    expect(result.boundaries).toEqual({
      effectiveExecutionPermission: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
    const [, event] = authorizations.request.mock.calls[0];
    expect(event).toEqual(expect.objectContaining({
      eventType: 'execution_authorization_requested', actorId: 'warison',
    }));
  });

  it('approves only a current, unexpired authorization without enabling writes', async () => {
    const result = await service.approve(tenantId, authorizationId, 'warison');
    expect(result.status).toBe('approved');
    expect(result.boundaries.effectiveExecutionPermission).toBe(false);
    expect(authorizations.approveIfCurrent).toHaveBeenCalledWith(
      tenantId, authorizationId, 'warison', expect.any(String), expect.objectContaining({
        eventType: 'execution_authorization_approved',
        newState: expect.objectContaining({ effectiveExecutionPermission: false }),
      }),
    );
  });

  it('persists a transparent preflight and does not create an ExecutionRecord', async () => {
    authorizations.findById.mockResolvedValueOnce({ ...pending, status: 'approved' });
    const result = await service.preflight(tenantId, authorizationId);

    expect(result.status).toBe('blocked_before_attempt');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'manifest_current', status: 'passed' }),
      expect.objectContaining({ key: 'specific_execution_authorization', status: 'passed' }),
      expect.objectContaining({ key: 'tenant_kill_switch', status: 'blocked' }),
      expect.objectContaining({ key: 'real_meta_write_validation', status: 'blocked' }),
      expect.objectContaining({ key: 'write_adapter_enabled', status: 'blocked' }),
    ]));
    expect(result.nextAction).toContain('Kill Switch');
    expect(result.boundaries).toEqual({
      executionRecordCreated: false, externalAttemptStarted: false,
      campaignPublished: false, campaignActive: false, campaignDelivering: false,
      externalWritesAllowed: false, externalWritesPerformed: false,
    });
  });

  it('scopes a resumed authorization to the operations in the prepared protocol', async () => {
    validationProtocols.latestForManifest.mockResolvedValue({
      metaWriteValidationProtocolId: '99999999-9999-4999-8999-999999999999',
      manifestHash: manifest.manifestHash,
      status: 'prepared_external_validation_required',
      operations: Array.from({ length: 7 }, (_, index) => ({
        order: index + 2,
        operationKey: `operation:${index + 2}`,
        objectType: 'creative',
        action: 'create_creative',
        requestFingerprint: 'c'.repeat(64),
        intendedLifecycleStatus: 'PAUSED',
      })),
    } as MetaWriteValidationProtocolV1);

    const result = await service.request(tenantId, manifestId, 'warison');

    expect(result.scope).toEqual(expect.arrayContaining([
      'operations:7',
      'validation_protocol:99999999-9999-4999-8999-999999999999',
    ]));
    expect(result.scope).not.toContain(`operations:${manifest.operations.length}`);
  });

  it('creates stable preflight hashes for identical gate state', async () => {
    authorizations.findById.mockResolvedValue({ ...pending, status: 'approved' });
    const first = await service.preflight(tenantId, authorizationId);
    const second = await service.preflight(tenantId, authorizationId);
    expect(second.preflightHash).toBe(first.preflightHash);
  });

  it('references a prepared protocol without treating it as real validation', async () => {
    authorizations.findById.mockResolvedValue({ ...pending, status: 'approved' });
    const protocolId = '99999999-9999-4999-8999-999999999999';
    validationProtocols.latestForManifest.mockResolvedValue({
      metaWriteValidationProtocolId: protocolId,
    } as MetaWriteValidationProtocolV1);

    const result = await service.preflight(tenantId, authorizationId);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'real_meta_write_validation',
        status: 'blocked',
        evidenceRefs: [`meta_write_validation_protocol:${protocolId}`],
      }),
    ]));
    expect(result.blockers).toContain('real_meta_write_validation');
    expect(result.boundaries.externalAttemptStarted).toBe(false);
  });

  it('reports the hosted executor ready without starting an external attempt', async () => {
    authorizations.findById.mockResolvedValue({ ...pending, status: 'approved' });
    killSwitch.effective.mockResolvedValue({
      tenantId, campaignId, writesBlocked: false, decision: 'released',
      tenant: { known: true, status: 'released', stateId: authorizationId, version: 1 },
      campaign: { known: true, status: 'released', stateId: manifestId, version: 1 },
      boundaries: { externalWritesAllowed: false, externalWritesPerformed: false },
      evaluatedAt: '2026-08-24T13:00:00.000Z',
    });
    validationProtocols.latestForManifest.mockResolvedValue({
      metaWriteValidationProtocolId: '99999999-9999-4999-8999-999999999999',
      status: 'prepared_external_validation_required',
    } as MetaWriteValidationProtocolV1);
    const plans = {
      findById: jest.fn().mockResolvedValue({
        meta: { connectionId: authorizationId, adAccountId: 'act_123' },
        objectsToCreate: [{
          type: 'ad_set',
          logicalConfig: { geography: 'João Pessoa, PB, Brasil (40 km)' },
        }],
      }),
    };
    const connections = {
      findById: jest.fn().mockResolvedValue({ status: 'connected', credentialRef: 'vault/ref' }),
      listBindings: jest.fn().mockResolvedValue([
        { assetType: 'facebook_page', externalId: '10', selected: true },
        { assetType: 'whatsapp', externalId: '20', selected: true },
      ]),
    };
    const adapter = {
      enabled: jest.fn().mockReturnValue(true),
      searchCity: jest.fn().mockResolvedValue({
        success: true,
        data: { key: '12345', name: 'João Pessoa' },
        retryable: false,
        observedAt: '2026-09-01T16:00:00.000Z',
      }),
    };
    service = new ExecutionAuthorizationService(
      manifests, authorizations, killSwitch, validationProtocols,
      plans as never, connections as never, adapter as unknown as MetaWriteAdapter,
    );

    const result = await service.preflight(tenantId, authorizationId);

    expect(result.blockers).toEqual([]);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'real_meta_write_validation', status: 'passed' }),
      expect.objectContaining({ key: 'meta_geography_resolved', status: 'passed' }),
      expect.objectContaining({ key: 'write_adapter_enabled', status: 'passed' }),
    ]));
    expect(result.nextAction).toContain('uma única criação controlada');
    expect(result.boundaries.externalAttemptStarted).toBe(false);
  });

  it('passes both Kill Switch checks only when both states are known and released', async () => {
    authorizations.findById.mockResolvedValue({ ...pending, status: 'approved' });
    killSwitch.effective.mockResolvedValueOnce({
      tenantId, campaignId, writesBlocked: false, decision: 'released',
      tenant: {
        known: true, status: 'released', stateId: authorizationId, version: 1,
      },
      campaign: {
        known: true, status: 'released', stateId: manifestId, version: 1,
      },
      boundaries: { externalWritesAllowed: false, externalWritesPerformed: false },
      evaluatedAt: '2026-08-24T13:00:00.000Z',
    });
    const result = await service.preflight(tenantId, authorizationId);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tenant_kill_switch', status: 'passed' }),
      expect.objectContaining({ key: 'campaign_kill_switch', status: 'passed' }),
      expect.objectContaining({ key: 'write_adapter_enabled', status: 'blocked' }),
    ]));
    expect(result.boundaries.externalWritesAllowed).toBe(false);
  });

  it('refuses stale manifests before creating an authorization', async () => {
    manifests.latestForPlan.mockResolvedValueOnce({
      ...manifest, executionManifestId: authorizationId,
    });
    await expect(service.request(tenantId, manifestId, 'warison'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(authorizations.request).not.toHaveBeenCalled();
  });

  it('expires an old active authorization before issuing a fresh request', async () => {
    const expired = { ...pending, expiresAt: '2020-01-01T00:00:00.000Z' };
    authorizations.request
      .mockResolvedValueOnce(expired)
      .mockImplementationOnce(async (value) => value);
    authorizations.expireOrInvalidate.mockResolvedValueOnce({
      ...expired, status: 'expired', decisionReason: 'execution_authorization_expired',
    });

    const result = await service.request(tenantId, manifestId, 'warison');
    expect(result.status).toBe('pending');
    expect(authorizations.request).toHaveBeenCalledTimes(2);
    expect(authorizations.expireOrInvalidate).toHaveBeenCalledWith(
      tenantId, authorizationId, expect.any(String), expect.any(Object),
    );
  });

  it('refreshes expiry or invalidation before approval and preflight', async () => {
    authorizations.expireOrInvalidate.mockResolvedValueOnce({
      ...pending, status: 'expired', decisionReason: 'execution_authorization_expired',
    });
    await expect(service.approve(tenantId, authorizationId, 'warison'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(authorizations.approveIfCurrent).not.toHaveBeenCalled();
  });

  it('enforces tenant isolation and validates inputs before repository access', async () => {
    authorizations.findById.mockResolvedValueOnce(null);
    await expect(service.get(
      '99999999-9999-4999-8999-999999999999', authorizationId,
    )).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.request('bad', manifestId, 'warison'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
