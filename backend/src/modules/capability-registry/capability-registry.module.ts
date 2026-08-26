import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { CapabilityRegistryService } from './capability-registry.service';

@Module({
  imports: [DatabaseModule, MetaAdapterModule, MetaConnectionModule],
  providers: [CapabilityRegistryService],
  exports: [CapabilityRegistryService],
})
export class CapabilityRegistryModule {}
