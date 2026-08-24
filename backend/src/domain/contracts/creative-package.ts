export type CreativeCallToAction =
  | 'LEARN_MORE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'CONTACT_US'
  | 'SEND_WHATSAPP_MESSAGE';

export interface CreativeCopyV1 {
  copyId: string;
  primaryText: string;
  headline: string;
  description?: string;
  callToAction: CreativeCallToAction;
}

export interface CreativeClaimV1 {
  claimId: string;
  text: string;
  sourceRefs: string[];
}

export interface CreativeAssetV1 {
  assetId: string;
  storageRef: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png' | 'video/mp4';
  width: number;
  height: number;
}

export interface CreativeReviewChecklistV1 {
  claimsVerifiedAgainstSources: boolean;
  visualFidelityReviewed: boolean;
  safeAreaReviewed: boolean;
  requiredFieldsReviewed: boolean;
  automaticEnhancementsReviewed: boolean;
}

export interface CreativePackageInputV1 {
  copies?: unknown;
  claims?: unknown;
  assets?: unknown;
  reviewChecklist?: unknown;
}

export interface CreativePackageV1 {
  creativePackageId: string;
  tenantId: string;
  campaignId: string;
  sourceExecutionPlanId: string;
  sourcePlanHash: string;
  version: number;
  schemaVersion: '1.0';
  status: 'needs_review' | 'approved' | 'superseded';
  copies: CreativeCopyV1[];
  claims: CreativeClaimV1[];
  assets: CreativeAssetV1[];
  reviewChecklist: CreativeReviewChecklistV1;
  validationIssues: string[];
  contentHash: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export type UnversionedCreativePackageV1 = Omit<CreativePackageV1, 'version'>;
