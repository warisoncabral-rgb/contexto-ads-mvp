import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationService } from './execution-authorization.service';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';

@Module({
  imports: [DatabaseModule, KillSwitchModule],
  providers: [ExecutionAuthorizationService],
  exports: [ExecutionAuthorizationService],
})
export class ExecutionAuthorizationModule {}
