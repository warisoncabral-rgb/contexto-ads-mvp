import { ConfigService } from '@nestjs/config';
import { ExecutionManifestOperationV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { MetaExecutionService } from './meta-execution.service';

describe('MetaExecutionService', () => {
  it('keeps campaign creation paused and disables ad-set budget sharing explicitly', () => {
    const service = new MetaExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ConfigService(),
    );
    const operation = {
      objectType: 'campaign',
      idempotencyKey: 'a'.repeat(64),
    } as ExecutionManifestOperationV1;
    const request = (service as unknown as {
      requestFor: (...args: unknown[]) => { edge: string; params: Record<string, unknown> };
    }).requestFor(
      operation,
      { name: 'Rosa VIP', objective: 'OUTCOME_LEADS' },
      {} as ExecutionPlanV1,
      {},
      '100457068314696',
      '1002133529311219',
      [],
    );

    expect(request.edge).toBe('campaigns');
    expect(request.params).toEqual(expect.objectContaining({
      objective: 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    }));
  });
});
