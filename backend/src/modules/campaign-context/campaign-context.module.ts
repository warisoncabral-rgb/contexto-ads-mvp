import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CampaignContextService } from './campaign-context.service';

@Module({
  imports: [DatabaseModule],
  providers: [CampaignContextService],
  exports: [CampaignContextService],
})
export class CampaignContextModule {}
