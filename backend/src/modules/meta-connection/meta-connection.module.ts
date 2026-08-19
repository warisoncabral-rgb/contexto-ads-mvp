import { Module } from '@nestjs/common';
import { MetaAdapterModule } from '../meta-adapter/meta-adapter.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaConnectionController } from './meta-connection.controller';
import { MetaConnectionService } from './meta-connection.service';

@Module({
  imports: [MetaAdapterModule, DatabaseModule],
  controllers: [MetaConnectionController],
  providers: [MetaConnectionService],
  exports: [MetaConnectionService],
})
export class MetaConnectionModule {}
