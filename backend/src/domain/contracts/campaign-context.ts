export type CampaignObjective =
  | 'awareness'
  | 'traffic'
  | 'engagement'
  | 'leads'
  | 'app_promotion'
  | 'sales';

export type CampaignDestination =
  | 'website'
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'instant_form'
  | 'app'
  | 'phone'
  | 'physical_location'
  | 'other';

export type CampaignContextStatus = 'needs_information' | 'ready_for_generation';
export type CampaignFactSource = 'user_input';

export interface SourcedCampaignFact<T> {
  value: T;
  source: CampaignFactSource;
  evidenceRefs: string[];
  recordedAt: string;
}

export interface CampaignBudget {
  mode: 'daily' | 'lifetime';
  amountMinor: number;
  currency: string;
}

export interface CampaignContextFacts {
  businessName?: SourcedCampaignFact<string>;
  offer?: SourcedCampaignFact<string>;
  objective?: SourcedCampaignFact<CampaignObjective>;
  audience?: SourcedCampaignFact<string>;
  destination?: SourcedCampaignFact<CampaignDestination>;
  geography?: SourcedCampaignFact<string>;
  budget?: SourcedCampaignFact<CampaignBudget>;
  durationDays?: SourcedCampaignFact<number>;
}

export interface CampaignContextInput {
  businessName?: unknown;
  offer?: unknown;
  objective?: unknown;
  audience?: unknown;
  destination?: unknown;
  geography?: unknown;
  budget?: unknown;
  durationDays?: unknown;
}

export type CampaignContextField = keyof CampaignContextFacts;

export interface CampaignContextIssue {
  code: 'required_fact_missing';
  field: CampaignContextField;
  severity: 'blocker';
  message: string;
  nextAction: string;
}

export interface CampaignContextPackageV1 {
  packageId: string;
  tenantId: string;
  campaignId: string;
  version: number;
  schemaVersion: '1.0';
  status: CampaignContextStatus;
  facts: CampaignContextFacts;
  inferences: [];
  validationIssues: CampaignContextIssue[];
  contentHash: string;
  createdAt: string;
}

export type UnversionedCampaignContextPackageV1 = Omit<
  CampaignContextPackageV1,
  'version'
>;
