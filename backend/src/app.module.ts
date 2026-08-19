import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetaConnectionModule } from './modules/meta-connection/meta-connection.module';
import { ReadinessModule } from './modules/readiness/readiness.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MetaConnectionModule,
    ReadinessModule,
  ],
})
export class AppModule {}
