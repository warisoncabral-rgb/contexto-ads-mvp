import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { CapabilityStatus } from '../../domain/enums/states';
import { MetaCapabilityEvidence } from '../../domain/ports/meta-adapter.port';
import { CapabilityRepository } from '../../domain/ports/repositories';
import { CAPABILITY_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaReadonlyAdapter } from '../meta-adapter/meta-readonly.adapter';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

const READ_ONLY_CAPABILITIES = ['DISCOVER_ASSETS', 'READ_AD_ACCOUNT'] as const;

@Injectable()
export class CapabilityRegistryService {
  constructor(
    private readonly connections: MetaConnectionService,
    private readonly meta: MetaReadonlyAdapter,
    @Inject(CAPABILITY_REPOSITORY)
    private readonly capabilities: CapabilityRepository,
  ) {}

  async list(tenantId: string, connectionId: string) {
    await this.connections.getConnection(tenantId, connectionId);
    return this.capabilities.listForConnection(tenantId, connectionId);
  }

  async validateReadOnly(tenantId: string, connectionId: string) {
    const connection = await this.connections.getConnection(tenantId, connectionId);
    if (!['connected', 'ready'].includes(connection.status) || !connection.credentialRef) {
      throw new ConflictException('Meta connection is not ready for capability validation');
    }

    const bindings = await this.connections.listAssets(tenantId, connectionId);
    const result = await this.meta.validateCapabilities(
      tenantId,
      connection.credentialRef,
      bindings,
      [...READ_ONLY_CAPABILITIES],
    );
    if (!result.success || !result.data) return result;

    const records = result.data.map((evidence): CapabilityRecord => ({
      capabilityId: randomUUID(),
      tenantId,
      connectionId,
      capabilityType: evidence.capability,
      ...(evidence.assetScope ? { assetScope: evidence.assetScope } : {}),
      requiredPermissions: evidence.requiredPermissions,
      grantedPermissions: evidence.grantedPermissions,
      status: this.statusFor(evidence),
      apiVersion: evidence.apiVersion,
      restrictions: this.restrictionsFor(evidence),
      validationSource: 'meta_api',
      validatedAt: result.observedAt,
    }));
    await this.capabilities.replaceForConnection(tenantId, connectionId, records);

    return { ...result, data: records };
  }

  private statusFor(evidence: MetaCapabilityEvidence): CapabilityStatus {
    if (evidence.available) return 'available';
    if (evidence.reason === 'permission_missing') return 'permission_missing';
    if (evidence.reason === 'asset_missing') return 'asset_missing';
    if (evidence.reason === 'unsupported') return 'unsupported';
    return 'unknown';
  }

  private restrictionsFor(evidence: MetaCapabilityEvidence): string[] {
    if (evidence.reason === 'permission_missing') {
      return evidence.requiredPermissions
        .filter((permission) => !evidence.grantedPermissions.includes(permission))
        .map((permission) => `missing_permission:${permission}`);
    }
    if (evidence.reason === 'asset_missing') return ['no_discovered_ad_account'];
    if (evidence.reason === 'unsupported') return ['not_implemented_in_read_only_phase'];
    return [];
  }
}
