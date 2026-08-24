import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaWriteValidationService } from './meta-write-validation.service';

@Module({
  imports: [DatabaseModule],
  providers: [MetaWriteValidationService],
  exports: [MetaWriteValidationService],
})
export class MetaWriteValidationModule {}
