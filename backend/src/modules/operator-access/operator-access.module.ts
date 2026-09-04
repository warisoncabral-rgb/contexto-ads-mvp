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
import { OperatorCampaignExecutionActionController } from './operator-campaign-execution-action.controller';
import { OperatorStrategyHandoffController } from './operator-strategy-handoff.controller';
import { StrategyHandoffPersistenceService } from './strategy-handoff-persistence.service';
import { OperatorActionPingController } from './operator-action-ping.controller';
import { OperatorActionTransportController } from './operator-action-transport.controller';
import { PublicReadonlyActionGatewayController } from './public-readonly-action-gateway.controller';
import { CampaignMediaService } from './campaign-media.service';
import { PublicCampaignMediaController } from './public-campaign-media.controller';
import { CampaignAutomationService } from './campaign-automation.service';
import { CampaignAutomationController } from './campaign-automation.controller';
import { IntegrationDiagnosticController } from './integration-diagnostic.controller';
import { SelectivePublicationController } from './selective-publication.controller';

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
    OperatorCampaignExecutionActionController,
    OperatorStrategyHandoffController,
    OperatorActionPingController,
    OperatorActionTransportController,
    PublicReadonlyActionGatewayController,
    PublicCampaignMediaController,
    CampaignAutomationController,
    IntegrationDiagnosticController,
    SelectivePublicationController,
  ],
  providers: [
    OperatorAccessService,
    StrategyHandoffPersistenceService,
    CampaignMediaService,
    CampaignAutomationService,
  ],
  exports: [OperatorAccessService, CampaignMediaService, CampaignAutomationService],
})
export class OperatorAccessModule {}
