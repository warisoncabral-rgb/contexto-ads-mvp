import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { KillSwitchStatus } from '../../domain/contracts/kill-switch';
import { KillSwitchService } from './kill-switch.service';

@Controller()
export class KillSwitchController {
  constructor(private readonly service: KillSwitchService) {}

  @Post('tenants/:tenantId/kill-switch')
  changeTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: { status: KillSwitchStatus; changedBy: string; reason: string },
  ) {
    return this.service.changeTenant(
      tenantId, body?.status, body?.changedBy, body?.reason,
    );
  }

  @Post('campaigns/:campaignId/kill-switch')
  changeCampaign(
    @Param('campaignId') campaignId: string,
    @Body() body: {
      tenantId: string; status: KillSwitchStatus; changedBy: string; reason: string;
    },
  ) {
    return this.service.changeCampaign(
      body?.tenantId, campaignId, body?.status, body?.changedBy, body?.reason,
    );
  }

  @Get('campaigns/:campaignId/kill-switch/effective')
  effective(
    @Param('campaignId') campaignId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.effective(tenantId, campaignId);
  }
}
