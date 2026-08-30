import { NotFoundException } from '@nestjs/common';
import { PublicReadonlyActionGatewayController } from './public-readonly-action-gateway.controller';

describe('PublicReadonlyActionGatewayController', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const packageId = '849547ce-645e-4c7b-a844-451182253fe6';
  const previousTenantId = process.env.BOOTSTRAP_TENANT_ID;

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousTenantId === undefined) delete process.env.BOOTSTRAP_TENANT_ID;
    else process.env.BOOTSTRAP_TENANT_ID = previousTenantId;
  });

  it('recovers status without authorizing writes', async () => {
    process.env.BOOTSTRAP_TENANT_ID = tenantId;
    const status = {
      get: jest.fn().mockResolvedValue({
        package_id: packageId,
        boundaries: {
          external_writes_performed: false,
        },
      }),
    };
    const controller = new PublicReadonlyActionGatewayController(status as any);

    await expect(controller.recover(packageId)).resolves.toEqual({
      action_status: 'FOUND',
      package_id: packageId,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    });
    expect(status.get).toHaveBeenCalledWith(tenantId, packageId);
  });

  it('returns a stable NOT_FOUND envelope', async () => {
    process.env.BOOTSTRAP_TENANT_ID = tenantId;
    const status = {
      get: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const controller = new PublicReadonlyActionGatewayController(status as any);

    const result = await controller.recover(packageId);

    expect(result.action_status).toBe('NOT_FOUND');
    expect(result.http_status).toBe(404);
    expect(result.boundaries.meta_write_performed).toBe(false);
  });

  it('rejects malformed package ids before repository access', async () => {
    process.env.BOOTSTRAP_TENANT_ID = tenantId;
    const status = { get: jest.fn() };
    const controller = new PublicReadonlyActionGatewayController(status as any);

    const result = await controller.recover('invalid');

    expect(result.action_status).toBe('REJECTED');
    expect(result.http_status).toBe(400);
    expect(status.get).not.toHaveBeenCalled();
  });
});
