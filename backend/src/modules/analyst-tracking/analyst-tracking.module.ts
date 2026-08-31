import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AnalystTrackingService } from './analyst-tracking.service';

@Module({
  imports: [DatabaseModule],
  providers: [AnalystTrackingService],
  exports: [AnalystTrackingService],
})
export class AnalystTrackingModule {}
