import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CampaignPackageV1,
  CampaignPackageValidationResultV1,
  ConversionDestination,
} from '../../domain/contracts/campaign-package';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;
const OFFER_TYPES = new Set(['product', 'service', 'catalog', 'promotion', 'lead_generation']);
const OBJECTIVES = new Set(['AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEADS', 'APP_PROMOTION', 'SALES']);
const DESTINATIONS = new Set([
  'WHATSAPP', 'INSTAGRAM', 'FACEBOOK_PAGE', 'MESSENGER', 'WEBSITE', 'PHONE',
  'INSTANT_FORM', 'APP', 'PHYSICAL_LOCATION', 'OTHER',
]);
const CTAS = new Set(['WHATSAPP_MESSAGE', 'LEARN_MORE', 'CONTACT_US', 'SIGN_UP', 'SHOP_NOW']);

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
      'package_id', 'created_at', 'client_id', 'business_name',
      'business_description', 'offer_name', 'offer_description',
      'campaign_goal_description', 'audience_description', 'currency',
      'meta_connection_id',
    ];
    for (const field of requiredTextFields) {
      if (!this.nonEmptyString(pkg[field])) missing.push(String(field));
    }

    if (this.nonEmptyString(pkg.package_id) && !UUID_PATTERN.test(pkg.package_id)) {
      blockers.push('package_id must be a valid UUID');
    }
    if (this.nonEmptyString(pkg.created_at) && Number.isNaN(Date.parse(pkg.created_at))) {
      blockers.push('created_at must be a valid ISO date-time');
    }
    if (!Number.isInteger(pkg.package_version) || Number(pkg.package_version) < 1) {
      missing.push('package_version');
    }
    if (pkg.source !== 'contexto_ads') blockers.push('source must be contexto_ads');
    if (!OFFER_TYPES.has(String(pkg.offer_type))) blockers.push('offer_type is not supported');
    if (!OBJECTIVES.has(String(pkg.campaign_objective))) {
      blockers.push('campaign_objective is not supported');
    }
    if (!DESTINATIONS.has(String(pkg.conversion_destination))) {
      blockers.push('conversion_destination is not supported');
    }
    this.validateDestination(pkg, missing, blockers);

    if (pkg.strategy_status !== 'COMPLETE') {
      blockers.push('strategy_status must be COMPLETE before handoff');
    }
    if (pkg.handoff_status !== 'READY_FOR_GENERATOR') {
      blockers.push('handoff_status must be READY_FOR_GENERATOR');
    }
    if (this.nonEmptyString(pkg.currency) && !/^[A-Z]{3}$/.test(pkg.currency)) {
      blockers.push('currency must be a 3-letter uppercase code');
    }

    if (!Array.isArray(pkg.locations) || pkg.locations.length === 0) {
      missing.push('locations');
    } else {
      pkg.locations.forEach((location, index) => {
        if (!this.nonEmptyString(location?.city)) missing.push(`locations[${index}].city`);
        if (!this.nonEmptyString(location?.country)) missing.push(`locations[${index}].country`);
        if (location?.radius_km !== undefined
          && (!Number.isFinite(Number(location.radius_km)) || location.radius_km <= 0)) {
          blockers.push(`locations[${index}].radius_km must be greater than zero`);
        }
      });
    }

    if (pkg.budget_type !== 'DAILY' && pkg.budget_type !== 'LIFETIME') {
      missing.push('budget_type');
    }
    if (!Number.isFinite(Number(pkg.budget_amount)) || Number(pkg.budget_amount) <= 0) {
      missing.push('budget_amount');
    }
    if (pkg.budget_type === 'DAILY'
      && (!Number.isInteger(pkg.duration_days) || Number(pkg.duration_days) < 1)) {
      missing.push('duration_days');
    }
    if (pkg.age_min !== undefined
      && (!Number.isInteger(pkg.age_min) || pkg.age_min < 18 || pkg.age_min > 65)) {
      blockers.push('age_min must be an integer between 18 and 65');
    }
    if (pkg.age_max !== undefined
      && (!Number.isInteger(pkg.age_max) || pkg.age_max < 18 || pkg.age_max > 65)) {
      blockers.push('age_max must be an integer between 18 and 65');
    }
    if (pkg.age_min !== undefined && pkg.age_max !== undefined && pkg.age_min > pkg.age_max) {
      blockers.push('age_min cannot be greater than age_max');
    }

    if (!Array.isArray(pkg.ads) || pkg.ads.length < 1 || pkg.ads.length > 3) {
      blockers.push('ads must contain between 1 and 3 items in V1');
    }
    if (!Array.isArray(pkg.media) || pkg.media.length < 1) missing.push('media');

    const mediaIds = new Set<string>();
    if (Array.isArray(pkg.media)) {
      pkg.media.forEach((media, index) => {
        if (!this.nonEmptyString(media?.media_id)) missing.push(`media[${index}].media_id`);
        else if (mediaIds.has(media.media_id)) blockers.push(`duplicate media_id: ${media.media_id}`);
        else mediaIds.add(media.media_id);

        if (media?.media_type !== 'image' && media?.media_type !== 'video') {
          blockers.push(`media[${index}].media_type must be image or video in V1`);
        }
        if (!this.nonEmptyString(media?.source)) missing.push(`media[${index}].source`);
        if (!this.nonEmptyString(media?.file_reference)) missing.push(`media[${index}].file_reference`);
        if (!this.nonEmptyString(media?.checksum)) missing.push(`media[${index}].checksum`);
        else if (!SHA256_PATTERN.test(media.checksum)) blockers.push(`media[${index}].checksum must be SHA-256`);

        const validImageMime = media?.media_type === 'image'
          && (media?.mime_type === 'image/jpeg' || media?.mime_type === 'image/png');
        const validVideoMime = media?.media_type === 'video' && media?.mime_type === 'video/mp4';
        if (!validImageMime && !validVideoMime) {
          blockers.push(`media[${index}].mime_type must match media_type (image/jpeg, image/png or video/mp4)`);
        }
        if (!Number.isInteger(media?.width) || Number(media?.width) < 1) missing.push(`media[${index}].width`);
        if (!Number.isInteger(media?.height) || Number(media?.height) < 1) missing.push(`media[${index}].height`);
      });
    }

    const adReferences = new Set<string>();
    if (Array.isArray(pkg.ads)) {
      pkg.ads.forEach((ad, index) => {
        if (!this.nonEmptyString(ad?.ad_reference)) missing.push(`ads[${index}].ad_reference`);
        else if (adReferences.has(ad.ad_reference)) blockers.push(`duplicate ad_reference: ${ad.ad_reference}`);
        else adReferences.add(ad.ad_reference);
        if (!this.nonEmptyString(ad?.primary_text)) missing.push(`ads[${index}].primary_text`);
        if (!this.nonEmptyString(ad?.headline)) missing.push(`ads[${index}].headline`);
        if (!CTAS.has(String(ad?.cta))) blockers.push(`ads[${index}].cta is not supported`);
        if (pkg.conversion_destination === 'WHATSAPP') {
          if (ad?.cta !== 'WHATSAPP_MESSAGE') {
            blockers.push(`ads[${index}].cta must be WHATSAPP_MESSAGE for WHATSAPP destination`);
          }
          if (!this.nonEmptyString(ad?.initial_message)) missing.push(`ads[${index}].initial_message`);
        }
        if (!this.nonEmptyString(ad?.media_id)) missing.push(`ads[${index}].media_id`);
        else if (!mediaIds.has(ad.media_id)) {
          blockers.push(`ads[${index}].media_id does not reference an existing media item`);
        }
      });
    }

    if (!this.nonEmptyString(pkg.ad_account_id)) warnings.push('ad_account_id will need to be resolved before execution');
    this.addTargetWarnings(pkg, warnings);

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

  private validateDestination(
    pkg: Partial<CampaignPackageV1>,
    missing: string[],
    blockers: string[],
  ) {
    const destination = pkg.conversion_destination as ConversionDestination | undefined;
    switch (destination) {
      case 'WHATSAPP':
        if (!this.nonEmptyString(pkg.whatsapp_number)) missing.push('whatsapp_number');
        else if (!this.validPhone(pkg.whatsapp_number)) blockers.push('whatsapp_number must be a valid phone number');
        break;
      case 'INSTAGRAM':
        if (!this.nonEmptyString(pkg.instagram_url) && !this.nonEmptyString(pkg.instagram_account)) {
          missing.push('instagram_account_or_url');
        }
        if (this.nonEmptyString(pkg.instagram_url)
          && !this.validSocialUrl(pkg.instagram_url, ['instagram.com'])) {
          blockers.push('instagram_url must point to Instagram');
        }
        break;
      case 'FACEBOOK_PAGE':
      case 'MESSENGER':
      case 'INSTANT_FORM':
        if (!this.nonEmptyString(pkg.facebook_page_url) && !this.nonEmptyString(pkg.facebook_page)) {
          missing.push('facebook_page_or_url');
        }
        if (this.nonEmptyString(pkg.facebook_page_url)
          && !this.validSocialUrl(pkg.facebook_page_url, ['facebook.com', 'fb.com'])) {
          blockers.push('facebook_page_url must point to Facebook');
        }
        break;
      case 'WEBSITE':
        if (!this.nonEmptyString(pkg.website_url)) missing.push('website_url');
        else if (!this.validUrl(pkg.website_url)) blockers.push('website_url must be a valid http or https URL');
        break;
      case 'PHONE':
        if (!this.nonEmptyString(pkg.phone_number)) missing.push('phone_number');
        else if (!this.validPhone(pkg.phone_number)) blockers.push('phone_number must be a valid phone number');
        break;
      case 'APP':
        if (!this.nonEmptyString(pkg.app_url)) missing.push('app_url');
        else if (!this.validUrl(pkg.app_url)) blockers.push('app_url must be a valid http or https URL');
        break;
      default:
        break;
    }
  }

  private addTargetWarnings(pkg: Partial<CampaignPackageV1>, warnings: string[]) {
    switch (pkg.conversion_destination) {
      case 'WHATSAPP':
        if (!this.nonEmptyString(pkg.facebook_page_id)) warnings.push('facebook_page_id will need to be resolved before execution');
        if (!this.nonEmptyString(pkg.whatsapp_asset_id)) warnings.push('whatsapp_asset_id will need to be resolved before execution');
        break;
      case 'INSTAGRAM':
        if (!this.nonEmptyString(pkg.instagram_account_id)) warnings.push('instagram_account_id will need to be resolved before execution');
        break;
      case 'FACEBOOK_PAGE':
      case 'MESSENGER':
      case 'INSTANT_FORM':
        if (!this.nonEmptyString(pkg.facebook_page_id)) warnings.push('facebook_page_id will need to be resolved before execution');
        break;
      default:
        break;
    }
  }

  private validPhone(value: string) {
    return /^\+?\d{8,20}$/.test(value.replace(/[\s().-]/g, ''));
  }

  private validUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private validSocialUrl(value: string, hosts: string[]) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
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
    return JSON.stringify(value) ?? 'null';
  }

  private nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
