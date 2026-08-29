const baseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  ?? 'https://contexto-ads-validation-api.onrender.com/v1';
const tenantId = process.env.CONTEXT_ADS_TENANT_ID;
const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN;
const packageJson = process.env.CAMPAIGN_PACKAGE_JSON;

if (!packageJson) {
  console.error('CAMPAIGN_PACKAGE_JSON is required');
  process.exit(2);
}

let campaignPackage;
try {
  campaignPackage = JSON.parse(packageJson);
} catch {
  console.error('CAMPAIGN_PACKAGE_JSON must be valid JSON');
  process.exit(2);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    console.error(JSON.stringify({ path, status: response.status, body }, null, 2));
    process.exit(1);
  }
  return body;
}

const validation = await request('/campaign-packages/v1/validate', {
  method: 'POST',
  body: JSON.stringify(campaignPackage),
});
console.log(JSON.stringify({ step: 'validate', result: validation }, null, 2));

if (validation.validation_status !== 'VALID') {
  console.error('Campaign Package is not valid; authenticated handoff was not attempted.');
  process.exit(1);
}

const prepared = await request('/campaign-packages/v1/prepare', {
  method: 'POST',
  body: JSON.stringify(campaignPackage),
});
console.log(JSON.stringify({
  step: 'prepare',
  package_id: prepared.package_id,
  package_version: prepared.package_version,
  package_hash: prepared.package_hash,
  boundaries: prepared.boundaries,
}, null, 2));

if (!tenantId || !operatorToken) {
  console.log(JSON.stringify({
    step: 'authenticated_handoff',
    status: 'SKIPPED',
    reason: 'Set CONTEXT_ADS_TENANT_ID and CONTEXT_ADS_OPERATOR_TOKEN to test internal persistence.',
    external_meta_write_attempted: false,
  }, null, 2));
  process.exit(0);
}

const authHeaders = { authorization: `Bearer ${operatorToken}` };
const handoff = await request(`/operator/tenants/${tenantId}/campaign-packages/v1/submit`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify(campaignPackage),
});
console.log(JSON.stringify({ step: 'submit', result: handoff }, null, 2));

if (handoff.boundaries?.meta_write_performed !== false
  || handoff.boundaries?.spend_authorized !== false
  || handoff.boundaries?.delivery_authorized !== false) {
  console.error('Safety boundary mismatch after handoff.');
  process.exit(1);
}

const status = await request(
  `/operator/tenants/${tenantId}/campaign-packages/v1/${campaignPackage.package_id}/status`,
  { headers: authHeaders },
);
console.log(JSON.stringify({ step: 'status', result: status }, null, 2));

if (status.boundaries?.publication_authorized !== false
  || status.boundaries?.external_writes_allowed !== false) {
  console.error('Safety boundary mismatch in package status.');
  process.exit(1);
}

console.log(JSON.stringify({
  smoke_status: 'PASSED',
  package_id: campaignPackage.package_id,
  external_meta_write_attempted: false,
}, null, 2));
