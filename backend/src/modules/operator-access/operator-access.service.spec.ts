import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { OperatorTenantMembershipV1 } from '../../domain/contracts/operator-access';
import {
  InvalidOperatorCredentialsError,
  OperatorAuthenticationUnavailableError,
  OperatorIdentityPort,
} from '../../domain/ports/operator-identity.port';
import {
  AuditRepository,
  AuditTimelineRepository,
  OperatorPlanSelectionRepository,
  OperatorCampaignContextSelectionRepository,
  OperationalReadinessRepository,
  OperatorTenantMembershipRepository,
} from '../../domain/ports/repositories';
import { ExecutionPlanV1 } from '../../domain/contracts/execution-plan';
import { OperatorAccessService } from './operator-access.service';
import { CampaignContextService } from '../campaign-context/campaign-context.service';
import { ExecutionPlanService } from '../execution-plan/execution-plan.service';
import { ApprovalService } from '../approval/approval.service';
import { OperationalReadinessService } from '../operational-readiness/operational-readiness.service';
import { ExecutionSimulationService } from '../execution-simulation/execution-simulation.service';
import { CreativePackageService } from '../creative-package/creative-package.service';
import { ExecutionManifestService } from '../execution-manifest/execution-manifest.service';
import { ExecutionAuthorizationService } from '../execution-authorization/execution-authorization.service';
import { KillSwitchService } from '../kill-switch/kill-switch.service';
import { MetaWriteValidationService } from '../meta-write-validation/meta-write-validation.service';

describe('OperatorAccessService', () => {
  const principal = {
    subject: 'operator:warison',
    provider: 'bootstrap_token' as const,
    authenticatedAt: '2026-08-24T15:00:00.000Z',
  };
  const membershipsFixture: OperatorTenantMembershipV1[] = [
    {
      membershipId: '11111111-1111-4111-8111-111111111111',
      operatorSubject: principal.subject,
      tenantId: '22222222-2222-4222-8222-222222222222',
      tenantDisplayName: 'Rosa VIP Calçados',
      role: 'owner',
      status: 'active',
      createdAt: '2026-08-24T14:00:00.000Z',
    },
    {
      membershipId: '33333333-3333-4333-8333-333333333333',
      operatorSubject: principal.subject,
      tenantId: '44444444-4444-4444-8444-444444444444',
      tenantDisplayName: 'Cliente leitura',
      role: 'viewer',
      status: 'active',
      createdAt: '2026-08-24T14:00:00.000Z',
    },
  ];
  let identity: jest.Mocked<OperatorIdentityPort>;
  let memberships: jest.Mocked<OperatorTenantMembershipRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let auditTimeline: jest.Mocked<AuditTimelineRepository>;
  let plans: jest.Mocked<OperatorPlanSelectionRepository>;
  let readiness: jest.Mocked<OperationalReadinessRepository>;
  let contextSelection: jest.Mocked<OperatorCampaignContextSelectionRepository>;
  let campaignContexts: jest.Mocked<Pick<CampaignContextService, 'create' | 'appendVersion'>>;
  let executionPlans: jest.Mocked<Pick<ExecutionPlanService, 'generate'>>;
  let approvalService: jest.Mocked<Pick<ApprovalService, 'request' | 'get' | 'approve' | 'reject' | 'revoke'>>;
  let operationalReadiness: jest.Mocked<Pick<OperationalReadinessService, 'generate'>>;
  let executionSimulations: jest.Mocked<Pick<ExecutionSimulationService, 'bindTarget'>>;
  let creativePackages: jest.Mocked<Pick<CreativePackageService, 'appendVersion' | 'approve' | 'latest'>>;
  let executionManifests: jest.Mocked<Pick<ExecutionManifestService, 'prepare' | 'latest'>>;
  let executionAuthorizations: jest.Mocked<Pick<ExecutionAuthorizationService, 'request' | 'get' | 'approve' | 'reject' | 'revoke' | 'preflight'>>;
  let killSwitch: jest.Mocked<Pick<KillSwitchService, 'changeTenant' | 'changeCampaign' | 'effective'>>;
  let metaWriteValidation: jest.Mocked<Pick<MetaWriteValidationService, 'prepare' | 'latest'>>;
  let service: OperatorAccessService;

  beforeEach(() => {
    identity = {
      isAvailable: jest.fn().mockReturnValue(true),
      authenticate: jest.fn().mockResolvedValue(principal),
    };
    memberships = {
      listActiveForSubject: jest.fn().mockResolvedValue(membershipsFixture),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    auditTimeline = { listForCampaign: jest.fn().mockResolvedValue([]) };
    plans = {
      listLatestForTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
    };
    readiness = {
      saveIdempotent: jest.fn(),
      latestForPlan: jest.fn(),
    };
    contextSelection = { listLatestForTenant: jest.fn().mockResolvedValue([]) };
    campaignContexts = {
      create: jest.fn(),
      appendVersion: jest.fn(),
    };
    executionPlans = { generate: jest.fn() };
    approvalService = {
      request: jest.fn(), get: jest.fn(), approve: jest.fn(), reject: jest.fn(), revoke: jest.fn(),
    };
    operationalReadiness = { generate: jest.fn().mockResolvedValue({
      readinessDecisionId: '88888888-8888-4888-8888-888888888888',
      boundaries: { externalWritesAllowed: false },
    } as never) };
    executionSimulations = { bindTarget: jest.fn() };
    creativePackages = { appendVersion: jest.fn(), approve: jest.fn(), latest: jest.fn() };
    executionManifests = { prepare: jest.fn(), latest: jest.fn() };
    executionAuthorizations = { request: jest.fn(), get: jest.fn(), approve: jest.fn(),
      reject: jest.fn(), revoke: jest.fn(), preflight: jest.fn() };
    killSwitch = { changeTenant: jest.fn(), changeCampaign: jest.fn(), effective: jest.fn() };
    metaWriteValidation = { prepare: jest.fn(), latest: jest.fn() };
    service = new OperatorAccessService(
      identity,
      memberships,
      audit,
      auditTimeline,
      plans,
      readiness,
      contextSelection,
      campaignContexts as unknown as CampaignContextService,
      executionPlans as unknown as ExecutionPlanService,
      approvalService as unknown as ApprovalService,
      operationalReadiness as unknown as OperationalReadinessService,
      executionSimulations as unknown as ExecutionSimulationService,
      creativePackages as unknown as CreativePackageService,
      executionManifests as unknown as ExecutionManifestService,
      executionAuthorizations as unknown as ExecutionAuthorizationService,
      killSwitch as unknown as KillSwitchService,
      metaWriteValidation as unknown as MetaWriteValidationService,
    );
  });

  it('builds a membership-scoped portfolio ordered by deterministic urgency', async () => {
    const [owner, viewer] = membershipsFixture;
    const ownerPlan = {
      tenantId: owner.tenantId, campaignId: '55555555-5555-4555-8555-555555555555',
      executionPlanId: '66666666-6666-4666-8666-666666666666', status: 'approved',
      financials: { maximumPlannedSpendMinor: 12000, currency: 'BRL' },
      createdAt: '2026-08-24T17:00:00.000Z',
    } as ExecutionPlanV1;
    const viewerPlan = {
      tenantId: viewer.tenantId, campaignId: '77777777-7777-4777-8777-777777777777',
      executionPlanId: '88888888-8888-4888-8888-888888888888', status: 'draft',
      financials: { maximumPlannedSpendMinor: 5000, currency: 'BRL' },
      createdAt: '2026-08-24T16:00:00.000Z',
    } as ExecutionPlanV1;
    plans.listLatestForTenant.mockImplementation(async (tenantId) =>
      tenantId === owner.tenantId ? [ownerPlan] : [viewerPlan]);
    readiness.latestForPlan.mockImplementation(async (tenantId) => tenantId === owner.tenantId
      ? ({ tenantId: owner.tenantId, campaignId: ownerPlan.campaignId,
        executionPlanId: ownerPlan.executionPlanId, status: 'blocked',
        headline: 'Ambiente bloqueado', nextAction: 'Validar ambiente.', blockers: [{}, {}],
        generatedAt: '2026-08-24T18:00:00.000Z' } as never)
      : null);

    const result = await service.portfolio('Bearer token');

    expect(result.items.map((item) => item.readinessStatus)).toEqual(['blocked', 'not_evaluated']);
    expect(result.items[0]).toEqual(expect.objectContaining({
      tenantDisplayName: 'Rosa VIP Calçados', blockerCount: 2,
      maximumPlannedSpendMinor: 12000, currency: 'BRL',
    }));
    expect(result.summary).toEqual({ authorizedTenantCount: 2, campaignCount: 2,
      blockedCount: 1, actionRequiredCount: 0, readyCount: 0, notEvaluatedCount: 1 });
    expect(result.boundaries).toEqual(expect.objectContaining({
      tenantAccessDerivedFromMembership: true, priorityRuleIsDeterministic: true,
      externalWritesAllowed: false, externalWritesPerformed: false,
    }));
  });

  it('fails closed when a portfolio repository leaks another tenant scope', async () => {
    plans.listLatestForTenant.mockResolvedValueOnce([{
      tenantId: membershipsFixture[1].tenantId,
      campaignId: '55555555-5555-4555-8555-555555555555',
      executionPlanId: '66666666-6666-4666-8666-666666666666',
    } as ExecutionPlanV1]);

    await expect(service.portfolio('Bearer token')).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(readiness.latestForPlan).not.toHaveBeenCalled();
  });

  it('returns a sanitized campaign timeline after membership and plan verification', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const executionPlanId = '66666666-6666-4666-8666-666666666666';
    plans.findById.mockResolvedValueOnce({ tenantId, campaignId, executionPlanId } as ExecutionPlanV1);
    auditTimeline.listForCampaign.mockResolvedValueOnce([{
      auditEventId: '77777777-7777-4777-8777-777777777777', tenantId,
      correlationId: '88888888-8888-4888-8888-888888888888', actorType: 'user',
      actorId: 'sensitive-subject', eventType: 'campaign_plan_approved',
      objectType: 'plan_approval', objectId: '99999999-9999-4999-8999-999999999999',
      newState: { secret: 'must-not-leak' }, result: 'success',
      createdAt: '2026-08-24T18:00:00.000Z',
    }]);
    const result = await service.campaignTimeline(
      'Bearer token', tenantId, campaignId, executionPlanId,
    );
    expect(auditTimeline.listForCampaign).toHaveBeenCalledWith(tenantId, campaignId, 100);
    expect(result.items[0]).toEqual(expect.objectContaining({
      title: 'Plano aprovado', actor: 'Usuário autenticado',
      evidenceRef: 'plan_approval:99999999-9999-4999-8999-999999999999',
    }));
    expect(JSON.stringify(result)).not.toContain('sensitive-subject');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result.boundaries.secretsExposed).toBe(false);
  });

  it('does not reveal campaign history for another tenant or mismatched plan', async () => {
    await expect(service.campaignTimeline('Bearer token',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(auditTimeline.listForCampaign).not.toHaveBeenCalled();
  });

  it('protects the executor preflight and derives every actor from authentication', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const planId = '66666666-6666-4666-8666-666666666666';
    const manifestId = '77777777-7777-4777-8777-777777777777';
    const authorizationId = '88888888-8888-4888-8888-888888888888';
    executionManifests.prepare.mockResolvedValueOnce({ executionManifestId: manifestId } as never);
    executionAuthorizations.request.mockResolvedValueOnce({ executionAuthorizationId: authorizationId } as never);
    executionAuthorizations.approve.mockResolvedValueOnce({ status: 'approved' } as never);

    await service.prepareExecutionManifest('Bearer token', tenantId, campaignId, planId);
    await service.requestExecutionAuthorization('Bearer token', tenantId, manifestId);
    await service.decideExecutionAuthorization('Bearer token', tenantId, authorizationId, 'approve');

    expect(executionManifests.prepare).toHaveBeenCalledWith(
      tenantId, campaignId, planId, undefined,
    );
    expect(executionAuthorizations.request).toHaveBeenCalledWith(
      tenantId, manifestId, principal.subject,
    );
    expect(executionAuthorizations.approve).toHaveBeenCalledWith(
      tenantId, authorizationId, principal.subject,
    );
  });

  it('lets operators prepare but reserves execution decisions and safety controls for owners', async () => {
    const membership = { ...membershipsFixture[0], role: 'operator' as const };
    memberships.listActiveForSubject.mockResolvedValue([membership]);
    const tenantId = membership.tenantId;
    const manifestId = '77777777-7777-4777-8777-777777777777';
    executionAuthorizations.request.mockResolvedValueOnce({ executionAuthorizationId: manifestId } as never);
    await service.requestExecutionAuthorization('Bearer token', tenantId, manifestId);
    expect(executionAuthorizations.request).toHaveBeenCalled();

    await expect(service.decideExecutionAuthorization(
      'Bearer token', tenantId, manifestId, 'approve',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.changeKillSwitch(
      'Bearer token', tenantId, 'tenant', undefined, 'released', 'Teste controlado',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.prepareMetaWriteValidation(
      'Bearer token', tenantId, manifestId,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(executionAuthorizations.approve).not.toHaveBeenCalled();
    expect(killSwitch.changeTenant).not.toHaveBeenCalled();
    expect(metaWriteValidation.prepare).not.toHaveBeenCalled();
  });

  it('blocks viewers and cross-tenant requests before executor services are reached', async () => {
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const planId = '66666666-6666-4666-8666-666666666666';
    await expect(service.prepareExecutionManifest(
      'Bearer token', membershipsFixture[1].tenantId, campaignId, planId,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.latestExecutionManifest(
      'Bearer token', '99999999-9999-4999-8999-999999999999', planId,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(executionManifests.prepare).not.toHaveBeenCalled();
    expect(executionManifests.latest).not.toHaveBeenCalled();
  });

  it('derives creative authorship from authentication and reserves approval for owners', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const planId = '66666666-6666-4666-8666-666666666666';
    const executionPlan = { tenantId, campaignId, executionPlanId: planId };
    creativePackages.appendVersion.mockResolvedValueOnce({
      creativePackage: { contentHash: 'a'.repeat(64) }, executionPlan,
    } as never);
    const creative = { copies: [] };
    await service.appendCreativePackage('Bearer token', tenantId, campaignId, planId, creative);
    expect(creativePackages.appendVersion).toHaveBeenCalledWith(
      tenantId, campaignId, planId, creative, principal.subject,
    );
    expect(operationalReadiness.generate).toHaveBeenCalledWith(tenantId, campaignId, planId);

    memberships.listActiveForSubject.mockResolvedValueOnce([{ ...membershipsFixture[0], role: 'operator' }]);
    await expect(service.approveCreativePackage(
      'Bearer token', tenantId, campaignId, 1, 'a'.repeat(64),
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(creativePackages.approve).not.toHaveBeenCalled();
  });

  it('binds a discovered execution target only behind preparation permission', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const planId = '66666666-6666-4666-8666-666666666666';
    const connectionId = '77777777-7777-4777-8777-777777777777';
    executionSimulations.bindTarget.mockResolvedValueOnce({ executionPlanId: planId } as never);
    await service.bindExecutionTarget('Bearer token', tenantId, campaignId, planId,
      connectionId, 'act_123456');
    expect(executionSimulations.bindTarget).toHaveBeenCalledWith(
      tenantId, campaignId, planId, connectionId, 'act_123456',
    );

    await expect(service.bindExecutionTarget('Bearer token', membershipsFixture[1].tenantId,
      campaignId, planId, connectionId, 'act_123456'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets an operator request approval but reserves decisions for owners', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const planId = '66666666-6666-4666-8666-666666666666';
    approvalService.request.mockResolvedValueOnce({
      approvalId: '77777777-7777-4777-8777-777777777777', tenantId,
      campaignId, executionPlanId: planId, status: 'pending',
    } as never);

    await service.requestPlanApproval('Bearer token', tenantId, campaignId, planId);
    expect(approvalService.request).toHaveBeenCalledWith(
      tenantId, campaignId, planId, principal.subject,
    );
    expect(operationalReadiness.generate).toHaveBeenCalledWith(
      tenantId, campaignId, planId, expect.any(String),
    );

    memberships.listActiveForSubject.mockResolvedValueOnce([{ ...membershipsFixture[0], role: 'operator' }]);
    await expect(service.decidePlanApproval(
      'Bearer token', tenantId, '77777777-7777-4777-8777-777777777777', 'approve',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(approvalService.approve).not.toHaveBeenCalled();
  });

  it('binds owner decisions to the authenticated subject and validates the transition name', async () => {
    const tenantId = membershipsFixture[0].tenantId;
    const approvalId = '77777777-7777-4777-8777-777777777777';
    approvalService.approve.mockResolvedValueOnce({
      approvalId, tenantId, campaignId: '55555555-5555-4555-8555-555555555555',
      executionPlanId: '66666666-6666-4666-8666-666666666666', status: 'approved',
    } as never);

    await service.decidePlanApproval('Bearer token', tenantId, approvalId, 'approve');
    expect(approvalService.approve).toHaveBeenCalledWith(tenantId, approvalId, principal.subject);
    expect(operationalReadiness.generate).toHaveBeenCalledWith(
      tenantId, expect.any(String), expect.any(String), approvalId,
    );
    await expect(service.decidePlanApproval(
      'Bearer token', tenantId, approvalId, 'publish',
    )).rejects.toMatchObject({ response: expect.objectContaining({ code: 'invalid_approval_decision' }) });
  });

  it('derives tenant selection and permissions only from active memberships', async () => {
    const result = await service.listTenants('Bearer valid-token-value-with-32-characters');
    expect(identity.authenticate).toHaveBeenCalledWith(
      'Bearer valid-token-value-with-32-characters',
    );
    expect(memberships.listActiveForSubject).toHaveBeenCalledWith(principal.subject);
    expect(result.tenants).toEqual([
      expect.objectContaining({
        displayName: 'Rosa VIP Calçados',
        role: 'owner',
        permissions: expect.arrayContaining(['decide_approval', 'configure_tenant']),
      }),
      expect.objectContaining({
        displayName: 'Cliente leitura',
        role: 'viewer',
        permissions: ['view_workspace'],
      }),
    ]);
    expect(result.boundaries).toEqual({
      tenantAccessDerivedFromMembership: true,
      publicationAuthorized: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_tenant_access_listed',
      actorId: principal.subject,
      newState: expect.objectContaining({ externalWritesAllowed: false }),
    } as Partial<AuditEvent>));
  });

  it('returns no tenant when no membership exists and never guesses access', async () => {
    memberships.listActiveForSubject.mockResolvedValueOnce([]);
    const result = await service.listTenants('Bearer valid-token-value-with-32-characters');
    expect(result.tenants).toEqual([]);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('maps unavailable authentication to 503 before repository access', async () => {
    identity.authenticate.mockRejectedValueOnce(new OperatorAuthenticationUnavailableError());
    await expect(service.listTenants(undefined))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(memberships.listActiveForSubject).not.toHaveBeenCalled();
  });

  it('maps all rejected credentials to a sanitized 401', async () => {
    identity.authenticate.mockRejectedValueOnce(new InvalidOperatorCredentialsError());
    await expect(service.listTenants('Bearer wrong-token-value-with-32-characters'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(memberships.listActiveForSubject).not.toHaveBeenCalled();
  });

  it('fails closed if access auditing cannot be persisted', async () => {
    audit.append.mockRejectedValueOnce(new Error('database detail'));
    await expect(service.listTenants('Bearer valid-token-value-with-32-characters'))
      .rejects.toThrow('database detail');
  });

  it('lists only the latest plans after verifying tenant membership', async () => {
    const plan = {
      tenantId: membershipsFixture[0].tenantId,
      campaignId: '55555555-5555-4555-8555-555555555555',
      executionPlanId: '66666666-6666-4666-8666-666666666666',
      planVersion: '1.0',
      planHash: 'a'.repeat(64),
      status: 'ready_for_approval',
      campaignPackageVersion: 2,
      financials: { maximumPlannedSpendMinor: 42000, currency: 'BRL', calculation: '6000 x 7 days' },
      autonomy: { level: 'A0', approvalRequired: true },
      createdAt: '2026-08-24T16:00:00.000Z',
    } as ExecutionPlanV1;
    plans.listLatestForTenant.mockResolvedValueOnce([plan]);

    const result = await service.listTenantPlans(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
    );

    expect(plans.listLatestForTenant).toHaveBeenCalledWith(membershipsFixture[0].tenantId);
    expect(result.plans).toEqual([expect.objectContaining({
      executionPlanId: plan.executionPlanId,
      campaignId: plan.campaignId,
      maximumPlannedSpendMinor: 42000,
    })]);
    expect(result.boundaries.externalWritesAllowed).toBe(false);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_tenant_plans_listed',
    }));
  });

  it('denies cross-tenant plan discovery before querying plans', async () => {
    await expect(service.listTenantPlans(
      'Bearer valid-token-value-with-32-characters',
      '77777777-7777-4777-8777-777777777777',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(plans.listLatestForTenant).not.toHaveBeenCalled();
  });

  it('protects readiness lookup with both membership and tenant-scoped plan evidence', async () => {
    const executionPlanId = '66666666-6666-4666-8666-666666666666';
    const plan = {
      tenantId: membershipsFixture[0].tenantId,
      executionPlanId,
    } as ExecutionPlanV1;
    const decision = {
      readinessDecisionId: '88888888-8888-4888-8888-888888888888',
      tenantId: membershipsFixture[0].tenantId,
      executionPlanId,
    } as never;
    plans.findById.mockResolvedValueOnce(plan);
    readiness.latestForPlan.mockResolvedValueOnce(decision);

    await expect(service.latestReadiness(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
      executionPlanId,
    )).resolves.toBe(decision);
    expect(plans.findById).toHaveBeenCalledWith(membershipsFixture[0].tenantId, executionPlanId);
    expect(readiness.latestForPlan).toHaveBeenCalledWith(
      membershipsFixture[0].tenantId,
      executionPlanId,
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_operational_readiness_viewed',
    }));
  });

  it('does not reveal plan existence outside an active membership', async () => {
    await expect(service.latestReadiness(
      'Bearer valid-token-value-with-32-characters',
      '77777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(plans.findById).not.toHaveBeenCalled();
    expect(readiness.latestForPlan).not.toHaveBeenCalled();
  });

  it('lists latest campaign contexts only after tenant authorization', async () => {
    const context = {
      tenantId: membershipsFixture[0].tenantId,
      campaignId: '99999999-9999-4999-8999-999999999999',
      status: 'needs_information',
    } as never;
    contextSelection.listLatestForTenant.mockResolvedValueOnce([context]);

    const result = await service.listCampaignContexts(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
    );

    expect(result.contexts).toEqual([context]);
    expect(result.boundaries.externalWritesAllowed).toBe(false);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_campaign_contexts_listed',
    }));
  });

  it('allows owner and operator roles to create versioned context with their identity', async () => {
    const facts = { businessName: 'Rosa VIP' };
    campaignContexts.create.mockResolvedValueOnce({ campaignId: 'campaign-id' } as never);

    await service.createCampaignContext(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
      facts,
    );

    expect(campaignContexts.create).toHaveBeenCalledWith(
      membershipsFixture[0].tenantId,
      facts,
      principal.subject,
    );
  });

  it('blocks viewer role from changing campaign context', async () => {
    await expect(service.createCampaignContext(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[1].tenantId,
      { businessName: 'Blocked' },
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(campaignContexts.create).not.toHaveBeenCalled();
    expect(campaignContexts.appendVersion).not.toHaveBeenCalled();
  });

  it('generates a plan only through an authorized preparation role', async () => {
    executionPlans.generate.mockResolvedValueOnce({ executionPlanId: 'plan-id' } as never);

    await service.generateExecutionPlan(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[0].tenantId,
      '99999999-9999-4999-8999-999999999999',
      3,
    );

    expect(executionPlans.generate).toHaveBeenCalledWith(
      membershipsFixture[0].tenantId,
      '99999999-9999-4999-8999-999999999999',
      3,
      principal.subject,
    );
  });

  it('blocks viewer role before invoking plan generation', async () => {
    await expect(service.generateExecutionPlan(
      'Bearer valid-token-value-with-32-characters',
      membershipsFixture[1].tenantId,
      '99999999-9999-4999-8999-999999999999',
      1,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(executionPlans.generate).not.toHaveBeenCalled();
  });
});
