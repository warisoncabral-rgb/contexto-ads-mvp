import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  DATABASE_POOL,
  META_CONNECTION_REPOSITORY,
  META_OAUTH_ATTEMPT_REPOSITORY,
} from './database.tokens';
import { PostgresMetaConnectionRepository } from './postgres-meta-connection.repository';
import { PostgresMetaOAuthAttemptRepository } from './postgres-meta-oauth-attempt.repository';

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
  ],
  exports: [DATABASE_POOL, META_CONNECTION_REPOSITORY, META_OAUTH_ATTEMPT_REPOSITORY],
})
export class DatabaseModule {}
