import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CredentialVaultModule } from '../../infrastructure/vault/credential-vault.module';
import { CapabilityRegistryModule } from '../capability-registry/capability-registry.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [
    CapabilityRegistryModule,
    CredentialVaultModule,
    DatabaseModule,
    MetaConnectionModule,
  ],
  controllers: [ReadinessController],
  providers: [ReadinessService],
})
export class ReadinessModule {}
