import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CreativePackageService } from './creative-package.service';

@Module({
  imports: [DatabaseModule],
  providers: [CreativePackageService],
  exports: [CreativePackageService],
})
export class CreativePackageModule {}
