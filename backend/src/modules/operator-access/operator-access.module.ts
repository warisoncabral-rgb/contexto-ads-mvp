import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperatorAccessInfrastructureModule } from '../../infrastructure/operator-access/operator-access.module';
import { OperatorAccessController } from './operator-access.controller';
import { OperatorAccessService } from './operator-access.service';
import { CampaignContextModule } from '../campaign-context/campaign-context.module';
import { ExecutionPlanModule } from '../execution-plan/execution-plan.module';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  imports: [
    DatabaseModule,
    OperatorAccessInfrastructureModule,
    CampaignContextModule,
    ExecutionPlanModule,
    ApprovalModule,
  ],
  controllers: [OperatorAccessController],
  providers: [OperatorAccessService],
})
export class OperatorAccessModule {}
