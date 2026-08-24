import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionPlanController } from './execution-plan.controller';
import { ExecutionPlanService } from './execution-plan.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionPlanController],
  providers: [ExecutionPlanService],
  exports: [ExecutionPlanService],
})
export class ExecutionPlanModule {}
