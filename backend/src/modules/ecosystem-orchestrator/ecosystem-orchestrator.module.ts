import { Module } from '@nestjs/common';
import { AnalystTrackingModule } from '../analyst-tracking/analyst-tracking.module';
import { AnalystModule } from '../analyst/analyst.module';
import { CampaignPackageModule } from '../campaign-package/campaign-package.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { OperatorAccessModule } from '../operator-access/operator-access.module';
import { EcosystemOrchestratorController } from './ecosystem-orchestrator.controller';
import { EcosystemOrchestratorService } from './ecosystem-orchestrator.service';

@Module({
  imports: [
    OperatorAccessModule,
    CampaignPackageModule,
    AnalystModule,
    AnalystTrackingModule,
    MetaConnectionModule,
  ],
  controllers: [EcosystemOrchestratorController],
  providers: [EcosystemOrchestratorService],
  exports: [EcosystemOrchestratorService],
})
export class EcosystemOrchestratorModule {}
