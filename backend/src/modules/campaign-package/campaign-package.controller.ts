import { Body, Controller, Post } from '@nestjs/common';
import { CampaignPackageService } from './campaign-package.service';

@Controller('campaign-packages')
export class CampaignPackageController {
  constructor(private readonly service: CampaignPackageService) {}

  @Post('v1/validate')
  validate(@Body() body: unknown) {
    return this.service.validate(body);
  }

  @Post('v1/submit')
  submit(@Body() body: unknown) {
    return this.service.validate(body);
  }
}
