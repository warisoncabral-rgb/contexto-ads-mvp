import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperationalReadinessModule } from '../operational-readiness/operational-readiness.module';
import { ExecutionManifestController } from './execution-manifest.controller';
import { ExecutionManifestService } from './execution-manifest.service';

@Module({
  imports: [DatabaseModule, OperationalReadinessModule],
  controllers: [ExecutionManifestController],
  providers: [ExecutionManifestService],
})
export class ExecutionManifestModule {}
