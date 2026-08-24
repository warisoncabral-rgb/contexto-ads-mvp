import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionAuthorizationController } from './execution-authorization.controller';
import { ExecutionAuthorizationService } from './execution-authorization.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionAuthorizationController],
  providers: [ExecutionAuthorizationService],
})
export class ExecutionAuthorizationModule {}
