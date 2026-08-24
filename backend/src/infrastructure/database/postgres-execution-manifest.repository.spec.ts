import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { ExecutionManifestV1 } from '../../domain/contracts/execution-manifest';
import { PostgresExecutionManifestRepository } from './postgres-execution-manifest.repository';

describe('PostgresExecutionManifestRepository', () => {
  const manifest: ExecutionManifestV1 = {
    executionManifestId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    readinessDecisionId: '55555555-5555-4555-8555-555555555555',
    simulationId: '66666666-6666-4666-8666-666666666666',
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
    generatedAt: '2026-08-24T14:00:00.000Z',
  };
  const event: AuditEvent = {
    auditEventId: '77777777-7777-4777-8777-777777777777',
    tenantId: manifest.tenantId,
    correlationId: '88888888-8888-4888-8888-888888888888',
    actorType: 'system', eventType: 'execution_manifest_prepared',
    result: 'info', createdAt: manifest.generatedAt,
  };
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const repository = new PostgresExecutionManifestRepository({
    connect, query,
  } as unknown as Pool);

  beforeEach(() => {
    query.mockReset(); release.mockReset(); connect.mockClear();
  });

  it('persists the immutable manifest and audit atomically', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ payload: manifest }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await expect(repository.saveIdempotent(manifest, event)).resolves.toEqual(manifest);
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(' ')[0]))
      .toEqual(['begin', 'insert', 'insert', 'commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns an existing semantic manifest without duplicating its audit', async () => {
    query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ payload: manifest }] })
      .mockResolvedValueOnce({});
    await expect(repository.saveIdempotent(manifest, event)).resolves.toEqual(manifest);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into audit_events')))
      .toBe(false);
  });

  it('loads the latest manifest only inside the tenant and plan', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: manifest }] });
    await expect(repository.latestForPlan(manifest.tenantId, manifest.executionPlanId))
      .resolves.toEqual(manifest);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_plan_id = $2'),
      [manifest.tenantId, manifest.executionPlanId],
    );
  });

  it('loads a manifest by ID only inside its tenant', async () => {
    query.mockResolvedValueOnce({ rows: [{ payload: manifest }] });
    await expect(repository.findById(manifest.tenantId, manifest.executionManifestId))
      .resolves.toEqual(manifest);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and execution_manifest_id = $2'),
      [manifest.tenantId, manifest.executionManifestId],
    );
  });
});
