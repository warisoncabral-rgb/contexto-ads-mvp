import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationModule } from '../execution-authorization/execution-authorization.module';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { MetaExecutionService } from './meta-execution.service';
import { AutomatedMetaPublicationService } from './automated-meta-publication.service';
import { SelectiveMetaPublicationService } from './selective-meta-publication.service';

@Module({
  imports: [DatabaseModule, ExecutionAuthorizationModule, KillSwitchModule, MetaAdapterModule],
  providers: [
    MetaExecutionService,
    AutomatedMetaPublicationService,
    SelectiveMetaPublicationService,
  ],
  exports: [
    MetaExecutionService,
    AutomatedMetaPublicationService,
    SelectiveMetaPublicationService,
  ],
})
export class MetaExecutionModule {}
