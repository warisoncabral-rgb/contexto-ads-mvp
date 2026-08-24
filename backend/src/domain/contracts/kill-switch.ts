export type KillSwitchScope = 'tenant' | 'campaign';
export type KillSwitchStatus = 'engaged' | 'released';

export interface KillSwitchStateV1 {
  killSwitchStateId: string;
  tenantId: string;
  scope: KillSwitchScope;
  campaignId?: string;
  version: number;
  status: KillSwitchStatus;
  reason: string;
  changedBy: string;
  correlationId: string;
  changedAt: string;
}

export type UnversionedKillSwitchStateV1 = Omit<KillSwitchStateV1, 'version'>;

export interface EffectiveKillSwitchV1 {
  tenantId: string;
  campaignId: string;
  writesBlocked: boolean;
  decision: 'blocked_missing_state' | 'blocked_engaged' | 'released';
  tenant: {
    known: boolean;
    status: KillSwitchStatus | 'missing';
    stateId?: string;
    version?: number;
  };
  campaign: {
    known: boolean;
    status: KillSwitchStatus | 'missing';
    stateId?: string;
    version?: number;
  };
  boundaries: {
    externalWritesAllowed: false;
    externalWritesPerformed: false;
  };
  evaluatedAt: string;
}
