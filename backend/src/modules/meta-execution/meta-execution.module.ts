import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationModule } from '../execution-authorization/execution-authorization.module';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { MetaExecutionService } from './meta-execution.service';

@Module({
  imports: [DatabaseModule, ExecutionAuthorizationModule, KillSwitchModule, MetaAdapterModule],
  providers: [MetaExecutionService],
  exports: [MetaExecutionService],
})
export class MetaExecutionModule {}
