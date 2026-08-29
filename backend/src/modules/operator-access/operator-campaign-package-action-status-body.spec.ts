import { NotFoundException } from '@nestjs/common';
import { OperatorCampaignPackageController } from './operator-campaign-package.controller';

describe('OperatorCampaignPackageController body action recovery', () => {
  it('returns NOT_FOUND from package_id supplied in the request body', async () => {
    const access = {
      listTenants: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        tenants: [{
          tenantId: '22222222-2222-4222-8222-222222222222',
          displayName: 'Rosa VIP Calçados',
          permissions: ['manage_campaign_preparation'],
        }],
      })),
      authorizeCampaignPreparation: jest.fn(),
    };
    const handoff = { submit: jest.fn() };
    const status = {
      get: jest.fn(async () => {
        throw new NotFoundException({
          code: 'campaign_package_not_found',
          packageId: '849547ce-645e-4c7b-a844-451182253fe6',
        });
      }),
    };
    const connections = { selectedExecutionTarget: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    const result = await controller.postStatusActionEnvelope(
      { package_id: '849547ce-645e-4c7b-a844-451182253fe6' },
      'Bearer secret',
    );

    expect(status.get).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '849547ce-645e-4c7b-a844-451182253fe6',
    );
    expect(result).toMatchObject({
      action_status: 'NOT_FOUND',
      http_status: 404,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    });
  });

  it('rejects a missing or invalid package_id without any status lookup', async () => {
    const access = { listTenants: jest.fn() };
    const handoff = { submit: jest.fn() };
    const status = { get: jest.fn() };
    const connections = { selectedExecutionTarget: jest.fn() };
    const controller = new OperatorCampaignPackageController(
      access as any,
      handoff as any,
      status as any,
      connections as any,
    );

    const result = await controller.postStatusActionEnvelope(
      { package_id: 'not-a-uuid' },
      'Bearer secret',
    );

    expect(status.get).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action_status: 'REJECTED',
      http_status: 400,
      error: { code: 'package_id_required' },
      boundaries: { meta_write_performed: false },
    });
  });
});
