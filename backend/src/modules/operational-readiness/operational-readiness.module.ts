import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionSimulationModule } from '../execution-simulation/execution-simulation.module';
import { OperationalReadinessService } from './operational-readiness.service';

@Module({
  imports: [DatabaseModule, ExecutionSimulationModule],
  providers: [OperationalReadinessService],
  exports: [OperationalReadinessService],
})
export class OperationalReadinessModule {}
