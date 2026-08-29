import { Controller, Get } from '@nestjs/common';

@Controller('operator')
export class OperatorActionTransportController {
  @Get('transport-ping')
  transportPing() {
    return {
      action_status: 'OK',
      service: 'contexto-ads-generator',
      transport: 'reachable',
      schema_version: '1.0.10-diagnostic',
      authenticated: false,
      boundaries: {
        publication_authorized: false,
        external_writes_allowed: false,
        external_writes_performed: false,
        meta_write_performed: false,
      },
    };
  }
}
