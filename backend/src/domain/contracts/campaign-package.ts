export type CampaignPackageSource = 'contexto_ads';
export type StrategyStatus = 'DRAFT' | 'IN_REVIEW' | 'COMPLETE';
export type HandoffStatus = 'READY_FOR_GENERATOR';
export type BudgetType = 'DAILY' | 'LIFETIME';
export type OfferType = 'product' | 'service' | 'catalog' | 'promotion' | 'lead_generation';
export type CampaignPackageObjective = 'LEADS';
export type ConversionDestination = 'WHATSAPP';
export type AdCallToAction = 'WHATSAPP_MESSAGE';
export type MediaType = 'image';

export interface CampaignPackageLocationV1 {
  city: string;
  state?: string;
  country: string;
  radius_km?: number;
  include?: boolean;
}

export interface CampaignPackageAdV1 {
  ad_reference: string;
  primary_text: string;
  headline?: string;
  description?: string;
  cta: AdCallToAction;
  initial_message?: string;
  media_id: string;
}

export interface CampaignPackageMediaV1 {
  media_id: string;
  media_type: MediaType;
  source: string;
  file_reference: string;
  checksum?: string;
}

export interface CampaignPackageV1 {
  package_id: string;
  package_version: number;
  created_at: string;
  source: CampaignPackageSource;

  client_id: string;
  business_name: string;
  business_description: string;

  offer_name: string;
  offer_description: string;
  offer_type: OfferType;
  commercial_conditions?: Record<string, unknown> | string;

  campaign_objective: CampaignPackageObjective;
  conversion_destination: ConversionDestination;
  campaign_goal_description: string;

  audience_description: string;
  locations: CampaignPackageLocationV1[];
  age_min?: number;
  age_max?: number;
  gender?: 'all' | 'male' | 'female';
  targeting_notes?: Record<string, unknown> | string;

  budget_type: BudgetType;
  budget_amount: number;
  currency: string;
  duration_days?: number;
  start_date?: string;
  end_date?: string;

  ads: CampaignPackageAdV1[];
  media: CampaignPackageMediaV1[];

  constraints?: Record<string, unknown> | string;
  strategy_notes?: Record<string, unknown> | string;

  strategy_status: StrategyStatus;
  handoff_status: HandoffStatus;

  ad_account_id?: string;
  facebook_page_id?: string;
  instagram_account_id?: string;
  whatsapp_asset_id?: string;
  meta_connection_id: string;
}

export interface CampaignPackageValidationResultV1 {
  validation_status: 'VALID' | 'INVALID';
  package_id?: string;
  package_version?: number;
  package_hash?: string;
  handoff_status?: 'ACCEPTED_BY_GENERATOR' | 'REJECTED_WITH_PENDENCIES';
  missing_fields: string[];
  blocking_reasons: string[];
  warnings: string[];
  external_effects: {
    meta_write_performed: false;
    spend_authorized: false;
    delivery_authorized: false;
  };
}
