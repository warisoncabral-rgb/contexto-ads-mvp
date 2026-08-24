export interface ExecutionSimulationCheck {
  key:
    | 'plan_current'
    | 'dependency_graph'
    | 'meta_connection'
    | 'ad_account_binding'
    | 'write_capabilities'
    | 'plan_approval'
    | 'creative_approval'
    | 'external_write_guard';
  status: 'passed' | 'blocked';
  meaning: string;
  evidenceRefs: string[];
  nextAction?: string;
}

export interface SimulatedOperation {
  order: number;
  internalObjectId: string;
  objectType: 'campaign' | 'ad_set' | 'creative' | 'ad';
  action: 'create_campaign' | 'create_ad_set' | 'create_creative' | 'create_ad';
  dependsOn: string[];
  intendedLifecycleStatus: 'PAUSED';
  willExecute: false;
}

export interface ExecutionSimulationReportV1 {
  simulationId: string;
  tenantId: string;
  campaignId: string;
  executionPlanId: string;
  planHash: string;
  approvalId?: string;
  status: 'blocked' | 'ready_for_execution';
  checks: ExecutionSimulationCheck[];
  operations: SimulatedOperation[];
  blockers: string[];
  externalEffects: {
    writesAllowed: false;
    writesPerformed: false;
  };
  generatedAt: string;
}
