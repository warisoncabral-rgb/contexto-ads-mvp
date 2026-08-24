import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ApprovalService } from './approval.service';

@Module({
  imports: [DatabaseModule],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
