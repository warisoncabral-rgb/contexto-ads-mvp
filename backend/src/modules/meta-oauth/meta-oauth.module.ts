import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { MetaOAuthService } from './meta-oauth.service';
import { ConfigService } from '@nestjs/config';
import { MetaOAuthHttpAdapter } from '../../infrastructure/meta/meta-oauth-http.adapter';
import { CredentialVaultModule } from '../../infrastructure/vault/credential-vault.module';
import { META_OAUTH_TOKEN_EXCHANGE } from './meta-oauth.tokens';
import { MetaOAuthCallbackController } from './meta-oauth-callback.controller';

@Module({
  imports: [DatabaseModule, MetaConnectionModule, CredentialVaultModule],
  controllers: [MetaOAuthCallbackController],
  providers: [
    MetaOAuthService,
    {
      provide: META_OAUTH_TOKEN_EXCHANGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new MetaOAuthHttpAdapter(config),
    },
  ],
  exports: [MetaOAuthService],
})
export class MetaOAuthModule {}
