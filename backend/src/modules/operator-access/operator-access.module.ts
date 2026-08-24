import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperatorAccessInfrastructureModule } from '../../infrastructure/operator-access/operator-access.module';
import { OperatorAccessController } from './operator-access.controller';
import { OperatorAccessService } from './operator-access.service';
import { CampaignContextModule } from '../campaign-context/campaign-context.module';
import { ExecutionPlanModule } from '../execution-plan/execution-plan.module';
import { ApprovalModule } from '../approval/approval.module';
import { OperationalReadinessModule } from '../operational-readiness/operational-readiness.module';
import { ExecutionSimulationModule } from '../execution-simulation/execution-simulation.module';
import { CreativePackageModule } from '../creative-package/creative-package.module';
import { ExecutionManifestModule } from '../execution-manifest/execution-manifest.module';
import { ExecutionAuthorizationModule } from '../execution-authorization/execution-authorization.module';
import { KillSwitchModule } from '../kill-switch/kill-switch.module';
import { MetaWriteValidationModule } from '../meta-write-validation/meta-write-validation.module';

@Module({
  imports: [
    DatabaseModule,
    OperatorAccessInfrastructureModule,
    CampaignContextModule,
    ExecutionPlanModule,
    ApprovalModule,
    OperationalReadinessModule,
    ExecutionSimulationModule,
    CreativePackageModule,
    ExecutionManifestModule,
    ExecutionAuthorizationModule,
    KillSwitchModule,
    MetaWriteValidationModule,
  ],
  controllers: [OperatorAccessController],
  providers: [OperatorAccessService],
})
export class OperatorAccessModule {}
