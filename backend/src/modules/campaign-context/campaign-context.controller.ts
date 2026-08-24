import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CampaignContextInput } from '../../domain/contracts/campaign-context';
import { CampaignContextService } from './campaign-context.service';

interface CampaignContextBody {
  tenantId: string;
  facts?: CampaignContextInput;
}

@Controller('campaign-contexts')
export class CampaignContextController {
  constructor(private readonly service: CampaignContextService) {}

  @Post()
  create(@Body() body: CampaignContextBody) {
    return this.service.create(body?.tenantId, body?.facts);
  }

  @Post(':campaignId/versions')
  appendVersion(
    @Param('campaignId') campaignId: string,
    @Body() body: CampaignContextBody,
  ) {
    return this.service.appendVersion(body?.tenantId, campaignId, body?.facts);
  }

  @Get(':campaignId/latest')
  latest(
    @Param('campaignId') campaignId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, campaignId);
  }
}
