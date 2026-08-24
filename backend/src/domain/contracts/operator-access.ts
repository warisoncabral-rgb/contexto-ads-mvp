export type OperatorRole = 'owner' | 'operator' | 'viewer';

export interface OperatorPrincipalV1 {
  subject: string;
  provider: 'bootstrap_token' | 'oidc';
  authenticatedAt: string;
}

export interface OperatorTenantMembershipV1 {
  membershipId: string;
  operatorSubject: string;
  tenantId: string;
  tenantDisplayName: string;
  role: OperatorRole;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt?: string;
}

export type OperatorPermission =
  | 'view_workspace'
  | 'manage_campaign_preparation'
  | 'request_approval'
  | 'decide_approval'
  | 'configure_tenant';

export interface OperatorTenantAccessV1 {
  tenantId: string;
  displayName: string;
  role: OperatorRole;
  permissions: OperatorPermission[];
  membershipId: string;
}

export interface OperatorWorkspaceAccessV1 {
  operator: OperatorPrincipalV1;
  tenants: OperatorTenantAccessV1[];
  boundaries: {
    tenantAccessDerivedFromMembership: true;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}

export interface OperatorExecutionPlanSummaryV1 {
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  status: 'draft' | 'pending' | 'blocked' | 'ready_for_approval' | 'approved' | 'executing';
  campaignPackageVersion: number;
  maximumPlannedSpendMinor: number;
  currency: string;
  createdAt: string;
}

export interface OperatorTenantPlansV1 {
  tenantId: string;
  plans: OperatorExecutionPlanSummaryV1[];
  boundaries: {
    tenantAccessVerified: true;
    latestPlanPerCampaign: true;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}

export interface OperatorCampaignContextAccessV1 {
  tenantId: string;
  contexts: import('./campaign-context').CampaignContextPackageV1[];
  boundaries: {
    tenantAccessVerified: true;
    latestContextPerCampaign: true;
    publicationAuthorized: false;
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  generatedAt: string;
}
