import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { CapabilityRecord } from '../../domain/contracts/capability';
import { MetaAssetBinding, MetaConnection } from '../../domain/contracts/meta-connection';
import {
  ReadinessCheck,
  ReadinessSnapshot,
  ReadOnlySmokeTestReport,
  ReadOnlySmokeTestStep,
} from '../../domain/contracts/readiness';
import { CredentialVaultPort } from '../../domain/ports/credential-vault.port';
import {
  ReadinessRepository,
  SmokeTestReportRepository,
} from '../../domain/ports/repositories';
import {
  READINESS_REPOSITORY,
  SMOKE_TEST_REPORT_REPOSITORY,
} from '../../infrastructure/database/database.tokens';
import { CREDENTIAL_VAULT } from '../../infrastructure/vault/credential-vault.tokens';
import { CapabilityRegistryService } from '../capability-registry/capability-registry.service';
import { MetaConnectionService } from '../meta-connection/meta-connection.service';

@Injectable()
export class ReadinessService {
  constructor(
    private readonly connections: MetaConnectionService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly config: ConfigService,
    @Inject(CREDENTIAL_VAULT)
    private readonly vault: CredentialVaultPort,
    @Inject(READINESS_REPOSITORY)
    private readonly snapshots: ReadinessRepository,
    @Inject(SMOKE_TEST_REPORT_REPOSITORY)
    private readonly smokeReports: SmokeTestReportRepository,
  ) {}

  async getConnectionReadiness(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadinessSnapshot> {
    const connection = await this.connections.getConnection(tenantId, connectionId);
    const [vaultAvailable, assets, capabilities] = await Promise.all([
      this.vault.isAvailable(),
      this.connections.listAssets(tenantId, connectionId),
      this.capabilities.list(tenantId, connectionId),
    ]);
    const configurationIssues = this.configurationIssues();
    const oauthPassed = this.oauthPassed(connection);
    const checks = [
      this.configurationCheck(configurationIssues),
      this.vaultCheck(vaultAvailable),
      this.oauthCheck(connection),
      this.assetCheck(oauthPassed, assets),
      this.capabilityCheck(oauthPassed, capabilities),
    ];

    return {
      snapshotId: randomUUID(),
      tenantId: connection.tenantId,
      connectionId: connection.connectionId,
      correlationId: randomUUID(),
      checks,
      blockers: checks
        .filter((check) => check.status !== 'passed')
        .map((check) => `${check.key}_${check.status}`),
      generatedAt: new Date().toISOString(),
    };
  }

  async captureConnectionReadiness(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadinessSnapshot> {
    const snapshot = await this.getConnectionReadiness(tenantId, connectionId);
    await this.snapshots.save(snapshot);
    return snapshot;
  }

  async latestConnectionReadiness(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadinessSnapshot | null> {
    await this.connections.getConnection(tenantId, connectionId);
    return this.snapshots.latestForConnection(tenantId, connectionId);
  }

  async latestReadOnlySmokeTest(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadOnlySmokeTestReport | null> {
    await this.connections.getConnection(tenantId, connectionId);
    return this.smokeReports.latestForConnection(tenantId, connectionId);
  }

  async runReadOnlySmokeTest(
    tenantId: string,
    connectionId: string,
  ): Promise<ReadOnlySmokeTestReport> {
    const connection = await this.connections.getConnection(tenantId, connectionId);
    const steps: ReadOnlySmokeTestStep[] = [];
    if (this.configurationIssues().length > 0) {
      return this.blockedSmokeReport(connection, steps, 'meta_configuration_blocked');
    }
    if (!await this.vault.isAvailable()) {
      return this.blockedSmokeReport(connection, steps, 'credential_vault_blocked');
    }
    if (!this.oauthPassed(connection) || !connection.credentialRef) {
      return this.blockedSmokeReport(connection, steps, 'meta_oauth_blocked');
    }

    const identity = await this.connections.validateReadOnly(tenantId, connection.credentialRef);
    if (!identity.success) {
      steps.push(this.blockedStep(
        'identity',
        'A identidade Meta não pôde ser validada.',
        identity.observedAt,
      ));
      return this.blockedSmokeReport(connection, steps, 'meta_identity_validation_failed');
    }
    steps.push({
      key: 'identity',
      status: 'passed',
      meaning: 'A credencial resolveu uma identidade Meta válida.',
      evidenceRefs: identity.data?.subjectId ? [`meta_user:${identity.data.subjectId}`] : [],
      observedAt: identity.observedAt,
    });

    const discovery = await this.connections.discoverAssets(tenantId, connectionId);
    if (!discovery.success || !discovery.data) {
      steps.push(this.blockedStep(
        'asset_discovery',
        'A descoberta de ativos Meta não foi concluída.',
        discovery.observedAt,
      ));
      return this.blockedSmokeReport(connection, steps, 'meta_asset_discovery_failed');
    }
    const adAccount = discovery.data.find((asset) => asset.assetType === 'ad_account');
    steps.push({
      key: 'asset_discovery',
      status: 'passed',
      meaning: 'O snapshot de ativos Meta foi atualizado com sucesso.',
      evidenceRefs: discovery.data.map((asset) =>
        `meta_asset:${asset.assetType}:${asset.externalId}`),
      observedAt: discovery.observedAt,
    });
    if (!adAccount) {
      return this.blockedSmokeReport(connection, steps, 'meta_ad_account_missing');
    }

    const capabilityResult = await this.capabilities.validateReadOnly(tenantId, connectionId);
    if (!capabilityResult.success || !capabilityResult.data) {
      steps.push(this.blockedStep(
        'capability_validation',
        'As capacidades Meta não puderam ser comprovadas.',
        capabilityResult.observedAt,
      ));
      return this.blockedSmokeReport(connection, steps, 'meta_capability_validation_failed');
    }
    const unavailable = capabilityResult.data.filter((record) => record.status !== 'available');
    if (unavailable.length > 0) {
      steps.push({
        key: 'capability_validation',
        status: 'blocked',
        meaning: 'Permissões ou ativos necessários ainda estão indisponíveis.',
        evidenceRefs: unavailable.map((record) => `capability:${record.capabilityId}`),
        observedAt: capabilityResult.observedAt,
      });
      return this.blockedSmokeReport(connection, steps, 'meta_read_capability_unavailable');
    }
    steps.push({
      key: 'capability_validation',
      status: 'passed',
      meaning: 'As capacidades de descoberta e leitura foram comprovadas.',
      evidenceRefs: capabilityResult.data.map((record) => `capability:${record.capabilityId}`),
      observedAt: capabilityResult.observedAt,
    });

    const accountRead = await this.connections.readDiscoveredAdAccount(
      tenantId,
      connectionId,
      adAccount.externalId,
    );
    if (!accountRead.success) {
      steps.push(this.blockedStep(
        'ad_account_read',
        'A conta descoberta não pôde ser lida.',
        accountRead.observedAt,
      ));
      return this.blockedSmokeReport(connection, steps, 'meta_ad_account_read_failed');
    }
    steps.push({
      key: 'ad_account_read',
      status: 'passed',
      meaning: 'Uma conta de anúncios descoberta foi lida sem operação externa de escrita.',
      evidenceRefs: [`meta_ad_account:${adAccount.externalId}`],
      observedAt: accountRead.observedAt,
    });

    const report: ReadOnlySmokeTestReport = {
      smokeTestId: randomUUID(),
      tenantId,
      connectionId,
      passed: true,
      steps,
      blockers: [],
      generatedAt: new Date().toISOString(),
    };
    await this.smokeReports.save(report);
    return report;
  }

  private configurationCheck(issues: string[]): ReadinessCheck {
    return issues.length === 0 ? {
      key: 'meta_configuration',
      status: 'passed',
      meaning: 'A configuração do app Meta está completa e bem formada.',
      evidenceRefs: ['system:meta_configuration'],
      source: 'system',
    } : {
      key: 'meta_configuration',
      status: 'blocked',
      meaning: `Configuração ausente ou inválida: ${issues.join(', ')}.`,
      nextAction: 'Configurar as variáveis indicadas no ambiente protegido da aplicação.',
      evidenceRefs: [],
      source: 'system',
    };
  }

  private vaultCheck(available: boolean): ReadinessCheck {
    return available ? {
      key: 'credential_vault',
      status: 'passed',
      meaning: 'O cofre criptografado de credenciais está disponível.',
      evidenceRefs: ['system:credential_vault'],
      source: 'system',
    } : {
      key: 'credential_vault',
      status: 'blocked',
      meaning: 'O cofre de credenciais não está disponível.',
      nextAction: 'Configurar a chave mestra e aplicar as migrações do cofre PostgreSQL.',
      evidenceRefs: [],
      source: 'system',
    };
  }

  private oauthCheck(connection: MetaConnection): ReadinessCheck {
    if (this.oauthPassed(connection)) {
      return {
        key: 'meta_oauth',
        status: 'passed',
        meaning: 'A conexão possui uma referência opaca de credencial Meta.',
        evidenceRefs: [`meta_connection:${connection.connectionId}`],
        source: 'system',
      };
    }
    const blocked = ['reauth_required', 'error'].includes(connection.status);
    return {
      key: 'meta_oauth',
      status: blocked ? 'blocked' : 'pending',
      meaning: blocked
        ? 'A conexão Meta exige nova autorização ou correção.'
        : 'A autorização OAuth da Meta ainda não foi concluída.',
      nextAction: 'Iniciar o OAuth e concluir a autorização na Meta.',
      evidenceRefs: [`meta_connection:${connection.connectionId}`],
      source: 'system',
    };
  }

  private assetCheck(oauthPassed: boolean, assets: MetaAssetBinding[]): ReadinessCheck {
    if (!oauthPassed) {
      return {
        key: 'asset_discovery',
        status: 'pending',
        meaning: 'A descoberta aguarda a conclusão do OAuth.',
        nextAction: 'Concluir primeiro a autorização OAuth da Meta.',
        evidenceRefs: [],
        source: 'system',
      };
    }
    if (assets.length === 0) {
      return {
        key: 'asset_discovery',
        status: 'pending',
        meaning: 'Nenhum ativo Meta foi descoberto para esta conexão.',
        nextAction: 'Executar a descoberta de ativos somente leitura.',
        evidenceRefs: [],
        source: 'system',
      };
    }
    return {
      key: 'asset_discovery',
      status: 'passed',
      meaning: `${assets.length} ativo(s) Meta estão vinculados à conexão.`,
      evidenceRefs: assets.map((asset) =>
        `meta_asset:${asset.assetType}:${asset.externalId}`),
      source: 'meta_api',
    };
  }

  private capabilityCheck(
    oauthPassed: boolean,
    capabilities: CapabilityRecord[],
  ): ReadinessCheck {
    if (!oauthPassed) {
      return {
        key: 'read_capabilities',
        status: 'pending',
        meaning: 'A validação de capacidades aguarda a conclusão do OAuth.',
        nextAction: 'Concluir primeiro a autorização OAuth da Meta.',
        evidenceRefs: [],
        source: 'system',
      };
    }
    if (capabilities.length === 0) {
      return {
        key: 'read_capabilities',
        status: 'pending',
        meaning: 'As capacidades Meta ainda não foram validadas.',
        nextAction: 'Executar a validação de capacidades somente leitura.',
        evidenceRefs: [],
        source: 'system',
      };
    }
    const discoveryAvailable = capabilities.some((record) =>
      record.capabilityType === 'DISCOVER_ASSETS' && record.status === 'available');
    const accountReadAvailable = capabilities.some((record) =>
      record.capabilityType === 'READ_AD_ACCOUNT' && record.status === 'available');
    const evidenceRefs = capabilities.map((record) => `capability:${record.capabilityId}`);
    if (discoveryAvailable && accountReadAvailable) {
      return {
        key: 'read_capabilities',
        status: 'passed',
        meaning: 'Descoberta e leitura de conta estão comprovadas por evidências atuais.',
        evidenceRefs,
        source: 'meta_api',
      };
    }
    return {
      key: 'read_capabilities',
      status: 'blocked',
      meaning: 'Uma ou mais capacidades de leitura estão indisponíveis.',
      nextAction: 'Revisar permissões concedidas e o acesso às contas de anúncio.',
      evidenceRefs,
      source: 'meta_api',
    };
  }

  private configurationIssues(): string[] {
    const issues: string[] = [];
    const appId = this.config.get<string>('META_APP_ID')?.trim() ?? '';
    const appSecret = this.config.get<string>('META_APP_SECRET')?.trim() ?? '';
    const apiVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ?? '';
    const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI')?.trim() ?? '';
    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim() ?? 'development';
    if (!/^\d+$/.test(appId)) issues.push('META_APP_ID');
    if (!appSecret) issues.push('META_APP_SECRET');
    if (!/^v\d+\.\d+$/.test(apiVersion)) issues.push('META_GRAPH_API_VERSION');

    try {
      const parsed = new URL(redirectUri);
      const localDevelopment = nodeEnv === 'development' && parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
      if (
        (parsed.protocol !== 'https:' && !localDevelopment) || parsed.username ||
        parsed.password || parsed.hash
      ) {
        issues.push('META_OAUTH_REDIRECT_URI');
      }
    } catch {
      issues.push('META_OAUTH_REDIRECT_URI');
    }
    return [...new Set(issues)];
  }

  private oauthPassed(connection: MetaConnection): boolean {
    return Boolean(connection.credentialRef) && ![
      'disconnected',
      'authorization_pending',
      'reauth_required',
      'error',
    ].includes(connection.status);
  }

  private blockedStep(
    key: ReadOnlySmokeTestStep['key'],
    meaning: string,
    observedAt?: string,
  ): ReadOnlySmokeTestStep {
    return {
      key,
      status: 'blocked',
      meaning,
      evidenceRefs: [],
      ...(observedAt ? { observedAt } : {}),
    };
  }

  private async blockedSmokeReport(
    connection: MetaConnection,
    steps: ReadOnlySmokeTestStep[],
    blocker: string,
  ): Promise<ReadOnlySmokeTestReport> {
    const report: ReadOnlySmokeTestReport = {
      smokeTestId: randomUUID(),
      tenantId: connection.tenantId,
      connectionId: connection.connectionId,
      passed: false,
      steps,
      blockers: [blocker],
      generatedAt: new Date().toISOString(),
    };
    await this.smokeReports.save(report);
    return report;
  }
}
