import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OperatorAccessController } from './operator-access.controller';
import { OperatorAccessService } from './operator-access.service';

describe('OperatorAccessController execution route precedence', () => {
  let app: INestApplication;
  const service = {
    runExecutionPreflight: jest.fn().mockResolvedValue({ route: 'preflight' }),
    executeMetaPausedCreation: jest.fn().mockResolvedValue({ route: 'execute-paused' }),
    decideExecutionAuthorization: jest.fn().mockResolvedValue({ route: 'decision' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OperatorAccessController],
      providers: [{ provide: OperatorAccessService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => app.close());

  test.each([
    ['preflights', 'runExecutionPreflight', 'preflight'],
    ['execute-paused', 'executeMetaPausedCreation', 'execute-paused'],
  ])('keeps the static %s route ahead of the decision parameter', async (
    suffix, method, expectedRoute,
  ) => {
    const response = await fetch(
      `${await app.getUrl()}/operator/tenants/tenant-id/execution-authorizations/authorization-id/${suffix}`,
      { method: 'POST', headers: { authorization: 'Bearer test' } },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ route: expectedRoute });
    expect(service[method as keyof typeof service]).toHaveBeenCalled();
    expect(service.decideExecutionAuthorization).not.toHaveBeenCalled();
  });
});
