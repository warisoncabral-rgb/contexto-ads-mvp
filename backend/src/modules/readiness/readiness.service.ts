import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ReadinessSnapshot } from '../../domain/contracts/readiness';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

@Injectable()
export class ReadinessService {
  constructor(private readonly connections: MetaConnectionService) {}

  async getConnectionReadiness(tenantId: string, connectionId: string): Promise<ReadinessSnapshot> {
    const connection = await this.connections.getConnection(tenantId, connectionId);

    return {
      snapshotId: randomUUID(),
      tenantId: connection.tenantId,
      connectionId: connection.connectionId,
      correlationId: randomUUID(),
      checks: [
        {
          key: 'meta_oauth',
          status: 'pending',
          meaning: 'A conexão Meta ainda não possui OAuth real configurado.',
          nextAction: 'Criar/configurar o app Meta e concluir o onboarding OAuth.',
          evidenceRefs: [],
          source: 'system',
        },
      ],
      blockers: ['meta_oauth_not_configured'],
      generatedAt: new Date().toISOString(),
    };
  }
}
