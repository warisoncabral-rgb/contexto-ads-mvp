import { OperatorStrategyHandoffController } from './operator-strategy-handoff.controller';

describe('OperatorStrategyHandoffController', () => {
  const currentStrategy = {
    business_name: 'Rosa VIP Calçados',
    offer_name: 'Calçados femininos no atacado',
    offer_description: 'Calçados femininos para lojistas, empreendedores e revendedores que buscam qualidade, variedade e acabamento.',
    commercial_conditions: {
      minimum_order_brl: 500,
      closed_grade_pairs: 12,
      closed_grade_sizes: '34-39',
      closed_grade_composition: '1/2/3/3/2/1',
      free_delivery_on_scheduled_route_only: true,
    },
    campaign_objective: 'LEADS',
    conversion_destination: 'WHATSAPP',
    campaign_goal_description: 'Gerar conversas qualificadas no WhatsApp.',
    audience_description: 'Lojistas, revendedores e empreendedores com perfil mais consolidado, focados em qualidade e valor percebido.',
    locations: [
      { city: 'João Pessoa', state: 'PB', country: 'BR', radius_km: 40, include: true },
      { city: 'Recife', state: 'PE', country: 'BR', radius_km: 40, include: true },
    ],
    budget_type: 'DAILY',
    budget_amount: 20,
    currency: 'BRL',
    duration_days: 7,
    creative_brief: 'Primeiro teste: vídeo atual sem edição como peça principal + arte estática Destaques Rosavip. Preservar a arte de grade fechada de 12 pares para teste posterior.',
    strategy_status: 'COMPLETE',
    handoff_status: 'READY_FOR_GENERATOR',
  };

  function dependencies() {
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
    const contexts = {
      create: jest.fn(async () => ({
        packageId: '99999999-9999-4999-8999-999999999999',
        tenantId: '22222222-2222-4222-8222-222222222222',
        campaignId: '11111111-1111-4111-8111-111111111111',
        version: 1,
        status: 'ready_for_generation',
        contentHash: 'a'.repeat(64),
      })),
    };
    const plans = {
      generate: jest.fn(async () => ({
        executionPlanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        planHash: 'b'.repeat(64),
        status: 'draft',
      })),
    };
    const simulations = {
      bindTarget: jest.fn(async () => ({
        executionPlanId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        planHash: 'c'.repeat(64),
        status: 'draft',
      })),
    };
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
    const controller = new OperatorStrategyHandoffController(
      access as any,
      contexts as any,
      plans as any,
      simulations as any,
      connections as any,
    );
    return { controller, access, contexts, plans, simulations, connections };
  }

  it('accepts the approved strategy without client id, package id, copy or media metadata', async () => {
    const { controller, contexts, plans, simulations } = dependencies();

    const result = await controller.submitActionEnvelope(
      currentStrategy,
      undefined,
      'stable-operator-key',
    );

    expect(result).toMatchObject({
      action_status: 'ACCEPTED',
      package_id: '11111111-1111-4111-8111-111111111111',
      campaign_id: '11111111-1111-4111-8111-111111111111',
      creative_package_id: null,
      creative_package_status: 'PENDING_CREATIVE_PACKAGE',
      execution_plan_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      target_binding_status: 'BOUND',
      next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      boundaries: {
        persisted: true,
        creative_package_persisted: false,
        execution_plan_created: true,
        technical_target_auto_resolved: true,
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
        spend_authorized: false,
        delivery_authorized: false,
      },
    });

    expect(contexts.create).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({
        businessName: 'Rosa VIP Calçados',
        objective: 'leads',
        destination: 'whatsapp',
        audience: currentStrategy.audience_description,
        geography: 'Incluir João Pessoa, PB, BR (40 km); Incluir Recife, PE, BR (40 km)',
        budget: { mode: 'daily', amountMinor: 2000, currency: 'BRL' },
        durationDays: 7,
        offer: expect.stringContaining('Briefing criativo aprovado: Primeiro teste: vídeo atual sem edição'),
      }),
      'operator:test',
    );
    expect(plans.generate).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      1,
      'operator:test',
    );
    expect(simulations.bindTarget).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '673dbb65-e187-4d80-8751-772d6e0156b3',
      'act_929361834160386',
    );
  });

  it('returns a readable rejection without side effects when the strategy is incomplete', async () => {
    const { controller, contexts, plans, simulations } = dependencies();

    const result = await controller.submitActionEnvelope(
      { ...currentStrategy, strategy_status: 'IN_REVIEW' },
      'Bearer secret',
    );

    expect(result).toMatchObject({
      action_status: 'REJECTED',
      http_status: 409,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    });
    expect(contexts.create).not.toHaveBeenCalled();
    expect(plans.generate).not.toHaveBeenCalled();
    expect(simulations.bindTarget).not.toHaveBeenCalled();
  });

  it('rejects invalid budgets before persistence', async () => {
    const { controller, contexts } = dependencies();

    const result = await controller.submitActionEnvelope(
      { ...currentStrategy, budget_amount: 0 },
      'Bearer secret',
    );

    expect(result.action_status).toBe('REJECTED');
    expect(result.http_status).toBe(400);
    expect(contexts.create).not.toHaveBeenCalled();
  });
});
