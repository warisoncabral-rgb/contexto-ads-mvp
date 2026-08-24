import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MetaWriteValidationService } from './meta-write-validation.service';

@Controller('execution-manifests/:executionManifestId/meta-write-validation-protocols')
export class MetaWriteValidationController {
  constructor(private readonly service: MetaWriteValidationService) {}

  @Post()
  prepare(
    @Param('executionManifestId') executionManifestId: string,
    @Body() body: { tenantId: string; preparedBy: string },
  ) {
    return this.service.prepare(
      body?.tenantId,
      executionManifestId,
      body?.preparedBy,
    );
  }

  @Get('latest')
  latest(
    @Param('executionManifestId') executionManifestId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.service.latest(tenantId, executionManifestId);
  }
}
