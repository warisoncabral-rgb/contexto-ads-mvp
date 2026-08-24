function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function is32ByteBase64(value) {
  if (!isNonEmpty(value)) return false;
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

function validRedirect(value, production) {
  if (!isNonEmpty(value)) return false;
  try {
    const url = new URL(value);
    if (production) return url.protocol === 'https:';
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function assessRealMetaEnvironment(env) {
  const production = env.NODE_ENV === 'production';
  const checks = [
    ['database_url', isNonEmpty(env.DATABASE_URL)],
    ['postgres_vault_selected', env.CREDENTIAL_VAULT_PROVIDER === 'postgres'],
    ['vault_master_key_32_bytes', is32ByteBase64(env.CREDENTIAL_VAULT_MASTER_KEY)],
    ['meta_graph_base_url_https', (() => { try { return new URL(env.META_GRAPH_BASE_URL).protocol === 'https:'; } catch { return false; } })()],
    ['meta_graph_api_version', /^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION || '')],
    ['meta_app_id', /^\d+$/.test(env.META_APP_ID || '')],
    ['meta_app_secret_present', isNonEmpty(env.META_APP_SECRET)],
    ['meta_oauth_redirect_uri', validRedirect(env.META_OAUTH_REDIRECT_URI, production)],
    ['operator_subject', isNonEmpty(env.OPERATOR_BOOTSTRAP_SUBJECT)],
    ['operator_token_sha256', isSha256(env.OPERATOR_BOOTSTRAP_TOKEN_SHA256)],
  ].map(([name, passed]) => ({ name, passed }));

  const blockers = checks.filter((check) => !check.passed).map((check) => check.name);
  return {
    mode: production ? 'production' : 'non_production',
    readOnlyEnvironmentReady: blockers.length === 0,
    checks,
    blockers,
    boundaries: {
      secretsExposed: false,
      externalCallsPerformed: false,
      metaWriteAdapterImplemented: false,
      controlledWriteValidationReady: false,
    },
  };
}

module.exports = { assessRealMetaEnvironment };
