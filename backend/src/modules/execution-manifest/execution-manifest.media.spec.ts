import { ConflictException } from '@nestjs/common';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { ExecutionManifestService } from './execution-manifest.service';

describe('ExecutionManifestService creative media guard', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const executionPlanId = '33333333-3333-4333-8333-333333333333';

  function plan(storageRef: string): ExecutionPlanV1 {
    return {
      executionPlanId,
      tenantId,
      campaignId,
      campaignPackageVersion: 1,
      planVersion: '1.0',
      correlationId: '44444444-4444-4444-8444-444444444444',
      planHash: 'a'.repeat(64),
      idempotencyKey: 'b'.repeat(64),
      status: 'draft',
      meta: { assetBindings: [], requiredCapabilities: [] },
      objectsToCreate: [{
        internalObjectId: `${campaignId}:creative:variant_1`,
        type: 'creative',
        dependsOn: [],
        logicalConfig: {
          copyStatus: 'approved',
          asset: {
            assetId: 'creative-1',
            mimeType: 'image/jpeg',
            storageRef,
            sha256: 'c'.repeat(64),
            width: 1080,
            height: 1350,
          },
        },
      }],
      readiness: [],
      autonomy: { level: 'A0', approvalRequired: true },
      financials: {
        currency: 'BRL', budgetMode: 'daily', configuredAmountMinor: 1000,
        maximumPlannedSpendMinor: 7000, calculation: '1000 x 7 days',
      },
      decisions: [], risks: [],
      externalEffects: { writesAllowed: false, writesPerformed: false },
      createdAt: '2026-09-01T12:00:00.000Z',
    };
  }

  it('stops before readiness when an approved creative is only a legacy placeholder', async () => {
    const legacy = plan('asset://rosavip/legacy/media-01');
    const readiness = { generate: jest.fn() } as any;
    const plans = {
      findById: jest.fn().mockResolvedValue(legacy),
      latest: jest.fn().mockResolvedValue(legacy),
    } as any;
    const service = new ExecutionManifestService(
      readiness,
      plans,
      {} as any,
      { saveIdempotent: jest.fn() } as any,
    );

    await expect(service.prepare(tenantId, campaignId, executionPlanId))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: 'creative_media_not_executable' }),
      });
    expect(readiness.generate).not.toHaveBeenCalled();
  });

  it('allows real HTTPS creative media to continue to normal readiness checks', async () => {
    const executable = plan(
      'https://contexto-ads-validation-api.onrender.com/v1/public/media/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
    );
    const readiness = {
      generate: jest.fn().mockResolvedValue({
        readinessDecisionId: '55555555-5555-4555-8555-555555555555',
        status: 'action_required',
        nextAction: 'Continue normal readiness.',
      }),
    } as any;
    const plans = {
      findById: jest.fn().mockResolvedValue(executable),
      latest: jest.fn().mockResolvedValue(executable),
    } as any;
    const service = new ExecutionManifestService(
      readiness,
      plans,
      {} as any,
      { saveIdempotent: jest.fn() } as any,
    );

    await expect(service.prepare(tenantId, campaignId, executionPlanId))
      .rejects.toBeInstanceOf(ConflictException);
    expect(readiness.generate).toHaveBeenCalledTimes(1);
  });
});
