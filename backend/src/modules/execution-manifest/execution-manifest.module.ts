import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperationalReadinessModule } from '../operational-readiness/operational-readiness.module';
import { ExecutionManifestService } from './execution-manifest.service';

@Module({
  imports: [DatabaseModule, OperationalReadinessModule],
  providers: [ExecutionManifestService],
  exports: [ExecutionManifestService],
})
export class ExecutionManifestModule {}
