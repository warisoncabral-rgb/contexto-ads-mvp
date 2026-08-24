import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CreativePackageController } from './creative-package.controller';
import { CreativePackageService } from './creative-package.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CreativePackageController],
  providers: [CreativePackageService],
  exports: [CreativePackageService],
})
export class CreativePackageModule {}
