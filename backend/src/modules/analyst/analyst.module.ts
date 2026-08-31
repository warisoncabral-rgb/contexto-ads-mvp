import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { DATABASE_POOL } from '../../infrastructure/database/database.tokens';
import { PostgresAnalystRepository } from '../../infrastructure/database/postgres-analyst.repository';
import { MetaInsightsModule } from '../meta-insights/meta-insights.module';
import { OperatorAccessModule } from '../operator-access/operator-access.module';
import { AnalystController } from './analyst.controller';
import { AnalystGovernanceService } from './analyst-governance.service';
import { AnalystLearningController } from './analyst-learning.controller';
import { AnalystLearningService } from './analyst-learning.service';
import { AnalystMetaCampaignResolverService } from './analyst-meta-campaign-resolver.service';
import { AnalystPresenter } from './analyst.presenter';
import { AnalystService } from './analyst.service';
import { ANALYST_REPOSITORY } from './analyst.tokens';

@Module({
  imports: [DatabaseModule, OperatorAccessModule, MetaInsightsModule],
  controllers: [AnalystController, AnalystLearningController],
  providers: [
    {
      provide: ANALYST_REPOSITORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresAnalystRepository(pool),
    },
    AnalystService,
    AnalystPresenter,
    AnalystMetaCampaignResolverService,
    AnalystGovernanceService,
    AnalystLearningService,
  ],
  exports: [
    AnalystService,
    AnalystPresenter,
    AnalystMetaCampaignResolverService,
    AnalystGovernanceService,
    AnalystLearningService,
  ],
})
export class AnalystModule {}
