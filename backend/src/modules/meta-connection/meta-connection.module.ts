import { Module } from '@nestjs/common';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OperatorAccessInfrastructureModule } from '../../infrastructure/operator-access/operator-access.module';
import { MetaConnectionController } from './meta-connection.controller';
import { MetaConnectionService } from './meta-connection.service';
import { MetaTenantOwnerGuard } from './meta-tenant-owner.guard';

@Module({
  imports: [MetaAdapterModule, DatabaseModule, OperatorAccessInfrastructureModule],
  controllers: [MetaConnectionController],
  providers: [MetaConnectionService, MetaTenantOwnerGuard],
  exports: [MetaConnectionService, MetaTenantOwnerGuard],
})
export class MetaConnectionModule {}
