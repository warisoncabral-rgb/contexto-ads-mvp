import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaAdapterPort, MetaAdapterResult } from '../../domain/ports/meta-adapter.port';
import { MetaAssetBinding } from '../../domain/contracts/meta-connection';
import { MetaCapabilityType } from '../../domain/contracts/capability';

@Injectable()
export class MetaReadonlyAdapter implements MetaAdapterPort {
  constructor(private readonly config: ConfigService) {}

  private notConfigured<T>(): MetaAdapterResult<T> {
    return {
      success: false,
      observedAt: new Date().toISOString(),
      retryable: false,
      normalizedError: 'AUTH_PERMISSION',
    };
  }

  async validateConnection(_credentialRef: string) {
    // TODO Fase 1: resolver credentialRef via Vault e chamar endpoint oficial de identidade.
    // Até META_APP_ID + fluxo OAuth real existirem, este adapter permanece fail-closed.
    if (!this.config.get<string>('META_APP_ID')) return this.notConfigured<{ subjectId: string }>();
    return this.notConfigured<{ subjectId: string }>();
  }

  async discoverAssets(_credentialRef: string, _tenantId: string) {
    // TODO: implementar descoberta somente leitura via Graph API após onboarding real.
    return this.notConfigured<MetaAssetBinding[]>();
  }

  async validateCapabilities(
    _credentialRef: string,
    _assetBindings: MetaAssetBinding[],
    _requested: MetaCapabilityType[],
  ) {
    return this.notConfigured<Array<{ capability: MetaCapabilityType; available: boolean; reason?: string }>>();
  }

  async readAdAccount(_credentialRef: string, _adAccountId: string) {
    return this.notConfigured<Record<string, unknown>>();
  }
}
