import { Body, Controller, Headers, HttpCode, HttpException, Post } from '@nestjs/common';
import { CampaignPackageStatusService } from '../campaign-package/campaign-package-status.service';
import { OperatorAccessService } from './operator-access.service';

type DiagnosticBody = {
  package_id?: unknown;
};

@Controller('operator')
export class IntegrationDiagnosticController {
  constructor(
    private readonly access: OperatorAccessService,
    private readonly packages: CampaignPackageStatusService,
  ) {}

  @Post('integration/v1/action-diagnose')
  @HttpCode(200)
  async diagnose(
    @Body() body: DiagnosticBody | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const base = {
      action_status: 'DIAGNOSTIC_COMPLETE' as const,
      transport: {
        status: 'OK' as const,
        method: 'POST' as const,
        route: '/v1/operator/integration/v1/action-diagnose',
      },
      auth_contract: {
        scheme: 'Bearer' as const,
        user_should_not_supply_tenant_id: true,
      },
      boundaries: this.safeBoundaries(),
    };

    let workspace: Awaited<ReturnType<OperatorAccessService['listTenants']>>;
    try {
      workspace = await this.access.listTenants(authorization);
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const normalized = typeof response === 'string'
          ? { message: response }
          : response as Record<string, unknown>;
        const code = typeof normalized.code === 'string' ? normalized.code : 'operator_authentication_failed';
        return {
          ...base,
          overall_status: code === 'invalid_operator_credentials'
            ? 'AUTH_TOKEN_MISMATCH'
            : 'AUTHENTICATION_BLOCKED',
          authentication: {
            status: 'FAILED',
            http_status: error.getStatus(),
            code,
            message: typeof normalized.message === 'string'
              ? normalized.message
              : 'Operator authentication failed',
            server_credential_status: code === 'invalid_operator_credentials'
              ? 'CONFIGURED_BUT_REQUEST_TOKEN_MISMATCH'
              : 'CHECK_SERVER_CONFIGURATION',
          },
          tenant_resolution: {
            status: 'NOT_RUN',
          },
          package: {
            status: 'NOT_RUN',
          },
          next_action: 'SYNC_GPT_BEARER_TOKEN_WITH_RENDER',
        };
      }
      return {
        ...base,
        overall_status: 'AUTHENTICATION_BLOCKED',
        authentication: {
          status: 'FAILED',
          code: 'unexpected_authentication_error',
          message: error instanceof Error ? error.message : 'Unexpected authentication error',
        },
        tenant_resolution: { status: 'NOT_RUN' },
        package: { status: 'NOT_RUN' },
        next_action: 'REVIEW_SERVER_AUTHENTICATION',
      };
    }

    const tenants = workspace.tenants;
    if (tenants.length !== 1) {
      return {
        ...base,
        overall_status: 'TENANT_RESOLUTION_BLOCKED',
        authentication: {
          status: 'OK',
          provider: workspace.operator.provider,
        },
        tenant_resolution: {
          status: 'BLOCKED',
          authorized_tenant_count: tenants.length,
          reason: tenants.length === 0
            ? 'NO_AUTHORIZED_TENANT'
            : 'MULTIPLE_AUTHORIZED_TENANTS',
        },
        package: { status: 'NOT_RUN' },
        next_action: 'FIX_OPERATOR_TENANT_MEMBERSHIP',
      };
    }

    const tenant = tenants[0];
    const packageId = body?.package_id;
    if (packageId === undefined || packageId === null || packageId === '') {
      return {
        ...base,
        overall_status: 'READY_FOR_CAMPAIGN_FLOW',
        authentication: {
          status: 'OK',
          provider: workspace.operator.provider,
        },
        tenant_resolution: {
          status: 'OK',
          authorized_tenant_count: 1,
          role: tenant.role,
          required_permissions_present: tenant.permissions.includes('manage_campaign_preparation'),
        },
        package: {
          status: 'NOT_REQUESTED',
        },
        next_action: 'RUN_CAMPAIGN_FLOW_OR_DIAGNOSE_WITH_PACKAGE_ID',
      };
    }

    try {
      const status = await this.packages.get(tenant.tenantId, packageId);
      const creativeStatus = status.creative?.status ?? null;
      const targetStatus = status.execution_plan.target_binding_status;
      return {
        ...base,
        overall_status: creativeStatus === 'approved' && targetStatus === 'BOUND'
          ? 'PACKAGE_TECHNICALLY_READY_FOR_FINAL_GATES'
          : creativeStatus
            ? 'PACKAGE_CREATIVE_REVIEW_REQUIRED'
            : 'PACKAGE_CREATIVE_PREPARATION_REQUIRED',
        authentication: {
          status: 'OK',
          provider: workspace.operator.provider,
        },
        tenant_resolution: {
          status: 'OK',
          authorized_tenant_count: 1,
          role: tenant.role,
          required_permissions_present: tenant.permissions.includes('manage_campaign_preparation'),
        },
        package: {
          status: 'FOUND',
          package_id: status.package_id,
          campaign_id: status.campaign_id,
          context_status: status.context.status,
          creative_status: creativeStatus,
          execution_plan_id: status.execution_plan.execution_plan_id,
          execution_plan_status: status.execution_plan.status,
          target_binding_status: targetStatus,
          plan_approval_status: status.plan_approval?.status ?? null,
          next_action: status.next_action,
        },
        next_action: creativeStatus
          ? status.next_action
          : 'PREPARE_CREATIVE_PACKAGE',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        return {
          ...base,
          overall_status: 'PACKAGE_DIAGNOSTIC_BLOCKED',
          authentication: {
            status: 'OK',
            provider: workspace.operator.provider,
          },
          tenant_resolution: {
            status: 'OK',
            authorized_tenant_count: 1,
            role: tenant.role,
            required_permissions_present: tenant.permissions.includes('manage_campaign_preparation'),
          },
          package: {
            status: 'ERROR',
            http_status: error.getStatus(),
            error: response,
          },
          next_action: error.getStatus() === 404
            ? 'SUBMIT_OR_RECOVER_CAMPAIGN_PACKAGE'
            : 'FIX_PACKAGE_STATE',
        };
      }
      return {
        ...base,
        overall_status: 'PACKAGE_DIAGNOSTIC_BLOCKED',
        authentication: { status: 'OK', provider: workspace.operator.provider },
        tenant_resolution: {
          status: 'OK',
          authorized_tenant_count: 1,
          role: tenant.role,
          required_permissions_present: tenant.permissions.includes('manage_campaign_preparation'),
        },
        package: {
          status: 'ERROR',
          error: {
            code: 'unexpected_package_diagnostic_error',
            message: error instanceof Error ? error.message : 'Unexpected package diagnostic error',
          },
        },
        next_action: 'FIX_PACKAGE_STATE',
      };
    }
  }

  private safeBoundaries() {
    return {
      publication_authorized: false,
      external_writes_allowed: false,
      external_writes_performed: false,
      meta_write_performed: false,
      delivery_authorized: false,
      spend_authorized: false,
    };
  }
}
