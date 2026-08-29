const baseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  ?? 'http://127.0.0.1:3000/v1';
const tenantId = process.env.CONTEXT_ADS_TENANT_ID;
const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN;
const packageJson = process.env.CAMPAIGN_PACKAGE_JSON;

if (!tenantId || !operatorToken || !packageJson) {
  console.error('CONTEXT_ADS_TENANT_ID, CONTEXT_ADS_OPERATOR_TOKEN and CAMPAIGN_PACKAGE_JSON are required');
  process.exit(2);
}

const campaignPackage = JSON.parse(packageJson);
const authHeaders = {
  authorization: `Bearer ${operatorToken}`,
  'content-type': 'application/json',
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...authHeaders, ...(options.headers ?? {}) },
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

const handoff = await request(`/operator/tenants/${tenantId}/campaign-packages/v1/submit`, {
  method: 'POST',
  body: JSON.stringify(campaignPackage),
});

const mediaById = new Map(campaignPackage.media.map((media) => [media.media_id, media]));
const reviewedCreative = {
  copies: campaignPackage.ads.map((ad) => ({
    copyId: ad.ad_reference,
    primaryText: ad.primary_text,
    headline: ad.headline,
    ...(ad.description ? { description: ad.description } : {}),
    whatsappMessage: ad.initial_message,
    callToAction: 'SEND_WHATSAPP_MESSAGE',
  })),
  claims: [],
  assets: campaignPackage.ads.map((ad) => {
    const media = mediaById.get(ad.media_id);
    return {
      assetId: media.media_id,
      storageRef: media.file_reference,
      sha256: media.checksum.replace(/^sha256:/, '').toLowerCase(),
      mimeType: media.mime_type,
      width: media.width,
      height: media.height,
    };
  }),
  reviewChecklist: {
    claimsVerifiedAgainstSources: true,
    visualFidelityReviewed: true,
    safeAreaReviewed: true,
    requiredFieldsReviewed: true,
    automaticEnhancementsReviewed: true,
  },
};

const reviewed = await request(
  `/operator/tenants/${tenantId}/campaigns/${handoff.campaign_id}/plans/${handoff.execution_plan_id}/creative-packages`,
  { method: 'POST', body: JSON.stringify({ creative: reviewedCreative }) },
);

if (reviewed.boundaries?.publicationAuthorized !== false
  || reviewed.boundaries?.externalWritesAllowed !== false
  || reviewed.boundaries?.externalWritesPerformed !== false) {
  console.error('Reviewed creative changed external-write boundaries.');
  process.exit(1);
}

const creative = reviewed.creativePackage;
const approvedCreative = await request(
  `/operator/tenants/${tenantId}/campaigns/${handoff.campaign_id}/creative-packages/${creative.version}/approve`,
  { method: 'POST', body: JSON.stringify({ contentHash: creative.contentHash }) },
);

if (approvedCreative.creativePackage?.status !== 'approved') {
  console.error('Creative package was not approved.');
  process.exit(1);
}
if (approvedCreative.boundaries?.publicationAuthorized !== false
  || approvedCreative.boundaries?.externalWritesAllowed !== false
  || approvedCreative.boundaries?.externalWritesPerformed !== false) {
  console.error('Creative approval changed external-write boundaries.');
  process.exit(1);
}

const currentPlan = approvedCreative.executionPlan;
const approvalRequest = await request(
  `/operator/tenants/${tenantId}/campaigns/${handoff.campaign_id}/plans/${currentPlan.executionPlanId}/approvals`,
  { method: 'POST', body: '{}' },
);

if (approvalRequest.approval?.status !== 'pending') {
  console.error('Plan approval was not opened as pending.');
  process.exit(1);
}
if (approvalRequest.boundaries?.approvalIsExecutionAuthorization !== false
  || approvalRequest.boundaries?.externalWritesAllowed !== false
  || approvalRequest.boundaries?.externalWritesPerformed !== false) {
  console.error('Plan approval request crossed execution boundaries.');
  process.exit(1);
}

const approvalId = approvalRequest.approval.approvalId;
const approvalDecision = await request(
  `/operator/tenants/${tenantId}/approvals/${approvalId}/approve`,
  { method: 'POST', body: '{}' },
);

if (approvalDecision.approval?.status !== 'approved') {
  console.error('Plan approval was not recorded as approved.');
  process.exit(1);
}
if (approvalDecision.boundaries?.approvalIsExecutionAuthorization !== false
  || approvalDecision.boundaries?.externalWritesAllowed !== false
  || approvalDecision.boundaries?.externalWritesPerformed !== false) {
  console.error('Plan approval decision crossed execution boundaries.');
  process.exit(1);
}

const finalStatus = await request(
  `/operator/tenants/${tenantId}/campaign-packages/v1/${campaignPackage.package_id}/status`,
);
const acceptedNextActions = new Set(['EXECUTION_GATE_SEPARATE', 'RESOLVE_META_TARGET']);
if (finalStatus.plan_approval?.status !== 'approved'
  || !acceptedNextActions.has(finalStatus.next_action)
  || finalStatus.boundaries?.plan_approval_is_execution_authorization !== false
  || finalStatus.boundaries?.external_writes_allowed !== false
  || finalStatus.boundaries?.external_writes_performed !== false) {
  console.error('Package status after plan approval is inconsistent with safe execution boundaries.');
  process.exit(1);
}

if (finalStatus.next_action === 'EXECUTION_GATE_SEPARATE'
  && finalStatus.execution_plan?.target_binding_status !== 'BOUND') {
  console.error('Execution gate was reached without a bound Meta target.');
  process.exit(1);
}
if (finalStatus.next_action === 'RESOLVE_META_TARGET'
  && finalStatus.execution_plan?.target_binding_status !== 'PENDING_RESOLUTION') {
  console.error('Meta target resolution was requested even though target binding is not pending.');
  process.exit(1);
}

console.log(JSON.stringify({
  approval_smoke_status: 'PASSED',
  campaign_id: handoff.campaign_id,
  creative_package_version: approvedCreative.creativePackage.version,
  creative_status: approvedCreative.creativePackage.status,
  execution_plan_id: currentPlan.executionPlanId,
  approval_id: approvalId,
  approval_status: approvalDecision.approval.status,
  package_next_action: finalStatus.next_action,
  target_binding_status: finalStatus.execution_plan?.target_binding_status,
  approval_is_execution_authorization: false,
  external_meta_write_attempted: false,
}, null, 2));
