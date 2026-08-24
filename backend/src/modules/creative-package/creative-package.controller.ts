import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreativePackageInputV1 } from '../../domain/contracts/creative-package';
import { CreativePackageService } from './creative-package.service';

@Controller('creative-packages')
export class CreativePackageController {
  constructor(private readonly service: CreativePackageService) {}

  @Post(':campaignId/versions')
  appendVersion(
    @Param('campaignId') campaignId: string,
    @Body() body: {
      tenantId: string;
      executionPlanId: string;
      createdBy: string;
      creative: CreativePackageInputV1;
    },
  ) {
    return this.service.appendVersion(
      body?.tenantId,
      campaignId,
      body?.executionPlanId,
      body?.creative,
      body?.createdBy,
    );
  }

  @Post(':campaignId/versions/:version/approve')
  approve(
    @Param('campaignId') campaignId: string,
    @Param('version') version: string,
    @Body() body: { tenantId: string; contentHash: string; approvedBy: string },
  ) {
    return this.service.approve(
      body?.tenantId,
      campaignId,
      Number(version),
      body?.contentHash,
      body?.approvedBy,
    );
  }

  @Get(':campaignId/latest')
  latest(
    @Param('campaignId') campaignId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, campaignId);
  }
}
