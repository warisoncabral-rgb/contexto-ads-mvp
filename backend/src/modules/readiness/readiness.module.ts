import { Module } from '@nestjs/common';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [MetaConnectionModule],
  controllers: [ReadinessController],
  providers: [ReadinessService],
})
export class ReadinessModule {}
