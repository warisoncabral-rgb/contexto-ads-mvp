import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ReadinessSnapshot } from '../../domain/contracts/readiness';

@Injectable()
export class ReadinessService {
  buildUnconfiguredSnapshot(tenantId: string, connectionId: string): ReadinessSnapshot {
    return {
      snapshotId: randomUUID(),
      tenantId,
      connectionId,
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
