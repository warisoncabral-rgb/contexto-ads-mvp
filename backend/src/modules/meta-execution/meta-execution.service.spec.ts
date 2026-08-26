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
        asset: { storageRef: '/media/creative-1.png' },
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
});
