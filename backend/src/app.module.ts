import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetaConnectionModule } from './modules/meta-connection/meta-connection.module';
import { ReadinessModule } from './modules/readiness/readiness.module';
import { MetaOAuthModule } from './modules/meta-oauth/meta-oauth.module';
import { CapabilityRegistryModule } from './modules/capability-registry/capability-registry.module';
import { CampaignContextModule } from './modules/campaign-context/campaign-context.module';
import { ExecutionPlanModule } from './modules/execution-plan/execution-plan.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { ExecutionSimulationModule } from './modules/execution-simulation/execution-simulation.module';
import { CreativePackageModule } from './modules/creative-package/creative-package.module';
import { OperationalReadinessModule } from './modules/operational-readiness/operational-readiness.module';
import { ExecutionManifestModule } from './modules/execution-manifest/execution-manifest.module';
import { ExecutionAuthorizationModule } from './modules/execution-authorization/execution-authorization.module';
import { KillSwitchModule } from './modules/kill-switch/kill-switch.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MetaConnectionModule,
    ReadinessModule,
    MetaOAuthModule,
    CapabilityRegistryModule,
    CampaignContextModule,
    ExecutionPlanModule,
    ApprovalModule,
    ExecutionSimulationModule,
    CreativePackageModule,
    OperationalReadinessModule,
    ExecutionManifestModule,
    ExecutionAuthorizationModule,
    KillSwitchModule,
  ],
})
export class AppModule {}
