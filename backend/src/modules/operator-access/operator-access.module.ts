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
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { MetaOAuthModule } from '../meta-oauth/meta-oauth.module';
import { OperatorMetaController } from './operator-meta.controller';
import { ReadinessModule } from '../readiness/readiness.module';
import { CapabilityRegistryModule } from '../capability-registry/capability-registry.module';
import { MetaExecutionModule } from '../meta-execution/meta-execution.module';
import { CampaignPackageModule } from '../campaign-package/campaign-package.module';
import { OperatorCampaignPackageController } from './operator-campaign-package.controller';
import { OperatorActionPingController } from './operator-action-ping.controller';
import { OperatorActionTransportController } from './operator-action-transport.controller';
import { PublicReadonlyActionGatewayController } from './public-readonly-action-gateway.controller';

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
    MetaConnectionModule,
    MetaOAuthModule,
    ReadinessModule,
    CapabilityRegistryModule,
    MetaExecutionModule,
    CampaignPackageModule,
  ],
  controllers: [
    OperatorAccessController,
    OperatorMetaController,
    OperatorCampaignPackageController,
    OperatorActionPingController,
    OperatorActionTransportController,
    PublicReadonlyActionGatewayController,
  ],
  providers: [OperatorAccessService],
  exports: [OperatorAccessService],
})
export class OperatorAccessModule {}
