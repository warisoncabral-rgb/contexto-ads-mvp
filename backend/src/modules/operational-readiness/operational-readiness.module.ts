import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionSimulationModule } from '../execution-simulation/execution-simulation.module';
import { OperationalReadinessController } from './operational-readiness.controller';
import { OperationalReadinessService } from './operational-readiness.service';

@Module({
  imports: [DatabaseModule, ExecutionSimulationModule],
  controllers: [OperationalReadinessController],
  providers: [OperationalReadinessService],
  exports: [OperationalReadinessService],
})
export class OperationalReadinessModule {}
