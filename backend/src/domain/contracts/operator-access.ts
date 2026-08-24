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
