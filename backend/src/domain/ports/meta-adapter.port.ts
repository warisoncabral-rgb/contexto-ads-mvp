import { MetaAssetBinding } from '../contracts/meta-connection';
import { MetaCapabilityType } from '../contracts/capability';

export interface MetaAdapterResult<T> {
  success: boolean;
  data?: T;
  observedAt: string;
  retryable: boolean;
  normalizedError?: 'AUTH_PERMISSION' | 'VALIDATION' | 'FINANCIAL' | 'PLATFORM_POLICY' | 'MEDIA' | 'TRANSIENT_API' | 'UNKNOWN';
  requestReference?: string;
}

export interface MetaAdapterPort {
  validateConnection(credentialRef: string): Promise<MetaAdapterResult<{ subjectId: string }>>;
  discoverAssets(credentialRef: string, tenantId: string): Promise<MetaAdapterResult<MetaAssetBinding[]>>;
  validateCapabilities(
    credentialRef: string,
    assetBindings: MetaAssetBinding[],
    requested: MetaCapabilityType[],
  ): Promise<MetaAdapterResult<Array<{ capability: MetaCapabilityType; available: boolean; reason?: string }>>>;
  readAdAccount(credentialRef: string, adAccountId: string): Promise<MetaAdapterResult<Record<string, unknown>>>;
}
