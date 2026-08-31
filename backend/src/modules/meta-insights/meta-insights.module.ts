import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { OperatorAccessModule } from '../operator-access/operator-access.module';
import { MetaInsightsController } from './meta-insights.controller';
import { MetaInsightsService } from './meta-insights.service';

@Module({
  imports: [DatabaseModule, MetaAdapterModule, OperatorAccessModule],
  controllers: [MetaInsightsController],
  providers: [MetaInsightsService],
  exports: [MetaInsightsService],
})
export class MetaInsightsModule {}
