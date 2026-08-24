import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { InvalidOperatorCredentialsError } from '../../domain/ports/operator-identity.port';
import { MetaTenantOwnerGuard } from './meta-tenant-owner.guard';

const tenantId = '11111111-1111-4111-8111-111111111111';

function context(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('MetaTenantOwnerGuard', () => {
  const principal = { subject: 'operator:test', provider: 'bootstrap_token' as const, authenticatedAt: new Date().toISOString() };
  const ownerMembership = { membershipId: 'm1', operatorSubject: principal.subject, tenantId,
    tenantDisplayName: 'Tenant', role: 'owner' as const, status: 'active' as const, createdAt: new Date().toISOString() };

  it('allows only an authenticated owner of the requested tenant and audits access', async () => {
    const identity = { isAvailable: () => true, authenticate: jest.fn().mockResolvedValue(principal) };
    const memberships = { listActiveForSubject: jest.fn().mockResolvedValue([ownerMembership]) };
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const guard = new MetaTenantOwnerGuard(identity, memberships, audit);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer synthetic' }, body: { tenantId } }))).resolves.toBe(true);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ tenantId, eventType: 'operator_meta_tenant_access_verified', result: 'success' }));
  });

  it('rejects operator and viewer roles for tenant configuration', async () => {
    const identity = { isAvailable: () => true, authenticate: jest.fn().mockResolvedValue(principal) };
    const memberships = { listActiveForSubject: jest.fn().mockResolvedValue([{ ...ownerMembership, role: 'operator' }]) };
    const guard = new MetaTenantOwnerGuard(identity, memberships, { append: jest.fn() });
    await expect(guard.canActivate(context({ headers: {}, query: { tenantId } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed for unavailable or invalid authentication', async () => {
    const memberships = { listActiveForSubject: jest.fn() };
    const audit = { append: jest.fn() };
    const unavailable = new MetaTenantOwnerGuard({ isAvailable: () => false, authenticate: jest.fn() }, memberships, audit);
    await expect(unavailable.canActivate(context({ query: { tenantId } }))).rejects.toBeInstanceOf(ServiceUnavailableException);

    const invalid = new MetaTenantOwnerGuard({ isAvailable: () => true,
      authenticate: jest.fn().mockRejectedValue(new InvalidOperatorCredentialsError()) }, memberships, audit);
    await expect(invalid.canActivate(context({ headers: { authorization: 'Bearer bad' }, query: { tenantId } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires an explicit tenant scope', async () => {
    const guard = new MetaTenantOwnerGuard({ isAvailable: () => true, authenticate: jest.fn() },
      { listActiveForSubject: jest.fn() }, { append: jest.fn() });
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toBeInstanceOf(BadRequestException);
  });
});
