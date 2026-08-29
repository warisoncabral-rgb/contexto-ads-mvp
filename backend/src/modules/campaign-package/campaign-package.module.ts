import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CreativePackageModule } from '../creative-package/creative-package.module';
import { ExecutionPlanModule } from '../execution-plan/execution-plan.module';
import { ExecutionSimulationModule } from '../execution-simulation/execution-simulation.module';
import { CampaignPackageController } from './campaign-package.controller';
import { CampaignPackageHandoffService } from './campaign-package-handoff.service';
import { CampaignPackageMapper } from './campaign-package.mapper';
import { CampaignPackageService } from './campaign-package.service';
import { CampaignPackageStatusService } from './campaign-package-status.service';

@Module({
  imports: [
    DatabaseModule,
    ExecutionPlanModule,
    CreativePackageModule,
    ExecutionSimulationModule,
  ],
  controllers: [CampaignPackageController],
  providers: [
    CampaignPackageService,
    CampaignPackageMapper,
    CampaignPackageHandoffService,
    CampaignPackageStatusService,
  ],
  exports: [
    CampaignPackageService,
    CampaignPackageMapper,
    CampaignPackageHandoffService,
    CampaignPackageStatusService,
  ],
})
export class CampaignPackageModule {}
