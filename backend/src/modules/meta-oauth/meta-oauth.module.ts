import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';
import { ConfigService } from '@nestjs/config';
import { MetaOAuthHttpAdapter } from '../../infrastructure/meta/meta-oauth-http.adapter';
import { UnavailableCredentialVaultAdapter } from '../../infrastructure/vault/unavailable-credential-vault.adapter';
import { GoogleSecretManagerCredentialVaultAdapter } from '../../infrastructure/vault/google-secret-manager-credential-vault.adapter';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
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
      inject: [ConfigService],
      useFactory: (config: ConfigService): CredentialVaultPort => {
        if (config.get<string>('CREDENTIAL_VAULT_PROVIDER') !== 'gcp-secret-manager') {
          return new UnavailableCredentialVaultAdapter();
        }
        const projectId = config.get<string>('GOOGLE_CLOUD_PROJECT')?.trim();
        return projectId
          ? new GoogleSecretManagerCredentialVaultAdapter(projectId)
          : new UnavailableCredentialVaultAdapter();
      },
    },
  ],
})
export class MetaOAuthModule {}
