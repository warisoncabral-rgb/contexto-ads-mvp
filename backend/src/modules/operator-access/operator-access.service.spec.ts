import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { OperatorTenantMembershipV1 } from '../../domain/contracts/operator-access';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';
import {
  AuditRepository,
  OperatorPlanSelectionRepository,
  OperationalReadinessRepository,
  OperatorTenantMembershipRepository,
} from '../../domain/ports/repositories';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { OperatorAccessService } from './operator-access.service';

describe('OperatorAccessService', () => {
  const principal = {
    subject: 'operator:warison',
    provider: 'bootstrap_token' as const,
    authenticatedAt: '2026-08-24T15:00:00.000Z',
  };
  const membershipsFixture: OperatorTenantMembershipV1[] = [
    {
      membershipId: '11111111-1111-4111-8111-111111111111',
      operatorSubject: principal.subject,
      tenantId: '22222222-2222-4222-8222-222222222222',
      tenantDisplayName: 'Rosa VIP Calçados',
      role: 'owner',
      status: 'active',
      createdAt: '2026-08-24T14:00:00.000Z',
    },
    {
      membershipId: '33333333-3333-4333-8333-333333333333',
      operatorSubject: principal.subject,
      tenantId: '44444444-4444-4444-8444-444444444444',
      tenantDisplayName: 'Cliente leitura',
      role: 'viewer',
      status: 'active',
      createdAt: '2026-08-24T14:00:00.000Z',
    },
  ];
  let identity: jest.Mocked<OperatorIdentityPort>;
  let memberships: jest.Mocked<OperatorTenantMembershipRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let plans: jest.Mocked<OperatorPlanSelectionRepository>;
  let readiness: jest.Mocked<OperationalReadinessRepository>;
  let service: OperatorAccessService;

  beforeEach(() => {
    identity = {
      isAvailable: jest.fn().mockReturnValue(true),
      authenticate: jest.fn().mockResolvedValue(principal),
    };
    memberships = {
      listActiveForSubject: jest.fn().mockResolvedValue(membershipsFixture),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    plans = {
      listLatestForTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
    };
    readiness = {
      saveIdempotent: jest.fn(),
      latestForPlan: jest.fn(),
    };
    service = new OperatorAccessService(identity, memberships, audit, plans, readiness);
  });

  it('derives tenant selection and permissions only from active memberships', async () => {
    const result = await service.listTenants('Bearer valid-token-value-with-32-characters');
    expect(identity.authenticate).toHaveBeenCalledWith(
      'Bearer valid-token-value-with-32-characters',
    );
    expect(memberships.listActiveForSubject).toHaveBeenCalledWith(principal.subject);
    expect(result.tenants).toEqual([
      expect.objectContaining({
        displayName: 'Rosa VIP Calçados',
        role: 'owner',
        permissions: expect.arrayContaining(['decide_approval', 'configure_tenant']),
      }),
      expect.objectContaining({
        displayName: 'Cliente leitura',
        role: 'viewer',
        permissions: ['view_workspace'],
      }),
    ]);
    expect(result.boundaries).toEqual({
      tenantAccessDerivedFromMembership: true,
      publicationAuthorized: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_tenant_access_listed',
      actorId: principal.subject,
      newState: expect.objectContaining({ externalWritesAllowed: false }),
    } as Partial<AuditEvent>));
  });

  it('returns no tenant when no membership exists and never guesses access', async () => {
    memberships.listActiveForSubject.mockResolvedValueOnce([]);
    const result = await service.listTenants('Bearer valid-token-value-with-32-characters');
    expect(result.tenants).toEqual([]);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('maps unavailable authentication to 503 before repository access', async () => {
    identity.authenticate.mockRejectedValueOnce(new OperatorAuthenticationUnavailableError());
    await expect(service.listTenants(undefined))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(memberships.listActiveForSubject).not.toHaveBeenCalled();
  });

  it('maps all rejected credentials to a sanitized 401', async () => {
    identity.authenticate.mockRejectedValueOnce(new InvalidOperatorCredentialsError());
    await expect(service.listTenants('Bearer wrong-token-value-with-32-characters'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(memberships.listActiveForSubject).not.toHaveBeenCalled();
  });

  it('fails closed if access auditing cannot be persisted', async () => {
    audit.append.mockRejectedValueOnce(new Error('database detail'));
    await expect(service.listTenants('Bearer valid-token-value-with-32-characters'))
      .rejects.toThrow('database detail');
  });

  it('lists only the latest plans after verifying tenant membership', async () => {
    const plan = {
      tenantId: membershipsFixture[0].tenantId,
      campaignId: '55555555-5555-4555-8555-555555555555',
      executionPlanId: '66666666-6666-4666-8666-666666666666',
      status: 'ready_for_approval',
      campaignPackageVersion: 2,
      financials: { maximumPlannedSpendMinor: 42000, currency: 'BRL' },
      createdAt: '2026-08-24T16:00:00.000Z',
    } as ExecutionPlanV1;
    plans.listLatestForTenant.mockResolvedValueOnce([plan]);

    const result = await service.listTenantPlans(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
    );

    expect(plans.listLatestForTenant).toHaveBeenCalledWith(membershipsFixture[0].tenantId);
    expect(result.plans).toEqual([expect.objectContaining({
      executionPlanId: plan.executionPlanId,
      campaignId: plan.campaignId,
      maximumPlannedSpendMinor: 42000,
    })]);
    expect(result.boundaries.externalWritesAllowed).toBe(false);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_tenant_plans_listed',
    }));
  });

  it('denies cross-tenant plan discovery before querying plans', async () => {
    await expect(service.listTenantPlans(
      'Bearer valid-token-value-with-32-characters',
      '77777777-7777-4777-8777-777777777777',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(plans.listLatestForTenant).not.toHaveBeenCalled();
  });

  it('protects readiness lookup with both membership and tenant-scoped plan evidence', async () => {
    const executionPlanId = '66666666-6666-4666-8666-666666666666';
    const plan = {
      tenantId: membershipsFixture[0].tenantId,
      executionPlanId,
    } as ExecutionPlanV1;
    const decision = {
      readinessDecisionId: '88888888-8888-4888-8888-888888888888',
      tenantId: membershipsFixture[0].tenantId,
      executionPlanId,
    } as never;
    plans.findById.mockResolvedValueOnce(plan);
    readiness.latestForPlan.mockResolvedValueOnce(decision);

    await expect(service.latestReadiness(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
      executionPlanId,
    )).resolves.toBe(decision);
    expect(plans.findById).toHaveBeenCalledWith(membershipsFixture[0].tenantId, executionPlanId);
    expect(readiness.latestForPlan).toHaveBeenCalledWith(
      membershipsFixture[0].tenantId,
      executionPlanId,
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_operational_readiness_viewed',
    }));
  });

  it('does not reveal plan existence outside an active membership', async () => {
    await expect(service.latestReadiness(
      'Bearer valid-token-value-with-32-characters',
      '77777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(plans.findById).not.toHaveBeenCalled();
    expect(readiness.latestForPlan).not.toHaveBeenCalled();
  });
});
