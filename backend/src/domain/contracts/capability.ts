import { CapabilityStatus } from '../enums/states';

export type MetaCapabilityType =
  | 'READ_AD_ACCOUNT'
  | 'DISCOVER_ASSETS'
  | 'CREATE_CAMPAIGN'
  | 'CREATE_ADSET'
  | 'CREATE_CREATIVE'
  | 'CREATE_AD'
  | 'MANAGE_AD_STATUS'
  | 'READ_INSIGHTS'
  | 'CLICK_TO_WHATSAPP'
  | 'WHATSAPP_ASSET_MANAGEMENT'
  | 'WHATSAPP_SEND_MESSAGE';

export interface CapabilityRecord {
  capabilityId: string;
  tenantId: string;
  connectionId: string;
  capabilityType: MetaCapabilityType;
  assetScope?: string;
  requiredPermissions: string[];
  grantedPermissions: string[];
  status: CapabilityStatus;
  apiVersion?: string;
  restrictions: string[];
  validationSource: 'meta_api' | 'system_rule' | 'manual_evidence';
  validatedAt: string;
}
