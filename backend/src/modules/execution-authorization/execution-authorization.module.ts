import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationService } from './execution-authorization.service';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';

@Module({
  imports: [DatabaseModule, KillSwitchModule, MetaAdapterModule],
  providers: [ExecutionAuthorizationService],
  exports: [ExecutionAuthorizationService],
})
export class ExecutionAuthorizationModule {}
