export interface MetaOAuthAttempt {
  attemptId: string;
  tenantId: string;
  connectionId: string;
  stateHash: string;
  requestedScopes: string[];
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  invalidatedAt?: string;
}
