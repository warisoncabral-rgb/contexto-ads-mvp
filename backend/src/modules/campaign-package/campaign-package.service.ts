import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CampaignPackageV1,
  CampaignPackageValidationResultV1,
} from '../../domain/contracts/campaign-package';

@Injectable()
export class CampaignPackageService {
  validate(input: unknown): CampaignPackageValidationResultV1 {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Campaign Package V1 must be a JSON object');
    }

    const pkg = input as Partial<CampaignPackageV1>;
    const missing: string[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    const requiredTextFields: Array<keyof CampaignPackageV1> = [
      'package_id',
      'created_at',
      'client_id',
      'business_name',
      'business_description',
      'offer_name',
      'offer_description',
      'campaign_goal_description',
      'audience_description',
      'currency',
      'meta_connection_id',
    ];

    for (const field of requiredTextFields) {
      if (!this.nonEmptyString(pkg[field])) missing.push(String(field));
    }

    if (!Number.isInteger(pkg.package_version) || Number(pkg.package_version) < 1) {
      missing.push('package_version');
    }
    if (pkg.source !== 'contexto_ads') blockers.push('source must be contexto_ads');
    if (pkg.offer_type === undefined) missing.push('offer_type');
    if (pkg.campaign_objective !== 'LEADS') blockers.push('campaign_objective must be LEADS in V1');
    if (pkg.conversion_destination !== 'WHATSAPP') {
      blockers.push('conversion_destination must be WHATSAPP in V1');
    }
    if (pkg.strategy_status !== 'COMPLETE') {
      blockers.push('strategy_status must be COMPLETE before handoff');
    }
    if (pkg.handoff_status !== 'READY_FOR_GENERATOR') {
      blockers.push('handoff_status must be READY_FOR_GENERATOR');
    }

    if (!Array.isArray(pkg.locations) || pkg.locations.length === 0) {
      missing.push('locations');
    } else {
      pkg.locations.forEach((location, index) => {
        if (!this.nonEmptyString(location?.city)) missing.push(`locations[${index}].city`);
        if (!this.nonEmptyString(location?.country)) missing.push(`locations[${index}].country`);
        if (location?.radius_km !== undefined && (!Number.isFinite(location.radius_km) || location.radius_km <= 0)) {
          blockers.push(`locations[${index}].radius_km must be greater than zero`);
        }
      });
    }

    if (pkg.budget_type !== 'DAILY' && pkg.budget_type !== 'LIFETIME') {
      missing.push('budget_type');
    }
    if (!Number.isFinite(pkg.budget_amount) || Number(pkg.budget_amount) <= 0) {
      missing.push('budget_amount');
    }
    if (pkg.budget_type === 'DAILY' && (!Number.isInteger(pkg.duration_days) || Number(pkg.duration_days) < 1)) {
      missing.push('duration_days');
    }
    if (pkg.age_min !== undefined && (!Number.isInteger(pkg.age_min) || pkg.age_min < 18 || pkg.age_min > 65)) {
      blockers.push('age_min must be an integer between 18 and 65');
    }
    if (pkg.age_max !== undefined && (!Number.isInteger(pkg.age_max) || pkg.age_max < 18 || pkg.age_max > 65)) {
      blockers.push('age_max must be an integer between 18 and 65');
    }
    if (pkg.age_min !== undefined && pkg.age_max !== undefined && pkg.age_min > pkg.age_max) {
      blockers.push('age_min cannot be greater than age_max');
    }

    if (!Array.isArray(pkg.ads) || pkg.ads.length < 1 || pkg.ads.length > 3) {
      blockers.push('ads must contain between 1 and 3 items in V1');
    }
    if (!Array.isArray(pkg.media) || pkg.media.length < 1) {
      missing.push('media');
    }

    const mediaIds = new Set<string>();
    if (Array.isArray(pkg.media)) {
      pkg.media.forEach((media, index) => {
        if (!this.nonEmptyString(media?.media_id)) missing.push(`media[${index}].media_id`);
        else if (mediaIds.has(media.media_id)) blockers.push(`duplicate media_id: ${media.media_id}`);
        else mediaIds.add(media.media_id);
        if (media?.media_type !== 'image') blockers.push(`media[${index}].media_type must be image in V1`);
        if (!this.nonEmptyString(media?.source)) missing.push(`media[${index}].source`);
        if (!this.nonEmptyString(media?.file_reference)) missing.push(`media[${index}].file_reference`);
      });
    }

    const adReferences = new Set<string>();
    if (Array.isArray(pkg.ads)) {
      pkg.ads.forEach((ad, index) => {
        if (!this.nonEmptyString(ad?.ad_reference)) missing.push(`ads[${index}].ad_reference`);
        else if (adReferences.has(ad.ad_reference)) blockers.push(`duplicate ad_reference: ${ad.ad_reference}`);
        else adReferences.add(ad.ad_reference);
        if (!this.nonEmptyString(ad?.primary_text)) missing.push(`ads[${index}].primary_text`);
        if (ad?.cta !== 'WHATSAPP_MESSAGE') blockers.push(`ads[${index}].cta must be WHATSAPP_MESSAGE`);
        if (!this.nonEmptyString(ad?.media_id)) missing.push(`ads[${index}].media_id`);
        else if (!mediaIds.has(ad.media_id)) blockers.push(`ads[${index}].media_id does not reference an existing media item`);
      });
    }

    if (!this.nonEmptyString(pkg.ad_account_id)) warnings.push('ad_account_id will need to be resolved before execution');
    if (!this.nonEmptyString(pkg.facebook_page_id)) warnings.push('facebook_page_id will need to be resolved before execution');
    if (!this.nonEmptyString(pkg.whatsapp_asset_id)) warnings.push('whatsapp_asset_id will need to be resolved before execution');

    const uniqueMissing = [...new Set(missing)];
    const uniqueBlockers = [...new Set(blockers)];
    const valid = uniqueMissing.length === 0 && uniqueBlockers.length === 0;
    const hash = valid ? this.hash(pkg as CampaignPackageV1) : undefined;

    return {
      validation_status: valid ? 'VALID' : 'INVALID',
      package_id: this.nonEmptyString(pkg.package_id) ? pkg.package_id : undefined,
      package_version: Number.isInteger(pkg.package_version) ? pkg.package_version : undefined,
      package_hash: hash,
      handoff_status: valid ? 'ACCEPTED_BY_GENERATOR' : 'REJECTED_WITH_PENDENCIES',
      missing_fields: uniqueMissing,
      blocking_reasons: uniqueBlockers,
      warnings,
      external_effects: {
        meta_write_performed: false,
        spend_authorized: false,
        delivery_authorized: false,
      },
    };
  }

  private hash(pkg: CampaignPackageV1) {
    return createHash('sha256').update(this.stableStringify(pkg)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
