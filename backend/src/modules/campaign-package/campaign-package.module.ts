import { Module } from '@nestjs/common';
import { CampaignPackageController } from './campaign-package.controller';
import { CampaignPackageMapper } from './campaign-package.mapper';
import { CampaignPackageService } from './campaign-package.service';

@Module({
  controllers: [CampaignPackageController],
  providers: [CampaignPackageService, CampaignPackageMapper],
  exports: [CampaignPackageService, CampaignPackageMapper],
})
export class CampaignPackageModule {}
