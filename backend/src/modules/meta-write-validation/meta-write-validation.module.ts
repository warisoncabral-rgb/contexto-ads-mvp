import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaWriteValidationController } from './meta-write-validation.controller';
import { MetaWriteValidationService } from './meta-write-validation.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MetaWriteValidationController],
  providers: [MetaWriteValidationService],
  exports: [MetaWriteValidationService],
})
export class MetaWriteValidationModule {}
