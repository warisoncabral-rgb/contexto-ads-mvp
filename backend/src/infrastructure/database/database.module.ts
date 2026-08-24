import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  DATABASE_POOL,
  CAPABILITY_REPOSITORY,
  META_CONNECTION_REPOSITORY,
  META_OAUTH_ATTEMPT_REPOSITORY,
  READINESS_REPOSITORY,
  SMOKE_TEST_REPORT_REPOSITORY,
  CAMPAIGN_CONTEXT_REPOSITORY,
  EXECUTION_PLAN_REPOSITORY,
  APPROVAL_REPOSITORY,
  AUDIT_REPOSITORY,
  AUDIT_TIMELINE_REPOSITORY,
  EXECUTION_SIMULATION_REPOSITORY,
  CREATIVE_PACKAGE_REPOSITORY,
  OPERATIONAL_READINESS_REPOSITORY,
  EXECUTION_MANIFEST_REPOSITORY,
  EXECUTION_AUTHORIZATION_REPOSITORY,
  KILL_SWITCH_REPOSITORY,
  META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
  OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
} from './database.tokens';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';
import { PostgresCapabilityRepository } from './postgres-capability.repository';
import { PostgresReadinessRepository } from './postgres-readiness.repository';
import { PostgresSmokeTestReportRepository } from './postgres-smoke-test-report.repository';
import { PostgresCampaignContextRepository } from './postgres-campaign-context.repository';
import { PostgresExecutionPlanRepository } from './postgres-execution-plan.repository';
import { PostgresApprovalRepository } from './postgres-approval.repository';
import { PostgresAuditRepository } from './postgres-audit.repository';
import { PostgresExecutionSimulationRepository } from './postgres-execution-simulation.repository';
import { PostgresCreativePackageRepository } from './postgres-creative-package.repository';
import { PostgresOperationalReadinessRepository } from './postgres-operational-readiness.repository';
import { PostgresExecutionManifestRepository } from './postgres-execution-manifest.repository';
import { PostgresExecutionAuthorizationRepository } from './postgres-execution-authorization.repository';
import { PostgresKillSwitchRepository } from './postgres-kill-switch.repository';
import { PostgresMetaWriteValidationProtocolRepository } from './postgres-meta-write-validation-protocol.repository';
import { PostgresOperatorTenantMembershipRepository } from './postgres-operator-tenant-membership.repository';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
    },
    {
      provide: META_CONNECTION_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresMetaConnectionRepository(pool),
    },
    {
      provide: META_OAUTH_ATTEMPT_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresMetaOAuthAttemptRepository(pool),
    },
    {
      provide: CAPABILITY_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresCapabilityRepository(pool),
    },
    {
      provide: READINESS_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresReadinessRepository(pool),
    },
    {
      provide: SMOKE_TEST_REPORT_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresSmokeTestReportRepository(pool),
    },
    {
      provide: CAMPAIGN_CONTEXT_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresCampaignContextRepository(pool),
    },
    {
      provide: EXECUTION_PLAN_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresExecutionPlanRepository(pool),
    },
    {
      provide: APPROVAL_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresApprovalRepository(pool),
    },
    {
      provide: AUDIT_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresAuditRepository(pool),
    },
    {
      provide: AUDIT_TIMELINE_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresAuditRepository(pool),
    },
    {
      provide: EXECUTION_SIMULATION_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresExecutionSimulationRepository(pool),
    },
    {
      provide: CREATIVE_PACKAGE_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresCreativePackageRepository(pool),
    },
    {
      provide: OPERATIONAL_READINESS_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresOperationalReadinessRepository(pool),
    },
    {
      provide: EXECUTION_MANIFEST_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresExecutionManifestRepository(pool),
    },
    {
      provide: EXECUTION_AUTHORIZATION_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresExecutionAuthorizationRepository(pool),
    },
    {
      provide: KILL_SWITCH_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresKillSwitchRepository(pool),
    },
    {
      provide: META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresMetaWriteValidationProtocolRepository(pool),
    },
    {
      provide: OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresOperatorTenantMembershipRepository(pool),
    },
  ],
  exports: [
    DATABASE_POOL,
    META_CONNECTION_REPOSITORY,
    META_OAUTH_ATTEMPT_REPOSITORY,
    CAPABILITY_REPOSITORY,
    READINESS_REPOSITORY,
    SMOKE_TEST_REPORT_REPOSITORY,
    CAMPAIGN_CONTEXT_REPOSITORY,
    EXECUTION_PLAN_REPOSITORY,
    APPROVAL_REPOSITORY,
    AUDIT_REPOSITORY,
    AUDIT_TIMELINE_REPOSITORY,
    EXECUTION_SIMULATION_REPOSITORY,
    CREATIVE_PACKAGE_REPOSITORY,
    OPERATIONAL_READINESS_REPOSITORY,
    EXECUTION_MANIFEST_REPOSITORY,
    EXECUTION_AUTHORIZATION_REPOSITORY,
    KILL_SWITCH_REPOSITORY,
    META_WRITE_VALIDATION_PROTOCOL_REPOSITORY,
    OPERATOR_TENANT_MEMBERSHIP_REPOSITORY,
  ],
})
export class DatabaseModule {}
