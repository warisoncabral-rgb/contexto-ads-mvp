import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';

@Injectable()
export class MetaConnectionService {
  constructor(private readonly meta: MetaReadonlyAdapter) {}

  async beginConnection(tenantId: string) {
    // O endpoint de autorização real será ligado ao OAuth da Meta quando o app for criado.
    return {
      tenantId,
      connectionId: randomUUID(),
      status: 'authorization_pending' as const,
      nextAction: 'configure_meta_app_and_oauth',
      externalWritePerformed: false,
    };
  }

  async validateReadOnly(credentialRef: string) {
    return this.meta.validateConnection(credentialRef);
  }
}
