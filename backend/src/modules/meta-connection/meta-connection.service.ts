import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MetaConnection } from '../../domain/contracts/meta-connection';
import { MetaConnectionStore } from '../../domain/ports/repositories';
import { META_CONNECTION_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';

@Injectable()
export class MetaConnectionService {
  constructor(
    private readonly meta: MetaReadonlyAdapter,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections: MetaConnectionStore,
  ) {}

  async beginConnection(tenantId: string) {
    this.assertTenantId(tenantId);
    // O endpoint de autorização real será ligado ao OAuth da Meta quando o app for criado.
    const now = new Date().toISOString();
    const connection: MetaConnection = {
      tenantId,
      connectionId: randomUUID(),
      provider: 'meta',
      status: 'authorization_pending' as const,
      createdAt: now,
      updatedAt: now,
    };
    await this.connections.save(connection);

    return {
      ...connection,
      nextAction: 'configure_meta_app_and_oauth',
      externalWritePerformed: false,
    };
  }

  async getConnection(tenantId: string, connectionId: string) {
    this.assertTenantId(tenantId);
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection) throw new NotFoundException('Meta connection not found');
    return connection;
  }

  async validateReadOnly(credentialRef: string) {
    return this.meta.validateConnection(credentialRef);
  }

  private assertTenantId(tenantId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new BadRequestException('tenantId must be a valid UUID');
    }
  }
}
