import { Inject, Injectable } from '@nestjs/common';
import { CapabilityRepository } from '../../domain/ports/repositories';
import { CAPABILITY_REPOSITORY } from '../../infrastructure/database/database.tokens';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

@Injectable()
export class CapabilityRegistryService {
  constructor(
    private readonly connections: MetaConnectionService,
    @Inject(CAPABILITY_REPOSITORY)
    private readonly capabilities: CapabilityRepository,
  ) {}

  async list(tenantId: string, connectionId: string) {
    await this.connections.getConnection(tenantId, connectionId);
    return this.capabilities.listForConnection(tenantId, connectionId);
  }
}
