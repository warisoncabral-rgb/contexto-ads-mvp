import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEvent } from '../../domain/contracts/audit-event';
import {
  OperatorPermission,
  OperatorRole,
  OperatorWorkspaceAccessV1,
} from '../../domain/contracts/operator-access';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';
import {
  AuditRepository,
  OperatorTenantMembershipRepository,
} from '../../domain/ports/repositories';
import {
  AUDIT_REPOSITORY,
  OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { OPERATOR_IDENTITY } from '../../infrastructure/operator-access/operator-access.tokens';

const PERMISSIONS: Record<OperatorRole, OperatorPermission[]> = {
  owner: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
    'decide_approval',
    'configure_tenant',
  ],
  operator: [
    'view_workspace',
    'manage_campaign_preparation',
    'request_approval',
  ],
  viewer: ['view_workspace'],
};

@Injectable()
export class OperatorAccessService {
  constructor(
    @Inject(OPERATOR_IDENTITY)
    private readonly identity: OperatorIdentityPort,
    @Inject(OPERATOR_TENANT_MEMBERSHIP_REPOSITORY)
    private readonly memberships: OperatorTenantMembershipRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
  ) {}

  async listTenants(
    authorizationHeader: string | undefined,
  ): Promise<OperatorWorkspaceAccessV1> {
    const operator = await this.authenticate(authorizationHeader);
    const memberships = await this.memberships.listActiveForSubject(operator.subject);
    const generatedAt = new Date().toISOString();
    await Promise.all(memberships.map((membership) => this.audit.append(
      this.accessEvent(membership.tenantId, membership.membershipId,
        operator.subject, generatedAt),
    )));
    return {
      operator,
      tenants: memberships.map((membership) => ({
        tenantId: membership.tenantId,
        displayName: membership.tenantDisplayName,
        role: membership.role,
        permissions: [...PERMISSIONS[membership.role]],
        membershipId: membership.membershipId,
      })),
      boundaries: {
        tenantAccessDerivedFromMembership: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      generatedAt,
    };
  }

  private async authenticate(authorizationHeader: string | undefined) {
    try {
      return await this.identity.authenticate(authorizationHeader);
    } catch (error) {
      if (error instanceof OperatorAuthenticationUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'operator_authentication_not_configured',
          message: 'Operator authentication is not configured',
        });
      }
      if (error instanceof InvalidOperatorCredentialsError) {
        throw new UnauthorizedException({
          code: 'invalid_operator_credentials',
          message: 'Operator authentication failed',
        });
      }
      throw error;
    }
  }

  private accessEvent(
    tenantId: string,
    membershipId: string,
    operatorSubject: string,
    createdAt: string,
  ): AuditEvent {
    return {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: operatorSubject,
      eventType: 'operator_tenant_access_listed',
      objectType: 'operator_tenant_membership',
      objectId: membershipId,
      newState: {
        accessType: 'read_only_workspace_selection',
        publicationAuthorized: false,
        externalWritesAllowed: false,
      },
      result: 'info',
      createdAt,
    };
  }
}
