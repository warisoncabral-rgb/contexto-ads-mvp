import { Pool } from 'pg';
import {
  OperatorRole,
  OperatorTenantMembershipV1,
} from '../../domain/contracts/operator-access';
import { OperatorTenantMembershipRepository } from '../../domain/ports/repositories';

interface MembershipRow {
  membership_id: string;
  operator_subject: string;
  tenant_id: string;
  display_name: string;
  role: OperatorRole;
  status: OperatorTenantMembershipV1['status'];
  created_at: Date;
  revoked_at: Date | null;
}

export class PostgresOperatorTenantMembershipRepository
implements OperatorTenantMembershipRepository {
  constructor(private readonly pool: Pool) {}

  async listActiveForSubject(
    operatorSubject: string,
  ): Promise<OperatorTenantMembershipV1[]> {
    const result = await this.pool.query<MembershipRow>(
      `select membership.membership_id, membership.operator_subject,
        membership.tenant_id, profile.display_name, membership.role,
        membership.status, membership.created_at, membership.revoked_at
      from operator_tenant_memberships membership
      inner join tenant_profiles profile on profile.tenant_id = membership.tenant_id
      where membership.operator_subject = $1
        and membership.status = 'active'
        and profile.status = 'active'
      order by lower(profile.display_name), membership.tenant_id`,
      [operatorSubject],
    );
    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      operatorSubject: row.operator_subject,
      tenantId: row.tenant_id,
      tenantDisplayName: row.display_name,
      role: row.role,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    }));
  }
}
