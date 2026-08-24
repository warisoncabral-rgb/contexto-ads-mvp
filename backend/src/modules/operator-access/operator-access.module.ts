import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperatorAccessInfrastructureModule } from '../../infrastructure/operator-access/operator-access.module';
import { OperatorAccessController } from './operator-access.controller';
import { OperatorAccessService } from './operator-access.service';

@Module({
  imports: [DatabaseModule, OperatorAccessInfrastructureModule],
  controllers: [OperatorAccessController],
  providers: [OperatorAccessService],
})
export class OperatorAccessModule {}
