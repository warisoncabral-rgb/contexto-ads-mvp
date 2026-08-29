import { OperatorActionPingController } from './operator-action-ping.controller';

describe('OperatorActionPingController', () => {
  it('returns a small authenticated no-write response', async () => {
    const access = {
      listTenants: jest.fn(async () => ({
        operator: { subject: 'operator:test' },
        tenants: [
          { tenantId: '22222222-2222-4222-8222-222222222222' },
        ],
      })),
    };
    const controller = new OperatorActionPingController(access as any);

    const result = await controller.ping('Bearer secret');

    expect(access.listTenants).toHaveBeenCalledWith('Bearer secret');
    expect(result).toEqual({
      action_status: 'OK',
      service: 'contexto-ads-generator',
      schema_version: '1.0.8',
      authenticated: true,
      authorized_tenant_count: 1,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    });
  });
});
