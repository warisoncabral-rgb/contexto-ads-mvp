import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetaConnectionModule } from '../meta-connection/meta-connection.module';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';

@Module({
  imports: [DatabaseModule, MetaConnectionModule],
  controllers: [MetaOAuthController],
  providers: [MetaOAuthService],
})
export class MetaOAuthModule {}
