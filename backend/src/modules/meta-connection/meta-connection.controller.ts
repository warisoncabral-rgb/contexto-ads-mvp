import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MetaConnectionService } from './meta-connection.service';

@Controller('meta/connections')
export class MetaConnectionController {
  constructor(private readonly service: MetaConnectionService) {}

  @Post('start')
  start(@Body() body: { tenantId: string }) {
    return this.service.beginConnection(body.tenantId);
  }

  @Get(':connectionId')
  get(@Param('connectionId') connectionId: string, @Query('tenantId') tenantId: string) {
    return this.service.getConnection(tenantId, connectionId);
  }
}
