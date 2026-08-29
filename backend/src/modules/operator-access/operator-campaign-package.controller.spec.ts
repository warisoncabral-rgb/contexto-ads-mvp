import { ConflictException } from '@nestjs/common';
import { OperatorCampaignPackageController } from './operator-campaign-package.controller';

describe('OperatorCampaignPackageController', () => {
  it('auto-resolves the single authorized tenant and selected Meta target before handoff', async () => {
    const access = {
      listTenants: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        tenants: [{
          tenantId: '22222222-2222-4222-8222-222222222222',
          displayName: 'Rosa VIP Calçados',
          role: 'owner',
          permissions: ['manage_campaign_preparation'],
          membershipId: 'membership-1',
        }],
      })),
      authorizeCampaignPreparation: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        membership: { role: 'owner' },
      })),
    };
    const handoff = {
      submit: jest.fn(async () => ({
        package_id: '11111111-1111-4111-8111-111111111111',
        boundaries: {
          persisted: true,
          creative_package_persisted: true,
          execution_plan_created: true,
          meta_write_performed: false,
          spend_authorized: false,
          delivery_authorized: false,
        },
      })),
    };
    const status = { get: jest.fn() };
    const connections = {
      selectedExecutionTarget: jest.fn(async () => ({
        tenantId: '22222222-2222-4222-8222-222222222222',
        connectionId: '673dbb65-e187-4d80-8751-772d6e0156b3',
        adAccountId: 'act_929361834160386',
        selectedAssets: [
          { assetType: 'ad_account', externalId: 'act_929361834160386' },
          { assetType: 'facebook_page', externalId: '100457068314696' },
          { assetType: 'whatsapp', externalId: '558386553047' },
        ],
      })),
    };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    const body = {
      package_id: '11111111-1111-4111-8111-111111111111',
      business_name: 'Rosa VIP Calçados',
    };
    const result = await controller.submitAutoResolved(body, 'Bearer secret');

    expect(access.listTenants).toHaveBeenCalledWith('Bearer secret');
    expect(connections.selectedExecutionTarget).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(handoff.submit).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({
        meta_connection_id: '673dbb65-e187-4d80-8751-772d6e0156b3',
        ad_account_id: 'act_929361834160386',
        facebook_page_id: '100457068314696',
        whatsapp_asset_id: '558386553047',
      }),
      'operator:test',
    );
    expect(result.boundaries).toMatchObject({
      technical_target_auto_resolved: true,
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
    });
  });

  it('fails closed when multiple preparation tenants cannot be matched safely', async () => {
    const access = {
      listTenants: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        tenants: [
          {
            tenantId: '22222222-2222-4222-8222-222222222222',
            displayName: 'Tenant A',
            permissions: ['manage_campaign_preparation'],
          },
          {
            tenantId: '33333333-3333-4333-8333-333333333333',
            displayName: 'Tenant B',
            permissions: ['manage_campaign_preparation'],
          },
        ],
      })),
      authorizeCampaignPreparation: jest.fn(),
    };
    const handoff = { submit: jest.fn() };
    const status = { get: jest.fn() };
    const connections = { selectedExecutionTarget: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    await expect(controller.submitAutoResolved(
      { business_name: 'Unknown Business' },
      'Bearer secret',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(handoff.submit).not.toHaveBeenCalled();
    expect(connections.selectedExecutionTarget).not.toHaveBeenCalled();
  });

  it('authenticates tenant preparation before submitting a package', async () => {
    const access = {
      authorizeCampaignPreparation: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        membership: { role: 'owner' },
      })),
    };
    const handoff = {
      submit: jest.fn(async () => ({ package_id: '11111111-1111-4111-8111-111111111111' })),
    };
    const status = { get: jest.fn() };
    const connections = { selectedExecutionTarget: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    const body = { package_id: '11111111-1111-4111-8111-111111111111' };
    await controller.submit(
      '22222222-2222-4222-8222-222222222222',
      body,
      'Bearer secret',
    );

    expect(access.authorizeCampaignPreparation).toHaveBeenCalledWith(
      'Bearer secret',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(handoff.submit).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      body,
      'operator:test',
    );
  });

  it('authenticates tenant preparation before returning package status', async () => {
    const access = {
      authorizeCampaignPreparation: jest.fn(async () => ({ operator: { subject: 'operator:test' } })),
    };
    const handoff = { submit: jest.fn() };
    const status = {
      get: jest.fn(async () => ({
        package_id: '11111111-1111-4111-8111-111111111111',
        next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      })),
    };
    const connections = { selectedExecutionTarget: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    const result = await controller.getStatus(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'Bearer secret',
    );

    expect(access.authorizeCampaignPreparation).toHaveBeenCalledTimes(1);
    expect(status.get).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.next_action).toBe('REVIEW_AND_APPROVE_CREATIVE_PACKAGE');
  });
});
