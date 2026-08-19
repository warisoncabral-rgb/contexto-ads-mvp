import { Module } from '@nestjs/common';
import { MetaReadonlyAdapter } from './meta-readonly.adapter';

@Module({ providers: [MetaReadonlyAdapter], exports: [MetaReadonlyAdapter] })
export class MetaAdapterModule {}
