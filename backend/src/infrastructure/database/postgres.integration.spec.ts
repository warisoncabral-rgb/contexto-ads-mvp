import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';
import { PostgresCredentialVaultAdapter } from '../vault/postgres-credential-vault.adapter';
import { PostgresCapabilityRepository } from './postgres-capability.repository';
import { PostgresReadinessRepository } from './postgres-readiness.repository';
import { PostgresSmokeTestReportRepository } from './postgres-smoke-test-report.repository';
import { PostgresCampaignContextRepository } from './postgres-campaign-context.repository';
import { PostgresExecutionPlanRepository } from './postgres-execution-plan.repository';
import { PostgresApprovalRepository } from './postgres-approval.repository';
import { ApprovalService } from '../../modules/approval/approval.service';
import { PostgresExecutionSimulationRepository } from './postgres-execution-simulation.repository';
import { ExecutionSimulationService } from '../../modules/execution-simulation/execution-simulation.service';
import { MetaConnectionService } from '../../modules/meta-connection/meta-connection.service';
import { CapabilityRegistryService } from '../../modules/capability-registry/capability-registry.service';
import { MetaReadonlyAdapter } from '../../modules/meta-adapter/meta-readonly.adapter';
import { PostgresCreativePackageRepository } from './postgres-creative-package.repository';
import { PostgresOperationalReadinessRepository } from './postgres-operational-readiness.repository';
import { OperationalReadinessService } from '../../modules/operational-readiness/operational-readiness.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL integration', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const connectionId = randomUUID();

  beforeAll(async () => {
    for (const migration of [
      '001_foundation.sql',
      '002_meta_oauth_attempts.sql',
      '003_meta_oauth_credential_compensations.sql',
      '004_postgres_credential_vault.sql',
      '005_tenant_scoped_asset_bindings.sql',
      '006_tenant_scoped_capability_registry.sql',
      '007_validation_evidence.sql',
      '008_campaign_context.sql',
      '009_execution_plans.sql',
      '010_plan_approvals.sql',
      '011_execution_simulations.sql',
      '012_creative_packages.sql',
      '013_operational_readiness_decisions.sql',
    ]) {
      await pool.query(
        await readFile(join(process.cwd(), 'db', 'migrations', migration), 'utf8'),
      );
    }
    await pool.query(
      `insert into meta_connections (
        connection_id, tenant_id, status, created_at, updated_at
      ) values ($1, $2, 'authorization_pending', now(), now())`,
      [connectionId, tenantId],
    );
  });

  afterAll(async () => {
    await pool.query('delete from operational_readiness_decisions where tenant_id = $1', [tenantId]);
    await pool.query('delete from execution_simulation_reports where tenant_id = $1', [tenantId]);
    await pool.query('delete from plan_approvals where tenant_id = $1', [tenantId]);
    await pool.query('delete from creative_package_versions where tenant_id = $1', [tenantId]);
    await pool.query('delete from execution_plans where tenant_id = $1', [tenantId]);
    await pool.query('delete from campaign_context_versions where tenant_id = $1', [tenantId]);
    await pool.query('delete from campaigns where tenant_id = $1', [tenantId]);
    await pool.query('delete from meta_smoke_test_reports where tenant_id = $1', [tenantId]);
    await pool.query('delete from readiness_snapshots where tenant_id = $1', [tenantId]);
    await pool.query('delete from credential_vault_secrets where tenant_id = any($1::uuid[])', [
      [tenantId, otherTenantId],
    ]);
    await pool.query('delete from meta_asset_bindings where tenant_id = $1', [tenantId]);
    await pool.query('delete from capability_registry where tenant_id = $1', [tenantId]);
    await pool.query('delete from meta_oauth_attempts where tenant_id = $1', [tenantId]);
    await pool.query('delete from meta_connections where tenant_id = $1', [tenantId]);
    await pool.query('delete from audit_events where tenant_id = $1', [tenantId]);
    await pool.end();
  });

  it('atomically allows only one consumer for an OAuth state', async () => {
    const repository = new PostgresMetaOAuthAttemptRepository(pool);
    const stateHash = 'a'.repeat(64);
    const now = new Date();
    await repository.replaceActive({
      attemptId: randomUUID(),
      tenantId,
      connectionId,
      stateHash,
      requestedScopes: ['public_profile'],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.consumeActive(stateHash)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('stores no plaintext and enforces tenant isolation and revocation', async () => {
    const vault = new PostgresCredentialVaultAdapter(pool, Buffer.alloc(32, 7));
    const secret = '{"accessToken":"integration-only-secret"}';
    const credentialRef = await vault.putSecret(tenantId, secret);
    const credentialId = credentialRef.slice('postgres-vault://'.length);

    const persisted = await pool.query<{ ciphertext_text: string }>(
      `select encode(ciphertext, 'escape') as ciphertext_text
      from credential_vault_secrets where credential_id = $1`,
      [credentialId],
    );
    expect(persisted.rows[0].ciphertext_text).not.toContain('integration-only-secret');
    await expect(vault.getSecret(tenantId, credentialRef)).resolves.toBe(secret);
    await expect(vault.getSecret(otherTenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );

    await vault.revokeSecret(tenantId, credentialRef);
    await vault.revokeSecret(tenantId, credentialRef);
    await expect(vault.getSecret(tenantId, credentialRef)).rejects.toThrow(
      'Credential Vault operation failed',
    );
  });

  it('replaces asset snapshots and enforces tenant scope in PostgreSQL', async () => {
    const repository = new PostgresMetaConnectionRepository(pool);
    const observedAt = '2026-08-24T01:00:00.000Z';
    await repository.replaceBindings(tenantId, connectionId, [{
      tenantId,
      connectionId,
      assetType: 'ad_account',
      externalId: 'act_123',
      displayName: 'Main account',
      selected: false,
      observedAt,
    }]);

    await expect(repository.listBindings(tenantId, connectionId)).resolves.toEqual([{
      tenantId,
      connectionId,
      assetType: 'ad_account',
      externalId: 'act_123',
      displayName: 'Main account',
      selected: false,
      observedAt,
    }]);

    await expect(pool.query(
      `insert into meta_asset_bindings (
        tenant_id, connection_id, asset_type, external_id, selected, observed_at
      ) values ($1, $2, 'business', 'cross-tenant', false, now())`,
      [otherTenantId, connectionId],
    )).rejects.toThrow();
  });

  it('persists capability evidence and rejects cross-tenant associations', async () => {
    const repository = new PostgresCapabilityRepository(pool);
    const capabilityId = randomUUID();
    const validatedAt = '2026-08-24T02:00:00.000Z';
    await repository.replaceForConnection(tenantId, connectionId, [{
      capabilityId,
      tenantId,
      connectionId,
      capabilityType: 'READ_AD_ACCOUNT',
      assetScope: 'act_123',
      requiredPermissions: ['ads_read'],
      grantedPermissions: ['ads_read'],
      status: 'available',
      apiVersion: 'v26.0',
      restrictions: [],
      validationSource: 'meta_api',
      validatedAt,
    }]);

    await expect(repository.listForConnection(tenantId, connectionId)).resolves
      .toEqual([expect.objectContaining({ capabilityId, tenantId, connectionId })]);

    await expect(pool.query(
      `insert into capability_registry (
        capability_id, tenant_id, connection_id, capability_type,
        required_permissions, granted_permissions, status, restrictions,
        validation_source, validated_at
      ) values ($1, $2, $3, 'DISCOVER_ASSETS', '[]', '[]', 'unknown', '[]',
        'system_rule', now())`,
      [randomUUID(), otherTenantId, connectionId],
    )).rejects.toThrow();
  });

  it('persists validation evidence and enforces tenant-scoped associations', async () => {
    const readiness = new PostgresReadinessRepository(pool);
    const smokeReports = new PostgresSmokeTestReportRepository(pool);
    const snapshot = {
      snapshotId: randomUUID(),
      tenantId,
      connectionId,
      correlationId: randomUUID(),
      checks: [{
        key: 'meta_oauth',
        status: 'passed' as const,
        meaning: 'OAuth ready',
        evidenceRefs: [`meta_connection:${connectionId}`],
        source: 'system' as const,
      }],
      blockers: [],
      generatedAt: '2026-08-24T04:00:00.000Z',
    };
    const report = {
      smokeTestId: randomUUID(),
      tenantId,
      connectionId,
      passed: true,
      steps: [{
        key: 'identity' as const,
        status: 'passed' as const,
        meaning: 'Identity valid',
        evidenceRefs: ['meta_user:123'],
        observedAt: '2026-08-24T04:01:00.000Z',
      }],
      blockers: [],
      generatedAt: '2026-08-24T04:02:00.000Z',
    };

    await readiness.save(snapshot);
    await smokeReports.save(report);
    await expect(readiness.latestForConnection(tenantId, connectionId)).resolves
      .toEqual(snapshot);
    await expect(smokeReports.latestForConnection(tenantId, connectionId)).resolves
      .toEqual(report);

    await expect(readiness.save({
      ...snapshot,
      snapshotId: randomUUID(),
      tenantId: otherTenantId,
    })).rejects.toThrow();
    await expect(smokeReports.save({
      ...report,
      smokeTestId: randomUUID(),
      tenantId: otherTenantId,
    })).rejects.toThrow();
  });

  it('versions campaign context atomically and isolates it by tenant', async () => {
    const repository = new PostgresCampaignContextRepository(pool);
    const campaignId = randomUUID();
    const first = {
      packageId: randomUUID(),
      tenantId,
      campaignId,
      version: 1,
      schemaVersion: '1.0' as const,
      status: 'needs_information' as const,
      facts: {},
      inferences: [] as [],
      validationIssues: [{
        code: 'required_fact_missing' as const,
        field: 'offer' as const,
        severity: 'blocker' as const,
        message: 'Missing offer',
        nextAction: 'Provide offer',
      }],
      contentHash: 'a'.repeat(64),
      createdAt: '2026-08-24T05:00:00.000Z',
    };
    await repository.create(first);

    const versions = await Promise.all(
      Array.from({ length: 4 }, (_, index) => repository.appendNext({
        ...first,
        packageId: randomUUID(),
        contentHash: (index + 1).toString(16).repeat(64),
        createdAt: new Date(Date.parse(first.createdAt) + index + 1).toISOString(),
      })),
    );

    expect(versions.map((version) => version?.version).sort()).toEqual([2, 3, 4, 5]);
    await expect(repository.latest(tenantId, campaignId)).resolves
      .toEqual(expect.objectContaining({ tenantId, campaignId, version: 5 }));
    await expect(repository.latest(otherTenantId, campaignId)).resolves.toBeNull();
    await expect(repository.appendNext({
      ...first,
      packageId: randomUUID(),
      tenantId: otherTenantId,
    })).resolves.toBeNull();
  });

  it('persists one immutable plan under concurrent idempotent generation', async () => {
    const contexts = new PostgresCampaignContextRepository(pool);
    const plans = new PostgresExecutionPlanRepository(pool);
    const campaignId = randomUUID();
    const context = {
      packageId: randomUUID(),
      tenantId,
      campaignId,
      version: 1,
      schemaVersion: '1.0' as const,
      status: 'ready_for_generation' as const,
      facts: {},
      inferences: [] as [],
      validationIssues: [],
      contentHash: 'c'.repeat(64),
      createdAt: '2026-08-24T06:00:00.000Z',
    };
    await contexts.create(context);
    const basePlan = {
      executionPlanId: randomUUID(),
      tenantId,
      campaignId,
      campaignPackageVersion: 1,
      planVersion: '1.0',
      correlationId: randomUUID(),
      planHash: 'd'.repeat(64),
      idempotencyKey: 'e'.repeat(64),
      status: 'draft' as const,
      meta: { assetBindings: [], requiredCapabilities: [] },
      objectsToCreate: [],
      readiness: [],
      autonomy: { level: 'A0' as const, approvalRequired: true },
      financials: {
        currency: 'BRL',
        budgetMode: 'daily' as const,
        configuredAmountMinor: 1000,
        maximumPlannedSpendMinor: 7000,
        calculation: '1000 x 7 days',
      },
      decisions: [],
      risks: [],
      externalEffects: { writesAllowed: false as const, writesPerformed: false as const },
      createdAt: '2026-08-24T07:00:00.000Z',
    };

    const persisted = await Promise.all(
      Array.from({ length: 6 }, () => plans.saveIdempotent({
        ...basePlan,
        executionPlanId: randomUUID(),
        correlationId: randomUUID(),
      })),
    );

    expect(new Set(persisted.map((plan) => plan.executionPlanId)).size).toBe(1);
    await expect(plans.latest(tenantId, campaignId)).resolves
      .toEqual(expect.objectContaining({ tenantId, campaignId, planHash: 'd'.repeat(64) }));
    await expect(plans.latest(otherTenantId, campaignId)).resolves.toBeNull();
    await expect(plans.saveIdempotent({
      ...basePlan,
      executionPlanId: randomUUID(),
      tenantId: otherTenantId,
      planHash: 'f'.repeat(64),
      idempotencyKey: '1'.repeat(64),
    })).rejects.toThrow();
  });

  it('governs approval lifecycle by current hash with atomic audit evidence', async () => {
    const contexts = new PostgresCampaignContextRepository(pool);
    const plans = new PostgresExecutionPlanRepository(pool);
    const approvals = new PostgresApprovalRepository(pool);
    const service = new ApprovalService(plans, approvals);
    const campaignId = randomUUID();
    const context = {
      packageId: randomUUID(),
      tenantId,
      campaignId,
      version: 1,
      schemaVersion: '1.0' as const,
      status: 'ready_for_generation' as const,
      facts: {},
      inferences: [] as [],
      validationIssues: [],
      contentHash: '2'.repeat(64),
      createdAt: '2026-08-24T08:00:00.000Z',
    };
    await contexts.create(context);
    const makePlan = (
      executionPlanId: string,
      version: number,
      planHash: string,
      createdAt: string,
    ) => ({
      executionPlanId,
      tenantId,
      campaignId,
      campaignPackageVersion: version,
      planVersion: '1.0',
      correlationId: randomUUID(),
      planHash,
      idempotencyKey: planHash.split('').reverse().join(''),
      status: 'draft' as const,
      meta: { assetBindings: [], requiredCapabilities: [] },
      objectsToCreate: [{
        internalObjectId: `${campaignId}:campaign`,
        type: 'campaign' as const,
        dependsOn: [],
        logicalConfig: { lifecycleStatus: 'PAUSED' },
      }],
      readiness: [],
      autonomy: { level: 'A0' as const, approvalRequired: true },
      financials: {
        currency: 'BRL',
        budgetMode: 'daily' as const,
        configuredAmountMinor: 1000,
        maximumPlannedSpendMinor: 7000,
        calculation: '1000 x 7 days',
      },
      decisions: [],
      risks: [{
        code: 'financial_commitment_requires_approval',
        severity: 'high' as const,
        meaning: 'Spend approval required',
        mitigation: 'Approve exact hash',
        blocksExecution: true,
      }],
      externalEffects: { writesAllowed: false as const, writesPerformed: false as const },
      createdAt,
    });
    const firstPlan = makePlan(
      randomUUID(),
      1,
      '3'.repeat(64),
      '2026-08-24T09:00:00.000Z',
    );
    await plans.saveIdempotent(firstPlan);

    const requested = await Promise.all(
      Array.from({ length: 4 }, () => service.request(
        tenantId,
        campaignId,
        firstPlan.executionPlanId,
        'warison',
      )),
    );
    expect(new Set(requested.map((approval) => approval.approvalId)).size).toBe(1);
    const approved = await service.approve(
      tenantId,
      requested[0].approvalId,
      'warison',
    );
    expect(approved).toEqual(expect.objectContaining({
      status: 'approved',
      approvedBy: 'warison',
      approvedPlanHash: firstPlan.planHash,
    }));

    const secondContext = await contexts.appendNext({
      ...context,
      packageId: randomUUID(),
      contentHash: '4'.repeat(64),
      createdAt: '2026-08-24T10:00:00.000Z',
    });
    const secondPlan = makePlan(
      randomUUID(),
      secondContext!.version,
      '5'.repeat(64),
      '2026-08-24T11:00:00.000Z',
    );
    await plans.saveIdempotent(secondPlan);

    await expect(service.get(tenantId, approved.approvalId)).resolves
      .toEqual(expect.objectContaining({
        status: 'invalidated',
        decisionReason: 'plan_hash_changed',
      }));
    await expect(service.get(otherTenantId, approved.approvalId)).rejects
      .toThrow('Approval not found');

    const expiring = await service.request(
      tenantId,
      campaignId,
      secondPlan.executionPlanId,
      'warison',
    );
    await pool.query(
      `update plan_approvals set expires_at = now() - interval '1 second'
      where approval_id = $1`,
      [expiring.approvalId],
    );
    await expect(service.get(tenantId, expiring.approvalId)).resolves
      .toEqual(expect.objectContaining({
        status: 'expired',
        decisionReason: 'approval_expired',
      }));

    const audit = await pool.query<{ event_type: string }>(
      `select event_type from audit_events
      where tenant_id = $1 and object_type = 'plan_approval'
        and object_id = any($2::text[])
      order by created_at`,
      [tenantId, [approved.approvalId, expiring.approvalId]],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      'campaign_plan_approval_requested',
      'campaign_plan_approved',
      'campaign_plan_approval_invalidated',
      'campaign_plan_approval_expired',
    ]));
    expect(audit.rows).toHaveLength(5);
  });

  it('binds only a discovered target and dry-runs the approved dependency graph', async () => {
    const contexts = new PostgresCampaignContextRepository(pool);
    const plans = new PostgresExecutionPlanRepository(pool);
    const approvalRepository = new PostgresApprovalRepository(pool);
    const simulationRepository = new PostgresExecutionSimulationRepository(pool);
    const creativePackageRepository = new PostgresCreativePackageRepository(pool);
    const readinessDecisionRepository = new PostgresOperationalReadinessRepository(pool);
    const connectionRepository = new PostgresMetaConnectionRepository(pool);
    const capabilityRepository = new PostgresCapabilityRepository(pool);
    const meta = {} as MetaReadonlyAdapter;
    const connectionService = new MetaConnectionService(meta, connectionRepository);
    const capabilityService = new CapabilityRegistryService(
      connectionService,
      meta,
      capabilityRepository,
    );
    const approvalService = new ApprovalService(plans, approvalRepository);
    const simulationService = new ExecutionSimulationService(
      connectionService,
      capabilityService,
      approvalService,
      plans,
      approvalRepository,
      simulationRepository,
      creativePackageRepository,
    );
    const operationalReadinessService = new OperationalReadinessService(
      simulationService,
      plans,
      readinessDecisionRepository,
    );
    const campaignId = randomUUID();
    const executionConnectionId = randomUUID();
    const adAccountId = 'act_987654';
    await contexts.create({
      packageId: randomUUID(),
      tenantId,
      campaignId,
      version: 1,
      schemaVersion: '1.0',
      status: 'ready_for_generation',
      facts: {},
      inferences: [],
      validationIssues: [],
      contentHash: '6'.repeat(64),
      createdAt: '2026-08-24T12:00:00.000Z',
    });
    await connectionRepository.save({
      connectionId: executionConnectionId,
      tenantId,
      provider: 'meta',
      status: 'connected',
      credentialRef: `postgres-vault://${randomUUID()}`,
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
    });
    await connectionRepository.replaceBindings(tenantId, executionConnectionId, [{
      tenantId,
      connectionId: executionConnectionId,
      assetType: 'ad_account',
      externalId: adAccountId,
      displayName: 'Integration account',
      selected: false,
      observedAt: '2026-08-24T12:01:00.000Z',
    }]);
    const requiredCapabilities = [
      'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_CREATIVE', 'CREATE_AD',
    ] as const;
    await capabilityRepository.replaceForConnection(
      tenantId,
      executionConnectionId,
      requiredCapabilities.map((capabilityType) => ({
        capabilityId: randomUUID(),
        tenantId,
        connectionId: executionConnectionId,
        capabilityType,
        assetScope: adAccountId,
        requiredPermissions: ['ads_management'],
        grantedPermissions: ['ads_management'],
        status: 'available',
        restrictions: [],
        validationSource: 'manual_evidence',
        validatedAt: '2026-08-24T12:02:00.000Z',
      })),
    );
    const campaignObjectId = `${campaignId}:campaign`;
    const adSetObjectId = `${campaignId}:ad_set`;
    const creativeObjectId = `${campaignId}:creative`;
    const creativePackageId = randomUUID();
    const creativeContentHash = '9'.repeat(64);
    const sourcePlan = {
      executionPlanId: randomUUID(),
      tenantId,
      campaignId,
      campaignPackageVersion: 1,
      planVersion: '1.0',
      correlationId: randomUUID(),
      planHash: '7'.repeat(64),
      idempotencyKey: '8'.repeat(64),
      status: 'draft' as const,
      meta: { assetBindings: [], requiredCapabilities: [...requiredCapabilities] },
      objectsToCreate: [
        {
          internalObjectId: campaignObjectId,
          type: 'campaign' as const,
          dependsOn: [],
          logicalConfig: { lifecycleStatus: 'PAUSED' },
        },
        {
          internalObjectId: adSetObjectId,
          type: 'ad_set' as const,
          dependsOn: [campaignObjectId],
          logicalConfig: { lifecycleStatus: 'PAUSED' },
        },
        {
          internalObjectId: creativeObjectId,
          type: 'creative' as const,
          dependsOn: [],
          logicalConfig: {
            copyStatus: 'approved',
            creativePackageId,
            creativePackageVersion: 1,
            creativeContentHash,
          },
        },
        {
          internalObjectId: `${campaignId}:ad`,
          type: 'ad' as const,
          dependsOn: [adSetObjectId, creativeObjectId],
          logicalConfig: { lifecycleStatus: 'PAUSED' },
        },
      ],
      readiness: [{
        key: 'meta_execution_target',
        status: 'pending' as const,
        meaning: 'Target missing',
        evidenceRefs: [],
        source: 'system' as const,
      }],
      autonomy: { level: 'A0' as const, approvalRequired: true },
      financials: {
        currency: 'BRL',
        budgetMode: 'daily' as const,
        configuredAmountMinor: 1000,
        maximumPlannedSpendMinor: 7000,
        calculation: '1000 x 7 days',
      },
      decisions: [],
      risks: [{
        code: 'meta_target_not_selected',
        severity: 'high' as const,
        meaning: 'Target missing',
        mitigation: 'Bind target',
        blocksExecution: true,
      }],
      externalEffects: { writesAllowed: false as const, writesPerformed: false as const },
      createdAt: '2026-08-24T01:03:00.000Z',
    };
    await plans.saveIdempotent(sourcePlan);
    const creativeDraft = await creativePackageRepository.appendNext({
      creativePackageId,
      tenantId,
      campaignId,
      sourceExecutionPlanId: sourcePlan.executionPlanId,
      sourcePlanHash: sourcePlan.planHash,
      schemaVersion: '1.0',
      status: 'needs_review',
      copies: [],
      claims: [],
      assets: [],
      reviewChecklist: {
        claimsVerifiedAgainstSources: true,
        visualFidelityReviewed: true,
        safeAreaReviewed: true,
        requiredFieldsReviewed: true,
        automaticEnhancementsReviewed: true,
      },
      validationIssues: [],
      contentHash: creativeContentHash,
      createdAt: '2026-08-24T01:04:00.000Z',
    }, {
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user',
      actorId: 'warison',
      eventType: 'creative_package_version_created',
      objectType: 'creative_package',
      objectId: creativePackageId,
      result: 'success',
      createdAt: '2026-08-24T01:04:00.000Z',
    });
    expect(creativeDraft).not.toBeNull();
    await creativePackageRepository.approveLatest(
      tenantId,
      campaignId,
      1,
      creativeContentHash,
      'warison',
      '2026-08-24T01:05:00.000Z',
      {
        auditEventId: randomUUID(),
        tenantId,
        correlationId: randomUUID(),
        actorType: 'user',
        actorId: 'warison',
        eventType: 'creative_package_approved',
        objectType: 'creative_package',
        objectId: creativePackageId,
        result: 'success',
        createdAt: '2026-08-24T01:05:00.000Z',
      },
    );
    const sourceApproval = await approvalService.request(
      tenantId,
      campaignId,
      sourcePlan.executionPlanId,
      'warison',
    );
    await approvalService.approve(tenantId, sourceApproval.approvalId, 'warison');

    const targeted = await simulationService.bindTarget(
      tenantId,
      campaignId,
      sourcePlan.executionPlanId,
      executionConnectionId,
      adAccountId,
    );
    expect(targeted.externalEffects).toEqual({ writesAllowed: false, writesPerformed: false });
    expect(targeted.meta).toEqual(expect.objectContaining({
      connectionId: executionConnectionId,
      adAccountId,
    }));
    await expect(approvalService.get(tenantId, sourceApproval.approvalId)).resolves
      .toEqual(expect.objectContaining({
        status: 'invalidated',
        decisionReason: 'plan_hash_changed',
      }));

    const targetApproval = await approvalService.request(
      tenantId,
      campaignId,
      targeted.executionPlanId,
      'warison',
    );
    const approvedTarget = await approvalService.approve(
      tenantId,
      targetApproval.approvalId,
      'warison',
    );
    const simulation = await simulationService.simulate(
      tenantId,
      campaignId,
      targeted.executionPlanId,
      approvedTarget.approvalId,
    );
    expect(simulation.status).toBe('ready_for_execution');
    expect(simulation.blockers).toEqual([]);
    expect(simulation.operations.map((operation) => operation.objectType)).toEqual([
      'campaign', 'creative', 'ad_set', 'ad',
    ]);
    expect(simulation.operations.every((operation) => !operation.willExecute)).toBe(true);
    expect(simulation.externalEffects).toEqual({ writesAllowed: false, writesPerformed: false });
    const readinessDecision = await operationalReadinessService.generate(
      tenantId,
      campaignId,
      targeted.executionPlanId,
      approvedTarget.approvalId,
    );
    expect(readinessDecision.status).toBe('ready_for_executor_validation');
    expect(readinessDecision.progress).toEqual(expect.objectContaining({
      campaignPreparation: 'complete',
      executorValidation: 'pending',
      publication: 'not_started',
      activation: 'not_started',
      delivery: 'not_started',
    }));
    expect(readinessDecision.boundaries).toEqual({
      campaignPublished: false,
      campaignActive: false,
      campaignDelivering: false,
      externalWritesAllowed: false,
      externalWritesPerformed: false,
    });
    await expect(operationalReadinessService.latest(
      tenantId,
      targeted.executionPlanId,
    )).resolves.toEqual(readinessDecision);
    const concurrentDecisions = await Promise.all(Array.from({ length: 5 }, () =>
      operationalReadinessService.generate(
        tenantId,
        campaignId,
        targeted.executionPlanId,
        approvedTarget.approvalId,
      )));
    expect(new Set(concurrentDecisions.map((item) => item.readinessDecisionId)).size)
      .toBe(1);
    expect(new Set(concurrentDecisions.map((item) => item.decisionHash)))
      .toEqual(new Set([readinessDecision.decisionHash]));
    await expect(simulationRepository.latestForPlan(
      tenantId,
      targeted.executionPlanId,
    )).resolves.toEqual(simulation);
    await expect(simulationRepository.save({
      ...simulation,
      simulationId: randomUUID(),
      tenantId: otherTenantId,
    })).rejects.toThrow();
  });

  it('serializes creative versions, preserves approval history and blocks stale approval', async () => {
    const contexts = new PostgresCampaignContextRepository(pool);
    const plans = new PostgresExecutionPlanRepository(pool);
    const creativePackages = new PostgresCreativePackageRepository(pool);
    const campaignId = randomUUID();
    const executionPlanId = randomUUID();
    const planHash = 'd'.repeat(64);
    await contexts.create({
      packageId: randomUUID(),
      tenantId,
      campaignId,
      version: 1,
      schemaVersion: '1.0',
      status: 'ready_for_generation',
      facts: {},
      inferences: [],
      validationIssues: [],
      contentHash: 'e'.repeat(64),
      createdAt: '2026-08-24T03:00:00.000Z',
    });
    await plans.saveIdempotent({
      executionPlanId,
      tenantId,
      campaignId,
      campaignPackageVersion: 1,
      planVersion: '1.0',
      correlationId: randomUUID(),
      planHash,
      idempotencyKey: 'f'.repeat(64),
      status: 'draft',
      meta: { assetBindings: [], requiredCapabilities: [] },
      objectsToCreate: [],
      readiness: [],
      autonomy: { level: 'A0', approvalRequired: true },
      financials: {
        currency: 'BRL',
        budgetMode: 'daily',
        configuredAmountMinor: 1000,
        maximumPlannedSpendMinor: 7000,
        calculation: '1000 x 7 days',
      },
      decisions: [],
      risks: [],
      externalEffects: { writesAllowed: false, writesPerformed: false },
      createdAt: '2026-08-24T03:01:00.000Z',
    });
    const contentHash = '1'.repeat(64);
    const makeDraft = (creativePackageId: string, hash: string) => ({
      creativePackageId,
      tenantId,
      campaignId,
      sourceExecutionPlanId: executionPlanId,
      sourcePlanHash: planHash,
      schemaVersion: '1.0' as const,
      status: 'needs_review' as const,
      copies: [],
      claims: [],
      assets: [],
      reviewChecklist: {
        claimsVerifiedAgainstSources: true,
        visualFidelityReviewed: true,
        safeAreaReviewed: true,
        requiredFieldsReviewed: true,
        automaticEnhancementsReviewed: true,
      },
      validationIssues: [],
      contentHash: hash,
      createdAt: '2026-08-24T03:02:00.000Z',
    });
    const makeEvent = (objectId: string, createdAt: string) => ({
      auditEventId: randomUUID(),
      tenantId,
      correlationId: randomUUID(),
      actorType: 'user' as const,
      actorId: 'warison',
      eventType: 'creative_package_version_created',
      objectType: 'creative_package',
      objectId,
      result: 'success' as const,
      createdAt,
    });
    const attempts = await Promise.all(Array.from({ length: 6 }, () => {
      const id = randomUUID();
      return creativePackages.appendNext(
        makeDraft(id, contentHash),
        makeEvent(id, '2026-08-24T03:02:00.000Z'),
      );
    }));
    expect(new Set(attempts.map((item) => item?.creativePackageId)).size).toBe(1);
    expect(new Set(attempts.map((item) => item?.version))).toEqual(new Set([1]));
    const first = attempts[0]!;
    const approved = await creativePackages.approveLatest(
      tenantId,
      campaignId,
      1,
      contentHash,
      'warison',
      '2026-08-24T03:03:00.000Z',
      {
        ...makeEvent(first.creativePackageId, '2026-08-24T03:03:00.000Z'),
        eventType: 'creative_package_approved',
      },
    );
    expect(approved?.status).toBe('approved');
    const secondId = randomUUID();
    const second = await creativePackages.appendNext(
      makeDraft(secondId, '2'.repeat(64)),
      makeEvent(secondId, '2026-08-24T03:04:00.000Z'),
    );
    expect(second?.version).toBe(2);
    await expect(creativePackages.findVersion(tenantId, campaignId, 1)).resolves
      .toEqual(expect.objectContaining({
        status: 'superseded',
        approvedBy: 'warison',
        approvedAt: '2026-08-24T03:03:00.000Z',
      }));
    await expect(creativePackages.approveLatest(
      tenantId,
      campaignId,
      1,
      contentHash,
      'warison',
      '2026-08-24T03:05:00.000Z',
      makeEvent(first.creativePackageId, '2026-08-24T03:05:00.000Z'),
    )).resolves.toBeNull();
    await expect(creativePackages.latest(otherTenantId, campaignId)).resolves.toBeNull();
  });
});
