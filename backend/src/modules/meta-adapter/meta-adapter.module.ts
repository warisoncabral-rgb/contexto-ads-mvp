import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { CredentialVaultModule } from '../../infrastructure/vault/credential-vault.module';
import { CREDENTIAL_VAULT } from '../../infrastructure/vault/credential-vault.tokens';
import { MetaReadonlyAdapter } from './meta-readonly.adapter';
import { MetaWriteAdapter } from './meta-write.adapter';

@Module({
  imports: [CredentialVaultModule],
  providers: [{
    provide: MetaReadonlyAdapter,
    inject: [ConfigService, CREDENTIAL_VAULT],
    useFactory: (config: ConfigService, vault: CredentialVaultPort) =>
      new MetaReadonlyAdapter(config, vault),
  }, {
    provide: MetaWriteAdapter,
    inject: [ConfigService, CREDENTIAL_VAULT],
    useFactory: (config: ConfigService, vault: CredentialVaultPort) =>
      new MetaWriteAdapter(config, vault),
  }],
  exports: [MetaReadonlyAdapter, MetaWriteAdapter],
})
export class MetaAdapterModule {}
