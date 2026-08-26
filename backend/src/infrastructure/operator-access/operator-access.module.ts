import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperatorIdentityPort } from '../../domain/ports/operator-identity.port';
import { BootstrapOperatorIdentityAdapter } from './bootstrap-operator-identity.adapter';
import { OPERATOR_IDENTITY } from './operator-access.tokens';

@Module({
  providers: [{
    provide: OPERATOR_IDENTITY,
    inject: [ConfigService],
    useFactory: (config: ConfigService): OperatorIdentityPort =>
      new BootstrapOperatorIdentityAdapter(config),
  }],
  exports: [OPERATOR_IDENTITY],
})
export class OperatorAccessInfrastructureModule {}
