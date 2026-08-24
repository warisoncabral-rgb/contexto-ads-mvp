import { Pool, PoolClient } from 'pg';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  ExecutionAuthorizationV1,
  ExecutionPreflightV1,
} from '../../domain/contracts/execution-authorization';
import { PostgresExecutionAuthorizationRepository } from './postgres-execution-authorization.repository';

describe('PostgresExecutionAuthorizationRepository', () => {
  const authorization: ExecutionAuthorizationV1 = {
    executionAuthorizationId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    executionPlanId: '44444444-4444-4444-8444-444444444444',
    executionManifestId: '55555555-5555-4555-8555-555555555555',
    planHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64),
    actionType: 'authorize_controlled_paused_creation', riskLevel: 'high',
    scope: ['intended_lifecycle_status:PAUSED'], requestedBy: 'warison',
    status: 'pending', expiresAt: '2026-08-24T14:15:00.000Z',
    correlationId: '66666666-6666-4666-8666-666666666666',
    boundaries: {
      effectiveExecutionPermission: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    },
    createdAt: '2026-08-24T14:00:00.000Z',
    updatedAt: '2026-08-24T14:00:00.000Z',
  };
  const row = {
    execution_authorization_id: authorization.executionAuthorizationId,
    tenant_id: authorization.tenantId,
    campaign_id: authorization.campaignId,
    execution_plan_id: authorization.executionPlanId,
    execution_manifest_id: authorization.executionManifestId,
    plan_hash: authorization.planHash,
    manifest_hash: authorization.manifestHash,
    action_type: authorization.actionType,
    risk_level: authorization.riskLevel,
    scope: authorization.scope,
    requested_by: authorization.requestedBy,
    approved_by: null,
    approved_at: null,
    decision_reason: null,
    status: authorization.status,
    expires_at: new Date(authorization.expiresAt),
    correlation_id: authorization.correlationId,
    boundaries: authorization.boundaries,
    created_at: new Date(authorization.createdAt),
    updated_at: new Date(authorization.updatedAt),
  };
  const event: AuditEvent = {
    auditEventId: '77777777-7777-4777-8777-777777777777',
    tenantId: authorization.tenantId,
    correlationId: authorization.correlationId,
    actorType: 'user', actorId: 'warison',
    eventType: 'execution_authorization_requested',
    result: 'success', createdAt: authorization.createdAt,
  };
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn().mockResolvedValue(client);
  const repository = new PostgresExecutionAuthorizationRepository({
    connect, query,
  } as unknown as Pool);

  beforeEach(() => {
    query.mockReset(); release.mockReset(); connect.mockClear();
  });

  it('persists request and audit atomically', async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await expect(repository.request(authorization, event)).resolves.toEqual(authorization);
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(' ')[0]))
      .toEqual(['begin', 'insert', 'insert', 'commit']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns the active authorization without duplicating audit', async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({});
    await expect(repository.request(authorization, event)).resolves.toEqual(authorization);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into audit_events')))
      .toBe(false);
  });

  it('approves only an unexpired authorization for the latest exact manifest', async () => {
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await repository.approveIfCurrent(
      authorization.tenantId, authorization.executionAuthorizationId,
      'warison', authorization.updatedAt, event,
    );
    expect(query.mock.calls[1][0]).toContain('expires_at > $4');
    expect(query.mock.calls[1][0]).toContain('update execution_authorizations as auth');
    expect(query.mock.calls[1][0]).toContain('order by manifest.generated_at desc');
    expect(query.mock.calls[2][0]).toContain('insert into audit_events');
  });

  it('persists a blocked preflight and audit atomically and idempotently', async () => {
    const preflight: ExecutionPreflightV1 = {
      executionPreflightId: '88888888-8888-4888-8888-888888888888',
      tenantId: authorization.tenantId, campaignId: authorization.campaignId,
      executionPlanId: authorization.executionPlanId,
      executionManifestId: authorization.executionManifestId,
      executionAuthorizationId: authorization.executionAuthorizationId,
      planHash: authorization.planHash, manifestHash: authorization.manifestHash,
      preflightHash: 'c'.repeat(64), status: 'blocked_before_attempt',
      checks: [], blockers: ['tenant_kill_switch'], nextAction: 'Validar Kill Switch.',
      boundaries: {
        executionRecordCreated: false, externalAttemptStarted: false,
        campaignPublished: false, campaignActive: false, campaignDelivering: false,
        externalWritesAllowed: false, externalWritesPerformed: false,
      },
      generatedAt: authorization.updatedAt,
    };
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ payload: preflight }] })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await expect(repository.savePreflightIdempotent(preflight, event))
      .resolves.toEqual(preflight);
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(' ')[0]))
      .toEqual(['begin', 'insert', 'insert', 'commit']);
  });
});
