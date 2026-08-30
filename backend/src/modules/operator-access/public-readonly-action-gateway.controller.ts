import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';

const CANONICAL_PACKAGE_ID = '849547ce-645e-4c7b-a844-451182253fe6';

@Controller('public-action-gateway')
export class PublicReadonlyActionGatewayController {
  constructor(private readonly status: CampaignPackageStatusService) {}

  @Get('canonical-package-status')
  @HttpCode(200)
  async recoverCanonical(): Promise<any> {
    return this.recover(CANONICAL_PACKAGE_ID);
  }

  @Get('campaign-packages/v1/:packageId/status')
  @HttpCode(200)
  async recover(@Param('packageId') packageId: string): Promise<any> {
    const boundaries = {
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
      meta_write_performed: false,
    };

    if (!this.isUuid(packageId)) {
      return {
        action_status: 'REJECTED',
        http_status: 400,
        error: {
          code: 'invalid_package_id',
          message: 'package_id must be a valid UUID',
        },
        boundaries,
      };
    }

    const tenantId = process.env.BOOTSTRAP_TENANT_ID?.trim();
    if (!tenantId || !this.isUuid(tenantId)) {
      throw new ServiceUnavailableException({
        code: 'public_recovery_tenant_not_configured',
        message: 'Read-only recovery gateway is unavailable',
      });
    }

    try {
      const result = await this.status.get(tenantId, packageId);
      return {
        action_status: 'FOUND',
        ...result,
        boundaries: {
          ...result.boundaries,
          ...boundaries,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          action_status: 'NOT_FOUND',
          http_status: 404,
          error: {
            code: 'campaign_package_not_found',
            message: 'Campaign Package was not found',
            packageId,
          },
          boundaries,
        };
      }
      throw error;
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
