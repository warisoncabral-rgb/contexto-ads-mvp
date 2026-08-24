import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import { DatabaseModule } from '../database/database.module';
import { DATABASE_POOL } from '../database/database.tokens';
import { CREDENTIAL_VAULT } from './credential-vault.tokens';
import { PostgresCredentialVaultAdapter } from './postgres-credential-vault.adapter';
import { UnavailableCredentialVaultAdapter } from './unavailable-credential-vault.adapter';

@Module({
  imports: [DatabaseModule],
  providers: [{
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
  }],
  exports: [CREDENTIAL_VAULT],
})
export class CredentialVaultModule {}
