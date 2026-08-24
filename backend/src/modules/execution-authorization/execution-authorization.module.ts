import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationController } from './execution-authorization.controller';
import { ExecutionAuthorizationService } from './execution-authorization.service';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';

@Module({
  imports: [DatabaseModule, KillSwitchModule],
  controllers: [ExecutionAuthorizationController],
  providers: [ExecutionAuthorizationService],
})
export class ExecutionAuthorizationModule {}
