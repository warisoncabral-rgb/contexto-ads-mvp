import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MetaAssetBinding,
  MetaAssetSelection,
  MetaConnection,
} from '../../domain/contracts/meta-connection';
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

  async validateReadOnly(tenantId: string, credentialRef: string) {
    return this.meta.validateConnection(tenantId, credentialRef);
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

  async selectAssets(tenantId: string, connectionId: string, input: unknown) {
    const connection = await this.getConnection(tenantId, connectionId);
    if (!['connected', 'ready'].includes(connection.status) || !connection.credentialRef) {
      throw new ConflictException('Meta connection is not ready for asset selection');
    }
    const selections = this.parseSelections(input);
    const bindings = await this.connections.listBindings(tenantId, connectionId);
    const discovered = new Set(bindings.map(
      (binding) => `${binding.assetType}:${binding.externalId}`,
    ));
    if (selections.some(
      (selection) => !discovered.has(`${selection.assetType}:${selection.externalId}`),
    )) {
      throw new BadRequestException('Every selected asset must exist in the discovery snapshot');
    }
    const assets = await this.connections.selectBindings(tenantId, connectionId, selections);
    return {
      tenantId,
      connectionId,
      assets,
      boundaries: {
        discoverySnapshotOnly: true,
        externalWritesAllowed: false,
        externalWritesPerformed: false,
      },
    };
  }

  async readDiscoveredAdAccount(
    tenantId: string,
    connectionId: string,
    adAccountId: string,
  ) {
    this.assertTenantId(tenantId);
    this.assertConnectionId(connectionId);
    this.assertAdAccountId(adAccountId);

    const connection = await this.getConnection(tenantId, connectionId);
    if (!['connected', 'ready'].includes(connection.status) || !connection.credentialRef) {
      throw new ConflictException('Meta connection is not ready for account reads');
    }

    const bindings = await this.connections.listBindings(tenantId, connectionId);
    const isDiscovered = bindings.some(
      (binding) => binding.assetType === 'ad_account' && binding.externalId === adAccountId,
    );
    if (!isDiscovered) throw new NotFoundException('Meta ad account not found');

    return this.meta.readAdAccount(tenantId, connection.credentialRef, adAccountId);
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

  private assertAdAccountId(adAccountId: string): void {
    if (!/^act_\d+$/.test(adAccountId)) {
      throw new BadRequestException('adAccountId must use the act_<digits> format');
    }
  }

  private parseSelections(input: unknown): MetaAssetSelection[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > 5) {
      throw new BadRequestException('assets must contain one selection per asset type');
    }
    const selections: MetaAssetSelection[] = [];
    const types = new Set<string>();
    for (const value of input) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('Each asset selection must be an object');
      }
      const assetType = (value as Record<string, unknown>).assetType;
      const externalId = (value as Record<string, unknown>).externalId;
      if (!['business', 'ad_account', 'facebook_page', 'instagram_account', 'whatsapp']
        .includes(String(assetType)) || typeof externalId !== 'string'
        || externalId.length > 64 || types.has(String(assetType))) {
        throw new BadRequestException('Asset selections must be unique and well formed');
      }
      if (assetType === 'ad_account' ? !/^act_\d+$/.test(externalId) : !/^\d+$/.test(externalId)) {
        throw new BadRequestException('Asset id format is invalid');
      }
      types.add(String(assetType));
      selections.push({ assetType: assetType as MetaAssetBinding['assetType'], externalId });
    }
    if (!types.has('ad_account')) {
      throw new BadRequestException('Exactly one discovered ad account must be selected');
    }
    return selections;
  }
}
