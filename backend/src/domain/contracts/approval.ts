export interface ApprovalV1 {
  approvalId: string;
  tenantId: string;
  executionPlanId: string;
  campaignId: string;
  planVersion: string;
  approvedPlanHash: string;
  actionType: string;
  riskLevel: 'low' | 'medium' | 'high';
  scope: string[];
  requestedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  expiresAt?: string;
  decisionReason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked' | 'invalidated';
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}
