import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ExecutionPlanModule } from '../execution-plan/execution-plan.module';
import { CampaignPackageController } from './campaign-package.controller';
import { CampaignPackageHandoffService } from './campaign-package-handoff.service';
import { CampaignPackageMapper } from './campaign-package.mapper';
import { CampaignPackageService } from './campaign-package.service';

@Module({
  imports: [DatabaseModule, ExecutionPlanModule],
  controllers: [CampaignPackageController],
  providers: [CampaignPackageService, CampaignPackageMapper, CampaignPackageHandoffService],
  exports: [CampaignPackageService, CampaignPackageMapper, CampaignPackageHandoffService],
})
export class CampaignPackageModule {}
