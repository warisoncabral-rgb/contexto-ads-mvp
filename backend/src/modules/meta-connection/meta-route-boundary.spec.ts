import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CapabilityRegistryController } from '../capability-registry/capability-registry.controller';
import { MetaOAuthCallbackController } from '../meta-oauth/meta-oauth-callback.controller';
import { MetaOAuthController } from '../meta-oauth/meta-oauth.controller';
import { ReadinessController } from '../readiness/readiness.controller';
import { MetaConnectionController } from './meta-connection.controller';
import { MetaTenantOwnerGuard } from './meta-tenant-owner.guard';

function guards(controller: object): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
}

describe('real Meta HTTP security boundary', () => {
  it.each([
    MetaConnectionController,
    MetaOAuthController,
    CapabilityRegistryController,
    ReadinessController,
  ])('protects %p with the tenant owner guard', (controller) => {
    expect(guards(controller)).toContain(MetaTenantOwnerGuard);
  });

  it('keeps only the OAuth callback outside the bearer guard', () => {
    expect(guards(MetaOAuthCallbackController)).not.toContain(MetaTenantOwnerGuard);
  });
});
