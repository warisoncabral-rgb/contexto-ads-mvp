import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionPlanService } from './execution-plan.service';

@Module({
  imports: [DatabaseModule],
  providers: [ExecutionPlanService],
  exports: [ExecutionPlanService],
})
export class ExecutionPlanModule {}
