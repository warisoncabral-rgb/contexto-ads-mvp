import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';
import { AuditRepository, OperatorTenantMembershipRepository } from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { OPERATOR_IDENTITY } from '../../infrastructure/operator-access/operator-access.tokens';

@Injectable()
export class MetaTenantOwnerGuard implements CanActivate {
  constructor(
    @Inject(OPERATOR_IDENTITY) private readonly identity: OperatorIdentityPort,
    @Inject(OPERATOR_TENANT_MEMBERSHIP_REPOSITORY)
    private readonly memberships: OperatorTenantMembershipRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      body?: { tenantId?: string };
      query?: { tenantId?: string };
    }>();
    const tenantId = request.body?.tenantId ?? request.query?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId is required');

    if (!this.identity.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'operator_authentication_unavailable',
        message: 'Operator authentication is unavailable',
      });
    }

    let principal;
    try {
      principal = await this.identity.authenticate(request.headers?.authorization);
    } catch (error) {
      if (error instanceof OperatorAuthenticationUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'operator_authentication_unavailable',
          message: 'Operator authentication is unavailable',
        });
      }
      if (error instanceof InvalidOperatorCredentialsError) {
        throw new UnauthorizedException({ code: 'operator_unauthorized', message: 'Unauthorized' });
      }
      throw error;
    }

    const memberships = await this.memberships.listActiveForSubject(principal.subject);
    const membership = memberships.find((entry) => entry.tenantId === tenantId);
    if (!membership || membership.role !== 'owner') {
      throw new ForbiddenException({
        code: 'configure_tenant_required',
        message: 'Tenant configuration permission is required',
      });
    }

    const now = new Date().toISOString();
    await this.audit.append({
      auditEventId: randomUUID(),
      tenantId,
      correlationId: membership.membershipId,
      actorType: 'user',
      actorId: principal.subject,
      eventType: 'operator_meta_tenant_access_verified',
      objectType: 'operator_tenant_membership',
      objectId: membership.membershipId,
      result: 'success',
      createdAt: now,
    });
    return true;
  }
}
