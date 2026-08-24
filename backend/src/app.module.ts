import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetaConnectionModule } from './modules/meta-connection/meta-connection.module';
import { ReadinessModule } from './modules/readiness/readiness.module';
import { MetaOAuthModule } from './modules/meta-oauth/meta-oauth.module';
import { CapabilityRegistryModule } from './modules/capability-registry/capability-registry.module';
import { CampaignContextModule } from './modules/campaign-context/campaign-context.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MetaConnectionModule,
    ReadinessModule,
    MetaOAuthModule,
    CapabilityRegistryModule,
    CampaignContextModule,
  ],
})
export class AppModule {}
