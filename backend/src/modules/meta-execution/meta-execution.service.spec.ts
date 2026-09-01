import { ConfigService } from '@nestjs/config';
import { ExecutionManifestOperationV1 } from '../../domain/contracts/execution-manifest';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { MetaExecutionService } from './meta-execution.service';

describe('MetaExecutionService', () => {
  const service = () => new MetaExecutionService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new ConfigService(),
  );

  it('accepts configured PAUSED while Meta effective status is still transient', () => {
    const paused = (service() as unknown as {
      paused: (configured?: string, effective?: string) => boolean;
    }).paused;

    expect(paused('PAUSED', 'IN_PROCESS')).toBe(true);
    expect(paused('PAUSED', 'PENDING_REVIEW')).toBe(true);
    expect(paused('ACTIVE', 'CAMPAIGN_PAUSED')).toBe(false);
  });

  it('parses city, state, country and radius as one Meta city target', () => {
    const targets = (service() as unknown as {
      geographyTargets: (value: string) => Array<{ city: string; radius: number }>;
    }).geographyTargets('Campina Grande, PB, BR (40 km)');

    expect(targets).toEqual([{ city: 'Campina Grande', radius: 40 }]);
  });

  it('parses multiple human geography entries without treating state or country as cities', () => {
    const targets = (service() as unknown as {
      geographyTargets: (value: string) => Array<{ city: string; radius: number }>;
    }).geographyTargets(
      'João Pessoa, PB, Brasil (40 km); Recife, PE, Brasil (30 km)',
    );

    expect(targets).toEqual([
      { city: 'João Pessoa', radius: 40 },
      { city: 'Recife', radius: 30 },
    ]);
  });

  it('removes the human include instruction before resolving Meta cities', () => {
    const targets = (service() as unknown as {
      geographyTargets: (value: string) => Array<{ city: string; radius: number }>;
    }).geographyTargets(
      'Incluir João Pessoa, PB, Brasil (40 km); Incluir Recife, PE, Brasil (40 km)',
    );

    expect(targets).toEqual([
      { city: 'João Pessoa', radius: 40 },
      { city: 'Recife', radius: 40 },
    ]);
  });

  it('uses the configured default radius for compact city-state notation', () => {
    const parser = new MetaExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ConfigService({ META_CITY_RADIUS_KM: '35' }),
    );
    const targets = (parser as unknown as {
      geographyTargets: (value: string) => Array<{ city: string; radius: number }>;
    }).geographyTargets('Campina Grande - PB');

    expect(targets).toEqual([{ city: 'Campina Grande', radius: 35 }]);
  });

  it('reconciles a failed external ad set only after an authenticated PAUSED read', async () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const manifestId = '33333333-3333-4333-8333-333333333333';
    const campaignId = '44444444-4444-4444-8444-444444444444';
    const planId = '55555555-5555-4555-8555-555555555555';
    const operationKey = 'operation:ad-set';
    const manifests = {
      findById: jest.fn().mockResolvedValue({
        executionManifestId: manifestId,
        executionPlanId: planId,
        campaignId,
        planHash: 'p'.repeat(64),
        operations: [{ operationKey, objectType: 'ad_set' }],
      }),
    };
    const plans = { findById: jest.fn().mockResolvedValue({
      executionPlanId: planId,
      planHash: 'p'.repeat(64),
      meta: { connectionId: '66666666-6666-4666-8666-666666666666' },
    }) };
    const connections = { findById: jest.fn().mockResolvedValue({
      status: 'ready', credentialRef: 'vault:meta',
    }) };
    const protocol = {
      metaWriteValidationProtocolId: '77777777-7777-4777-8777-777777777777',
      tenantId,
      campaignId,
      executionManifestId: manifestId,
      executionPlanId: planId,
      protocolHash: 'h'.repeat(64),
      status: 'external_validation_failed',
      correlationId: '88888888-8888-4888-8888-888888888888',
      execution: { operations: [{
        operationKey,
        objectType: 'ad_set',
        status: 'failed',
        externalObjectId: '120253269336290359',
        observedStatus: 'IN_PROCESS',
        normalizedError: 'VALIDATION',
      }] },
    };
    const protocols = {
      latestForManifest: jest.fn().mockResolvedValue(protocol),
      updateExecution: jest.fn().mockImplementation(async (value) => value),
    };
    const adapter = { read: jest.fn().mockResolvedValue({
      success: true,
      data: {
        id: '120253269336290359',
        configuredStatus: 'PAUSED',
        effectiveStatus: 'IN_PROCESS',
      },
      observedAt: '2026-08-26T20:00:00.000Z',
    }) };
    const reconciler = new MetaExecutionService(
      manifests as never,
      plans as never,
      connections as never,
      protocols as never,
      {} as never,
      {} as never,
      adapter as never,
      new ConfigService(),
    );

    const result = await reconciler.reconcileFailedPausedObjects(
      tenantId, manifestId, 'operator:warison',
    );

    expect(adapter.read).toHaveBeenCalledWith(
      tenantId, 'vault:meta', '120253269336290359', true,
    );
    expect(result?.execution?.operations[0]).toEqual(expect.objectContaining({
      status: 'succeeded', observedStatus: 'PAUSED',
      externalObjectId: '120253269336290359',
    }));
    expect(result?.execution?.operations[0].normalizedError).toBeUndefined();
    expect(protocols.updateExecution).toHaveBeenCalledTimes(1);
  });

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

  it('uses the Meta Click-to-WhatsApp creative contract without embedding a phone link', () => {
    const service = new MetaExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ConfigService({
        CONTEXT_ADS_PUBLIC_BASE_URL: 'https://panel.example.com',
      }),
    );
    const operation = {
      objectType: 'creative',
      idempotencyKey: 'b'.repeat(64),
    } as ExecutionManifestOperationV1;
    const request = (service as unknown as {
      requestFor: (...args: unknown[]) => { edge: string; params: Record<string, unknown> };
    }).requestFor(
      operation,
      {
        copy: {
          primaryText: 'Conheça nossa coleção.',
          headline: 'Fale conosco no WhatsApp',
          description: 'Atendimento personalizado.',
          whatsappMessage: 'Olá! Quero conhecer os modelos.',
        },
        asset: { storageRef: '/media/creative-1.png', mimeType: 'image/png' },
      },
      {} as ExecutionPlanV1,
      {},
      '100457068314696',
      '1002133529311219',
      [],
    );

    expect(request.edge).toBe('adcreatives');
    expect(request.params).toEqual(expect.objectContaining({
      object_story_spec: {
        page_id: '100457068314696',
        link_data: {
          link: 'https://api.whatsapp.com/send',
          picture: 'https://panel.example.com/media/creative-1.png',
          message: 'Conheça nossa coleção.',
          name: 'Fale conosco no WhatsApp',
          description: 'Atendimento personalizado.',
          call_to_action: {
            type: 'WHATSAPP_MESSAGE',
            value: { app_destination: 'WHATSAPP' },
          },
        },
      },
    }));
    expect(JSON.stringify(request.params)).not.toContain('wa.me');
    expect(JSON.stringify(request.params)).not.toContain('1002133529311219');
  });

  it('uses an uploaded Meta video id instead of treating MP4 media as a picture', () => {
    const operation = {
      objectType: 'creative',
      idempotencyKey: 'c'.repeat(64),
    } as ExecutionManifestOperationV1;
    const request = (service() as unknown as {
      requestFor: (...args: unknown[]) => { edge: string; params: Record<string, unknown> };
    }).requestFor(
      operation,
      {
        copy: { primaryText: 'Veja os modelos.', headline: 'Fale no WhatsApp' },
        asset: { storageRef: 'https://media.example/video.mp4', mimeType: 'video/mp4' },
      },
      {} as ExecutionPlanV1,
      {},
      '100457068314696',
      '1002133529311219',
      [],
      '998877665544',
    );

    expect(request.params).toEqual(expect.objectContaining({
      object_story_spec: {
        page_id: '100457068314696',
        video_data: expect.objectContaining({
          video_id: '998877665544',
          message: 'Veja os modelos.',
          title: 'Fale no WhatsApp',
        }),
      },
    }));
    expect(JSON.stringify(request.params)).not.toContain('picture');
    expect(JSON.stringify(request.params)).not.toContain('video.mp4');
  });
});
