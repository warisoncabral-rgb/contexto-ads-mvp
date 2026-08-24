import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MetaAssetBinding, MetaConnection } from '../../domain/contracts/meta-connection';
import {
  MetaAssetBindingStore,
  MetaConnectionStore,
} from '../../domain/ports/repositories';
import { META_CONNECTION_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';

@Injectable()
export class MetaConnectionService {
  constructor(
    private readonly meta: MetaReadonlyAdapter,
    @Inject(META_CONNECTION_REPOSITORY)
    private readonly connections: MetaConnectionStore & MetaAssetBindingStore,
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
    this.assertConnectionId(connectionId);
    const connection = await this.connections.findById(tenantId, connectionId);
    if (!connection) throw new NotFoundException('Meta connection not found');
    return connection;
  }

  async validateReadOnly(credentialRef: string) {
    return this.meta.validateConnection(credentialRef);
  }

  async discoverAssets(tenantId: string, connectionId: string) {
    const connection = await this.getConnection(tenantId, connectionId);
    if (!['connected', 'ready'].includes(connection.status) || !connection.credentialRef) {
      throw new ConflictException('Meta connection is not ready for asset discovery');
    }

    const result = await this.meta.discoverAssets(connection.credentialRef, tenantId);
    if (!result.success || !result.data) return result;

    const bindings = result.data.map((binding): MetaAssetBinding => ({
      ...binding,
      tenantId,
      connectionId,
      selected: false,
      observedAt: result.observedAt,
    }));
    await this.connections.replaceBindings(tenantId, connectionId, bindings);

    return { ...result, data: bindings };
  }

  async listAssets(tenantId: string, connectionId: string) {
    await this.getConnection(tenantId, connectionId);
    return this.connections.listBindings(tenantId, connectionId);
  }

  private assertTenantId(tenantId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new BadRequestException('tenantId must be a valid UUID');
    }
  }

  private assertConnectionId(connectionId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) {
      throw new BadRequestException('connectionId must be a valid UUID');
    }
  }
}
