import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { CapabilityRegistryController } from './capability-registry.controller';
import { CapabilityRegistryService } from './capability-registry.service';

@Module({
  imports: [DatabaseModule, MetaAdapterModule, MetaConnectionModule],
  controllers: [CapabilityRegistryController],
  providers: [CapabilityRegistryService],
})
export class CapabilityRegistryModule {}
