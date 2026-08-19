import { Body, Controller, Param, Post } from '@nestjs/common';
import { MetaOAuthService } from './meta-oauth.service';

@Controller('meta/connections')
export class MetaOAuthController {
  constructor(private readonly service: MetaOAuthService) {}

  @Post(':connectionId/oauth/start')
  start(
    @Param('connectionId') connectionId: string,
    @Body() body: { tenantId: string },
  ) {
    return this.service.start(body.tenantId, connectionId);
  }
}
