import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApprovalService } from './approval.service';

@Controller()
export class ApprovalController {
  constructor(private readonly service: ApprovalService) {}

  @Post('campaigns/:campaignId/plans/:executionPlanId/approvals')
  request(
    @Param('campaignId') campaignId: string,
    @Param('executionPlanId') executionPlanId: string,
    @Body() body: { tenantId: string; requestedBy: string },
  ) {
    return this.service.request(
      body?.tenantId,
      campaignId,
      executionPlanId,
      body?.requestedBy,
    );
  }

  @Get('approvals/:approvalId')
  get(
    @Param('approvalId') approvalId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.get(tenantId, approvalId);
  }

  @Post('approvals/:approvalId/approve')
  approve(
    @Param('approvalId') approvalId: string,
    @Body() body: { tenantId: string; approvedBy: string },
  ) {
    return this.service.approve(body?.tenantId, approvalId, body?.approvedBy);
  }

  @Post('approvals/:approvalId/reject')
  reject(
    @Param('approvalId') approvalId: string,
    @Body() body: { tenantId: string; rejectedBy: string; reason: string },
  ) {
    return this.service.reject(
      body?.tenantId,
      approvalId,
      body?.rejectedBy,
      body?.reason,
    );
  }

  @Post('approvals/:approvalId/revoke')
  revoke(
    @Param('approvalId') approvalId: string,
    @Body() body: { tenantId: string; revokedBy: string; reason: string },
  ) {
    return this.service.revoke(
      body?.tenantId,
      approvalId,
      body?.revokedBy,
      body?.reason,
    );
  }
}
