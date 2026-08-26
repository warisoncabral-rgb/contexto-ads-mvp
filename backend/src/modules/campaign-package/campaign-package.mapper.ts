import { ConflictException, Injectable } from '@nestjs/common';
import { CampaignContextInput } from '../../domain/contracts/campaign-context';
import { CreativePackageInputV1 } from '../../domain/contracts/creative-package';
import { CampaignPackageV1 } from '../../domain/contracts/campaign-package';
import { CampaignPackageService } from './campaign-package.service';

export interface PreparedCampaignPackageV1 {
  package_id: string;
  package_version: number;
  package_hash: string;
  generator_inputs: {
    campaign_context: CampaignContextInput;
    creative_package: CreativePackageInputV1;
    execution_target_hints: {
      meta_connection_id: string;
      ad_account_id?: string;
      facebook_page_id?: string;
      instagram_account_id?: string;
      whatsapp_asset_id?: string;
    };
  };
  boundaries: {
    persisted: false;
    execution_plan_created: false;
    meta_write_performed: false;
    spend_authorized: false;
    delivery_authorized: false;
  };
}

@Injectable()
export class CampaignPackageMapper {
  constructor(private readonly validator: CampaignPackageService) {}

  prepare(input: unknown): PreparedCampaignPackageV1 {
    const validation = this.validator.validate(input);
    if (validation.validation_status !== 'VALID' || !validation.package_hash) {
      throw new ConflictException({
        code: 'campaign_package_invalid',
        message: 'Campaign Package V1 cannot be prepared while validation has pendencies',
        validation,
      });
    }

    const pkg = input as CampaignPackageV1;
    const geography = pkg.locations.map((location) => {
      const region = [location.city, location.state, location.country].filter(Boolean).join(', ');
      return location.radius_km ? `${region} (${location.radius_km} km)` : region;
    }).join('; ');

    const campaignContext: CampaignContextInput = {
      businessName: pkg.business_name,
      offer: [pkg.offer_name, pkg.offer_description].filter(Boolean).join(' — '),
      objective: 'leads',
      audience: pkg.audience_description,
      destination: 'whatsapp',
      geography,
      budget: {
        mode: pkg.budget_type === 'DAILY' ? 'daily' : 'lifetime',
        amountMinor: Math.round(pkg.budget_amount * 100),
        currency: pkg.currency,
      },
      durationDays: pkg.duration_days,
    };

    const mediaById = new Map(pkg.media.map((media) => [media.media_id, media]));
    const copies = pkg.ads.map((ad) => ({
      copyId: ad.ad_reference,
      primaryText: ad.primary_text,
      headline: ad.headline ?? '',
      description: ad.description,
      whatsappMessage: ad.initial_message,
      callToAction: 'SEND_WHATSAPP_MESSAGE' as const,
    }));
    const assets = pkg.ads.map((ad) => {
      const media = mediaById.get(ad.media_id)!;
      return {
        assetId: media.media_id,
        storageRef: media.file_reference,
        sha256: this.normalizeChecksum(media.checksum),
        mimeType: 'image/jpeg' as const,
        width: 0,
        height: 0,
      };
    });
    const creativePackage: CreativePackageInputV1 = {
      copies,
      claims: [],
      assets,
      reviewChecklist: {
        claimsVerifiedAgainstSources: true,
        visualFidelityReviewed: false,
        safeAreaReviewed: false,
        requiredFieldsReviewed: true,
        automaticEnhancementsReviewed: false,
      },
    };

    return {
      package_id: pkg.package_id,
      package_version: pkg.package_version,
      package_hash: validation.package_hash,
      generator_inputs: {
        campaign_context: campaignContext,
        creative_package: creativePackage,
        execution_target_hints: {
          meta_connection_id: pkg.meta_connection_id,
          ad_account_id: pkg.ad_account_id,
          facebook_page_id: pkg.facebook_page_id,
          instagram_account_id: pkg.instagram_account_id,
          whatsapp_asset_id: pkg.whatsapp_asset_id,
        },
      },
      boundaries: {
        persisted: false,
        execution_plan_created: false,
        meta_write_performed: false,
        spend_authorized: false,
        delivery_authorized: false,
      },
    };
  }

  private normalizeChecksum(checksum?: string): string {
    if (!checksum) return '';
    return checksum.startsWith('sha256:') ? checksum.slice(7) : checksum;
  }
}
