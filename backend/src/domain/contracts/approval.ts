export interface ApprovalV1 {
  approvalId: string;
  tenantId: string;
  executionPlanId: string;
  planVersion: string;
  approvedPlanHash: string;
  actionType: string;
  riskLevel: 'low' | 'medium' | 'high';
  scope: string[];
  approvedBy?: string;
  approvedAt?: string;
  expiresAt?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked' | 'invalidated';
  correlationId: string;
}
