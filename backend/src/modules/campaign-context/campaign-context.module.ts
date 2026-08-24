import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CampaignContextController } from './campaign-context.controller';
import { CampaignContextService } from './campaign-context.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CampaignContextController],
  providers: [CampaignContextService],
  exports: [CampaignContextService],
})
export class CampaignContextModule {}
