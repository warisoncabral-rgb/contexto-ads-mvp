import { Controller, Get, Query } from '@nestjs/common';
import { MetaOAuthService } from './meta-oauth.service';

@Controller('meta/oauth')
export class MetaOAuthCallbackController {
  constructor(private readonly service: MetaOAuthService) {}

  @Get('callback')
  callback(
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ) {
    return this.service.callback({ state, code, error });
  }
}
