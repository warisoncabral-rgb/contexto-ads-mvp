import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';
import { ConfigService } from '@nestjs/config';
import { MetaOAuthHttpAdapter } from '../../infrastructure/meta/meta-oauth-http.adapter';
import { UnavailableCredentialVaultAdapter } from '../../infrastructure/vault/unavailable-credential-vault.adapter';
import { PostgresCredentialVaultAdapter } from '../../infrastructure/vault/postgres-credential-vault.adapter';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';
import { Pool } from 'pg';
import { CREDENTIAL_VAULT, META_OAUTH_TOKEN_EXCHANGE } from './meta-oauth.tokens';
import { MetaOAuthCallbackController } from './meta-oauth-callback.controller';

@Module({
  imports: [DatabaseModule, MetaConnectionModule],
  controllers: [MetaOAuthController, MetaOAuthCallbackController],
  providers: [
    MetaOAuthService,
    {
      provide: META_OAUTH_TOKEN_EXCHANGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new MetaOAuthHttpAdapter(config),
    },
    {
      provide: CREDENTIAL_VAULT,
      inject: [ConfigService, DATABASE_POOL],
      useFactory: (config: ConfigService, pool: Pool): CredentialVaultPort => {
        if (config.get<string>('CREDENTIAL_VAULT_PROVIDER') !== 'postgres') {
          return new UnavailableCredentialVaultAdapter();
        }
        const encodedKey = config.get<string>('CREDENTIAL_VAULT_MASTER_KEY')?.trim();
        if (!encodedKey) return new UnavailableCredentialVaultAdapter();
        try {
          return new PostgresCredentialVaultAdapter(
            pool,
            PostgresCredentialVaultAdapter.decodeMasterKey(encodedKey),
          );
        } catch {
          return new UnavailableCredentialVaultAdapter();
        }
      },
    },
  ],
})
export class MetaOAuthModule {}
