import { Pool } from 'pg';
import { PostgresOperatorTenantMembershipRepository } from './postgres-operator-tenant-membership.repository';

describe('PostgresOperatorTenantMembershipRepository', () => {
  const query = jest.fn();
  const repository = new PostgresOperatorTenantMembershipRepository({ query } as unknown as Pool);

  beforeEach(() => query.mockReset());

  it('lists only active memberships and active tenant profiles for the exact subject', async () => {
    query.mockResolvedValueOnce({ rows: [{
      membership_id: '11111111-1111-4111-8111-111111111111',
      operator_subject: 'operator:warison',
      tenant_id: '22222222-2222-4222-8222-222222222222',
      display_name: 'Rosa VIP Calçados',
      role: 'owner',
      status: 'active',
      created_at: new Date('2026-08-24T15:00:00.000Z'),
      revoked_at: null,
    }] });

    await expect(repository.listActiveForSubject('operator:warison')).resolves.toEqual([{
      membershipId: '11111111-1111-4111-8111-111111111111',
      operatorSubject: 'operator:warison',
      tenantId: '22222222-2222-4222-8222-222222222222',
      tenantDisplayName: 'Rosa VIP Calçados',
      role: 'owner',
      status: 'active',
      createdAt: '2026-08-24T15:00:00.000Z',
    }]);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/operator_subject = \$1[\s\S]*membership\.status = 'active'[\s\S]*profile\.status = 'active'/),
      ['operator:warison'],
    );
  });

  it('does not broaden an empty subject result', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repository.listActiveForSubject('operator:unknown')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['operator:unknown']);
  });
});
