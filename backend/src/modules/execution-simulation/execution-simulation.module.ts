import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ApprovalModule } from '../approval/approval.module';
import { CapabilityRegistryModule } from '../capability-registry/capability-registry.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { ExecutionSimulationController } from './execution-simulation.controller';
import { ExecutionSimulationService } from './execution-simulation.service';

@Module({
  imports: [
    DatabaseModule,
    ApprovalModule,
    CapabilityRegistryModule,
    MetaConnectionModule,
  ],
  controllers: [ExecutionSimulationController],
  providers: [ExecutionSimulationService],
  exports: [ExecutionSimulationService],
})
export class ExecutionSimulationModule {}
