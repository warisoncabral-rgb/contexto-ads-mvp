import { MetaConnectionStatus } from '../enums/states';

export interface MetaConnection {
  connectionId: string;
  tenantId: string;
  provider: 'meta';
  status: MetaConnectionStatus;
  credentialRef?: string; // referência ao Vault; nunca o token
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
}

export interface MetaAssetBinding {
  tenantId: string;
  connectionId: string;
  assetType: 'business' | 'ad_account' | 'facebook_page' | 'instagram_account' | 'whatsapp';
  externalId: string;
  displayName?: string;
  selected: boolean;
  observedAt: string;
}
