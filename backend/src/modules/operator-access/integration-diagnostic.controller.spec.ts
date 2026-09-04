import { UnauthorizedException } from '@nestjs/common';
import { IntegrationDiagnosticController } from './integration-diagnostic.controller';

describe('IntegrationDiagnosticController', () => {
  const packageId = '0fc65970-05f1-4258-a28e-a6c411e9f676';
  const tenantId = '11111111-1111-4111-8111-111111111111';

  function workspace() {
    return {
      operator: {
        subject: 'operator:test',
        provider: 'bootstrap_token' as const,
        authenticatedAt: new Date().toISOString(),
      },
      tenants: [{
        tenantId,
        displayName: 'Test Tenant',
        role: 'owner' as const,
        permissions: ['view_workspace', 'manage_campaign_preparation'] as any,
        membershipId: '22222222-2222-4222-8222-222222222222',
      }],
      boundaries: {
        tenantAccessDerivedFromMembership: true,
        publicationAuthorized: false,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  function defaultConnections() {
    return {
      selectedExecutionTarget: jest.fn().mockResolvedValue({
        tenantId,
        connectionId: '33333333-3333-4333-8333-333333333333',
        adAccountId: 'act_123',
        displayName: 'Conta Rosa Vip',
        selectedAssets: [
          { assetType: 'ad_account', externalId: 'act_123', displayName: 'Conta Rosa Vip' },
          { assetType: 'facebook_page', externalId: '10', displayName: 'Rosa Vip' },
          { assetType: 'whatsapp', externalId: '20', displayName: '83986553047' },
        ],
        observedAt: '2026-09-04T11:00:00.000Z',
        boundaries: {
          selectedDiscoverySnapshotOnly: true,
          credentialExposed: false,
          publicationAuthorized: false,
          externalWritesAllowed: false,
          externalWritesPerformed: false,
        },
      }),
    };
  }

  function controller(
    access: any,
    packages: any,
    plans?: any,
    capabilities?: any,
    connections?: any,
  ) {
    return new IntegrationDiagnosticController(
      access,
      packages,
      plans ?? { latest: jest.fn() },
      capabilities ?? { validateForExecution: jest.fn() },
      connections ?? defaultConnections(),
    );
  }

  it('returns a readable 200-style diagnostic when the Bearer token mismatches', async () => {
    const access = {
      listTenants: jest.fn().mockRejectedValue(new UnauthorizedException({
        code: 'invalid_operator_credentials',
        message: 'Operator authentication failed',
      })),
    } as any;
    const packages = { get: jest.fn() } as any;
    const subject = controller(access, packages);

    await expect(subject.diagnose({}, 'Bearer wrong')).resolves.toMatchObject({
      action_status: 'DIAGNOSTIC_COMPLETE',
      overall_status: 'AUTH_TOKEN_MISMATCH',
      authentication: {
        status: 'FAILED',
        server_credential_status: 'CONFIGURED_BUT_REQUEST_TOKEN_MISMATCH',
      },
      meta_selected_target: { status: 'NOT_RUN' },
      next_action: 'SYNC_GPT_BEARER_TOKEN_WITH_RENDER',
      boundaries: {
        publication_authorized: false,
        delivery_authorized: false,
        spend_authorized: false,
      },
    });
    expect(packages.get).not.toHaveBeenCalled();
  });

  it('resolves the single tenant without asking the user for tenantId', async () => {
    const access = { listTenants: jest.fn().mockResolvedValue(workspace()) } as any;
    const packages = { get: jest.fn() } as any;
    const subject = controller(access, packages);

    await expect(subject.diagnose({}, 'Bearer valid')).resolves.toMatchObject({
      overall_status: 'READY_FOR_CAMPAIGN_FLOW',
      authentication: { status: 'OK' },
      tenant_resolution: {
        status: 'OK',
        authorized_tenant_count: 1,
        required_permissions_present: true,
      },
      package: { status: 'NOT_REQUESTED' },
      meta_selected_target: { status: 'NOT_RUN' },
      meta_capability_validation: { status: 'NOT_RUN' },
    });
  });

  it('reports a persisted package that still needs creative preparation and reads its selected target', async () => {
    const access = { listTenants: jest.fn().mockResolvedValue(workspace()) } as any;
    const packages = {
      get: jest.fn().mockResolvedValue({
        package_id: packageId,
        campaign_id: packageId,
        context: { status: 'ready_for_generation' },
        creative: null,
        execution_plan: {
          execution_plan_id: '5308c5b6-7c45-42d4-831e-ee7df642d5e6',
          status: 'paused',
          target_binding_status: 'BOUND',
        },
        plan_approval: null,
        next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      }),
    } as any;
    const plans = { latest: jest.fn() } as any;
    const capabilities = { validateForExecution: jest.fn() } as any;
    const connections = defaultConnections();
    const subject = controller(access, packages, plans, capabilities, connections);

    await expect(subject.diagnose({ package_id: packageId }, 'Bearer valid')).resolves.toMatchObject({
      overall_status: 'PACKAGE_CREATIVE_PREPARATION_REQUIRED',
      package: {
        status: 'FOUND',
        package_id: packageId,
        creative_status: null,
        target_binding_status: 'BOUND',
      },
      meta_selected_target: {
        status: 'OK',
        ad_account: { id: 'act_123', display_name: 'Conta Rosa Vip' },
        facebook_page: { id: '10', display_name: 'Rosa Vip' },
        whatsapp: { id: '20', display_name: '83986553047' },
      },
      meta_capability_validation: { status: 'NOT_RUN' },
      next_action: 'PREPARE_CREATIVE_PACKAGE',
    });
    expect(packages.get).toHaveBeenCalledWith(tenantId, packageId);
    expect(connections.selectedExecutionTarget).toHaveBeenCalledWith(tenantId);
    expect(plans.latest).not.toHaveBeenCalled();
    expect(capabilities.validateForExecution).not.toHaveBeenCalled();
  });

  it('validates execution capabilities read-only for a bound package with creative content', async () => {
    const access = { listTenants: jest.fn().mockResolvedValue(workspace()) } as any;
    const packages = {
      get: jest.fn().mockResolvedValue({
        package_id: packageId,
        campaign_id: packageId,
        context: { status: 'ready_for_generation' },
        creative: { status: 'needs_review' },
        execution_plan: {
          execution_plan_id: '5308c5b6-7c45-42d4-831e-ee7df642d5e6',
          status: 'draft',
          target_binding_status: 'BOUND',
        },
        plan_approval: null,
        next_action: 'REVIEW_AND_APPROVE_CREATIVE_PACKAGE',
      }),
    } as any;
    const plans = {
      latest: jest.fn().mockResolvedValue({
        meta: {
          connectionId: '33333333-3333-4333-8333-333333333333',
          requiredCapabilities: ['CREATE_CAMPAIGN', 'CREATE_ADSET'],
        },
      }),
    } as any;
    const capabilities = {
      validateForExecution: jest.fn().mockResolvedValue({
        success: true,
        observedAt: '2026-09-01T12:00:00.000Z',
        retryable: false,
        data: [
          { capabilityType: 'CREATE_CAMPAIGN', status: 'available', restrictions: [] },
          { capabilityType: 'CREATE_ADSET', status: 'available', restrictions: [] },
        ],
      }),
    } as any;
    const subject = controller(access, packages, plans, capabilities);

    await expect(subject.diagnose({ package_id: packageId }, 'Bearer valid')).resolves.toMatchObject({
      overall_status: 'PACKAGE_CREATIVE_REVIEW_REQUIRED',
      meta_selected_target: {
        status: 'OK',
        ad_account: { id: 'act_123' },
        facebook_page: { id: '10' },
        whatsapp: { id: '20' },
      },
      meta_capability_validation: {
        status: 'OK',
        capabilities: [
          { capability: 'CREATE_CAMPAIGN', status: 'available' },
          { capability: 'CREATE_ADSET', status: 'available' },
        ],
      },
    });
    expect(capabilities.validateForExecution).toHaveBeenCalledWith(
      tenantId,
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('fails closed when the selected Meta target cannot be read', async () => {
    const access = { listTenants: jest.fn().mockResolvedValue(workspace()) } as any;
    const packages = {
      get: jest.fn().mockResolvedValue({
        package_id: packageId,
        campaign_id: packageId,
        context: { status: 'ready_for_generation' },
        creative: { status: 'approved' },
        execution_plan: {
          execution_plan_id: '5308c5b6-7c45-42d4-831e-ee7df642d5e6',
          status: 'approved',
          target_binding_status: 'BOUND',
        },
        plan_approval: { status: 'approved' },
        next_action: 'PREPARE_PAUSED_CREATION',
      }),
    } as any;
    const plans = {
      latest: jest.fn().mockResolvedValue({
        meta: {
          connectionId: '33333333-3333-4333-8333-333333333333',
          requiredCapabilities: [],
        },
      }),
    } as any;
    const capabilities = {
      validateForExecution: jest.fn().mockResolvedValue({
        success: true,
        observedAt: '2026-09-04T11:00:00.000Z',
        retryable: false,
        data: [],
      }),
    } as any;
    const connections = {
      selectedExecutionTarget: jest.fn().mockRejectedValue(
        new Error('Exactly one discovered ad account must be selected'),
      ),
    } as any;
    const subject = controller(access, packages, plans, capabilities, connections);

    await expect(subject.diagnose({ package_id: packageId }, 'Bearer valid')).resolves.toMatchObject({
      overall_status: 'META_TARGET_DIAGNOSTIC_REQUIRED',
      meta_selected_target: {
        status: 'BLOCKED',
        code: 'selected_meta_target_unavailable',
      },
      next_action: 'FIX_SELECTED_META_TARGET',
      boundaries: {
        external_writes_allowed: false,
        external_writes_performed: false,
        spend_authorized: false,
      },
    });
  });
});
