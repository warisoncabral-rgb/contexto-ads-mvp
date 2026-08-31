import { MetaAssetBinding } from '../contracts/meta-connection';
import { MetaCapabilityType } from '../contracts/capability';
import { MetaCampaignInsightsV1 } from '../contracts/meta-insights';

export interface MetaAdapterResult<T> {
  success: boolean;
  data?: T;
  observedAt: string;
  retryable: boolean;
  normalizedError?: 'AUTH_PERMISSION' | 'VALIDATION' | 'FINANCIAL' | 'PLATFORM_POLICY' | 'MEDIA' | 'TRANSIENT_API' | 'UNKNOWN';
  diagnosticCode?: string;
  requestReference?: string;
}

export type DiscoveredMetaAsset = Pick<
  MetaAssetBinding,
  'assetType' | 'externalId' | 'displayName'
>;

export interface MetaCapabilityEvidence {
  capability: MetaCapabilityType;
  available: boolean;
  requiredPermissions: string[];
  grantedPermissions: string[];
  apiVersion: string;
  assetScope?: string;
  reason?: 'permission_missing' | 'asset_missing' | 'unsupported';
}

export interface MetaAdapterPort {
  validateConnection(tenantId: string, credentialRef: string): Promise<MetaAdapterResult<{ subjectId: string }>>;
  discoverAssets(credentialRef: string, tenantId: string): Promise<MetaAdapterResult<DiscoveredMetaAsset[]>>;
  validateCapabilities(
    tenantId: string,
    credentialRef: string,
    assetBindings: MetaAssetBinding[],
    requested: MetaCapabilityType[],
  ): Promise<MetaAdapterResult<MetaCapabilityEvidence[]>>;
  readAdAccount(tenantId: string, credentialRef: string, adAccountId: string): Promise<MetaAdapterResult<Record<string, unknown>>>;
  readCampaignInsights(
    tenantId: string,
    credentialRef: string,
    expectedAdAccountId: string,
    campaignId: string,
    periodStart: string,
    periodEnd: string,
    currency: string,
  ): Promise<MetaAdapterResult<MetaCampaignInsightsV1>>;
}
