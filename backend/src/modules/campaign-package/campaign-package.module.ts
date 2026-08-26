import { Module } from '@nestjs/common';
import { CampaignPackageController } from './campaign-package.controller';
import { CampaignPackageService } from './campaign-package.service';

@Module({
  controllers: [CampaignPackageController],
  providers: [CampaignPackageService],
  exports: [CampaignPackageService],
})
export class CampaignPackageModule {}
