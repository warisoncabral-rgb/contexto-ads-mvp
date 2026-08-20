import { MetaConnection, MetaAssetBinding } from '../contracts/meta-connection';
import { CapabilityRecord } from '../contracts/capability';
import { AuditEvent } from '../contracts/audit-event';
import { ReadinessSnapshot } from '../contracts/readiness';
import { MetaOAuthAttempt } from '../contracts/meta-oauth-attempt';

export interface MetaConnectionRepository {
  save(connection: MetaConnection): Promise<void>;
  findById(tenantId: string, connectionId: string): Promise<MetaConnection | null>;
  saveBindings(bindings: MetaAssetBinding[]): Promise<void>;
  listBindings(tenantId: string, connectionId: string): Promise<MetaAssetBinding[]>;
}
export interface CapabilityRepository {
  replaceForConnection(tenantId: string, connectionId: string, capabilities: CapabilityRecord[]): Promise<void>;
  listForConnection(tenantId: string, connectionId: string): Promise<CapabilityRecord[]>;
}
export interface AuditRepository { append(event: AuditEvent): Promise<void>; }
export interface ReadinessRepository { save(snapshot: ReadinessSnapshot): Promise<void>; }

export interface MetaOAuthAttemptStore {
  replaceActive(attempt: MetaOAuthAttempt): Promise<void>;
  consumeActive(stateHash: string): Promise<MetaOAuthAttempt | null>;
  recordCredentialRevocationPending(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    createdAt: string,
  ): Promise<void>;
}

export interface MetaConnectionStore
  extends Pick<MetaConnectionRepository, 'save' | 'findById'> {
  markConnected(
    tenantId: string,
    connectionId: string,
    credentialRef: string,
    updatedAt: string,
  ): Promise<boolean>;
}
