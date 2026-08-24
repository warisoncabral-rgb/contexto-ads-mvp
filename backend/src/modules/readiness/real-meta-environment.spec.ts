const { assessRealMetaEnvironment } = require('../../../scripts/real-meta-environment.cjs');

describe('real Meta environment preflight', () => {
  const valid = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:password@db.example/contexto',
    CREDENTIAL_VAULT_PROVIDER: 'postgres',
    CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    META_GRAPH_BASE_URL: 'https://graph.facebook.com',
    META_GRAPH_API_VERSION: 'v26.0',
    META_APP_ID: '123456789',
    META_APP_SECRET: 'synthetic-secret-for-test-only',
    META_OAUTH_REDIRECT_URI: 'https://ads.example.com/v1/meta/oauth/callback',
    OPERATOR_BOOTSTRAP_SUBJECT: 'operator:test',
    OPERATOR_BOOTSTRAP_TOKEN_SHA256: 'a'.repeat(64),
  };

  it('approves the read-only environment without claiming write readiness', () => {
    const result = assessRealMetaEnvironment(valid);
    expect(result.readOnlyEnvironmentReady).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.boundaries.externalCallsPerformed).toBe(false);
    expect(result.boundaries.secretsExposed).toBe(false);
    expect(result.boundaries.metaWriteAdapterImplemented).toBe(false);
    expect(result.boundaries.controlledWriteValidationReady).toBe(false);
  });

  it('fails closed when required configuration is absent', () => {
    const result = assessRealMetaEnvironment({ ...valid, META_APP_SECRET: '', OPERATOR_BOOTSTRAP_TOKEN_SHA256: 'bad' });
    expect(result.readOnlyEnvironmentReady).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['meta_app_secret_present', 'operator_token_sha256']));
  });

  it('requires HTTPS redirect in production', () => {
    const result = assessRealMetaEnvironment({ ...valid, META_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/meta/oauth/callback' });
    expect(result.readOnlyEnvironmentReady).toBe(false);
    expect(result.blockers).toContain('meta_oauth_redirect_uri');
  });
});
