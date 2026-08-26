const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const CTAS = new Set(['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'SEND_WHATSAPP_MESSAGE'])
const MIMES = new Set(['image/jpeg', 'image/png', 'video/mp4'])
const CHECKLIST = ['claimsVerifiedAgainstSources', 'visualFidelityReviewed', 'safeAreaReviewed', 'requiredFieldsReviewed', 'automaticEnhancementsReviewed']

export function validCreativePackage(value, expected) {
  return value && UUID.test(value.creativePackageId)
    && value.tenantId === expected.tenantId && value.campaignId === expected.campaignId
    && UUID.test(value.sourceExecutionPlanId) && SHA.test(value.sourcePlanHash)
    && value.schemaVersion === '1.0'
    && Number.isSafeInteger(value.version) && value.version > 0
    && ['needs_review', 'approved', 'superseded'].includes(value.status)
    && SHA.test(value.contentHash) && Array.isArray(value.copies) && value.copies.length > 0
    && value.copies.every((copy) => typeof copy.primaryText === 'string'
      && typeof copy.copyId === 'string' && typeof copy.headline === 'string'
      && CTAS.has(copy.callToAction))
    && Array.isArray(value.claims) && value.claims.every((claim) => typeof claim.claimId === 'string'
      && typeof claim.text === 'string' && Array.isArray(claim.sourceRefs)
      && claim.sourceRefs.length > 0 && claim.sourceRefs.every((reference) => typeof reference === 'string'))
    && Array.isArray(value.assets) && value.assets.length > 0
    && value.assets.every((asset) => typeof asset.storageRef === 'string'
      && SHA.test(asset.sha256) && MIMES.has(asset.mimeType)
      && Number.isSafeInteger(asset.width) && asset.width > 0
      && Number.isSafeInteger(asset.height) && asset.height > 0)
    && value.reviewChecklist && CHECKLIST.every((key) => typeof value.reviewChecklist[key] === 'boolean')
    && Array.isArray(value.validationIssues) && !Number.isNaN(Date.parse(value.createdAt))
}

export async function loadLatestCreative({ plan, apiBaseUrl, operatorToken,
  fetchImpl = globalThis.fetch }) {
  if (!apiBaseUrl || !operatorToken) return { kind: 'configuration_required' }
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/v1/operator/tenants/${encodeURIComponent(plan.tenantId)}/campaigns/${encodeURIComponent(plan.campaignId)}/creative-packages/latest`, {
      headers: { accept: 'application/json', authorization: `Bearer ${operatorToken}` },
      cache: 'no-store', signal: globalThis.AbortSignal.timeout(5000),
    })
    if (response.status === 404) return { kind: 'none' }
    if (!response.ok) return { kind: response.status === 401 || response.status === 403 ? 'denied' : 'unavailable' }
    const creativePackage = await response.json()
    return validCreativePackage(creativePackage, plan)
      ? { kind: 'ready', creativePackage } : { kind: 'unavailable' }
  } catch { return { kind: 'unavailable' } }
}

export function parseCreativeForm(formData) {
  const text = (key) => String(formData.get(key) ?? '').trim()
  const tenantId = text('tenantId'), campaignId = text('campaignId')
  const executionPlanId = text('executionPlanId'), action = text('creativeAction')
  if (![tenantId, campaignId, executionPlanId].every((value) => UUID.test(value))) {
    return { ok: false, error: 'Escopo criativo inválido.' }
  }
  if (action === 'approve') {
    const version = Number(text('version')), contentHash = text('contentHash')
    return Number.isSafeInteger(version) && version > 0 && SHA.test(contentHash)
      ? { ok: true, action, tenantId, campaignId, executionPlanId, version, contentHash }
      : { ok: false, error: 'Versão ou hash criativo inválido.' }
  }
  if (action !== 'create') return { ok: false, error: 'Ação criativa inválida.' }
  const variants = [1, 2, 3].map((index) => {
    const suffix = index === 1 ? '' : `_${index}`
    return { index, primaryText: text(`primaryText${suffix}`),
      headline: text(`headline${suffix}`), description: text(`description${suffix}`),
      callToAction: text(`callToAction${suffix}`), storageRef: text(`storageRef${suffix}`),
      sha256: text(`sha256${suffix}`), mimeType: text(`mimeType${suffix}`),
      width: Number(text(`width${suffix}`)), height: Number(text(`height${suffix}`)) }
  })
  const present = variants.filter((variant) => [variant.primaryText, variant.headline,
    variant.description, variant.callToAction, variant.storageRef, variant.sha256,
    variant.mimeType].some(Boolean) || variant.width > 0 || variant.height > 0)
  const validVariant = (variant) => variant.primaryText && variant.headline
    && CTAS.has(variant.callToAction) && variant.storageRef.length >= 3
    && SHA.test(variant.sha256) && MIMES.has(variant.mimeType)
    && Number.isSafeInteger(variant.width) && variant.width > 0
    && Number.isSafeInteger(variant.height) && variant.height > 0
  if (present.length < 1 || present.some((variant) => !validVariant(variant))) {
    return { ok: false, error: 'Complete todos os campos de cada variação de anúncio utilizada.' }
  }
  const checklistKeys = ['claimsVerifiedAgainstSources', 'visualFidelityReviewed', 'safeAreaReviewed', 'requiredFieldsReviewed', 'automaticEnhancementsReviewed']
  const reviewChecklist = Object.fromEntries(checklistKeys.map((key) => [key, formData.get(key) === 'on']))
  const claimText = text('claimText'), claimSource = text('claimSource')
  if (Boolean(claimText) !== Boolean(claimSource)) return { ok: false, error: 'Toda alegação precisa de uma fonte.' }
  return { ok: true, action, tenantId, campaignId, executionPlanId,
    creative: { copies: present.map((variant) => ({ copyId: `copy_variant_${variant.index}`,
      primaryText: variant.primaryText, headline: variant.headline,
      ...(variant.description ? { description: variant.description } : {}),
      callToAction: variant.callToAction })),
      claims: claimText ? [{ claimId: 'claim_primary', text: claimText, sourceRefs: [claimSource] }] : [],
      assets: present.map((variant) => ({ assetId: `asset_variant_${variant.index}`,
        storageRef: variant.storageRef, sha256: variant.sha256,
        mimeType: variant.mimeType, width: variant.width, height: variant.height })),
      reviewChecklist } }
}
