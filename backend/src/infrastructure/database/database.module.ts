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
} from './database.tokens';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';
import { PostgresCapabilityRepository } from './postgres-capability.repository';
import { PostgresReadinessRepository } from './postgres-readiness.repository';
import { PostgresSmokeTestReportRepository } from './postgres-smoke-test-report.repository';

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
  ],
  exports: [
    DATABASE_POOL,
    META_CONNECTION_REPOSITORY,
    META_OAUTH_ATTEMPT_REPOSITORY,
    CAPABILITY_REPOSITORY,
    READINESS_REPOSITORY,
    SMOKE_TEST_REPORT_REPOSITORY,
  ],
})
export class DatabaseModule {}
