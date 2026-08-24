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
  OperatorTenantMembershipRepository,
} from '../../domain/ports/repositories';
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
    service = new OperatorAccessService(identity, memberships, audit);
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
});
