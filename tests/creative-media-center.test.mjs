import assert from 'node:assert/strict'
import test from 'node:test'
import { loadLatestCreative, parseCreativeForm, validCreativePackage } from '../lib/creative-media-center.mjs'

const plan = { tenantId: '11111111-1111-4111-8111-111111111111', campaignId: '22222222-2222-4222-8222-222222222222', executionPlanId: '33333333-3333-4333-8333-333333333333' }
const creativePackage = { creativePackageId: '44444444-4444-4444-8444-444444444444', tenantId: plan.tenantId, campaignId: plan.campaignId, sourceExecutionPlanId: plan.executionPlanId, sourcePlanHash: 'a'.repeat(64), version: 1, schemaVersion: '1.0', status: 'needs_review', copies: [{ copyId: 'copy_primary', primaryText: 'Texto', headline: 'Título', callToAction: 'LEARN_MORE' }], claims: [], assets: [{ assetId: 'asset_primary', storageRef: 'media/file', sha256: 'b'.repeat(64), mimeType: 'image/png', width: 1080, height: 1080 }], reviewChecklist: { claimsVerifiedAgainstSources: true, visualFidelityReviewed: true, safeAreaReviewed: true, requiredFieldsReviewed: true, automaticEnhancementsReviewed: true }, validationIssues: [], contentHash: 'c'.repeat(64), createdAt: '2026-08-24T18:00:00.000Z' }

test('accepts only a latest creative bound to the selected tenant and campaign', () => {
  assert.equal(validCreativePackage(creativePackage, plan), true)
  assert.equal(validCreativePackage({ ...creativePackage, tenantId: '55555555-5555-4555-8555-555555555555' }, plan), false)
  assert.equal(validCreativePackage({ ...creativePackage, contentHash: 'invalid' }, plan), false)
})

test('loads latest creative with server authentication and treats 404 as empty', async () => {
  let request
  const ready = await loadLatestCreative({ plan, apiBaseUrl: 'https://api.test/', operatorToken: 'secret', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => creativePackage } } })
  assert.equal(ready.kind, 'ready')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.match(request.url, new RegExp(`/campaigns/${plan.campaignId}/creative-packages/latest$`))
  const empty = await loadLatestCreative({ plan, apiBaseUrl: 'https://api.test', operatorToken: 'secret', fetchImpl: async () => ({ ok: false, status: 404 }) })
  assert.equal(empty.kind, 'none')
})

test('parses a creative version and requires paired claim evidence', () => {
  const form = new FormData()
  for (const key of ['tenantId', 'campaignId', 'executionPlanId']) form.set(key, plan[key])
  Object.entries({ creativeAction: 'create', primaryText: 'Texto', headline: 'Título', callToAction: 'CONTACT_US', storageRef: 'media/file', sha256: 'd'.repeat(64), mimeType: 'image/jpeg', width: '1080', height: '1350', claimText: 'Entrega grátis' }).forEach(([key, value]) => form.set(key, value))
  assert.equal(parseCreativeForm(form).ok, false)
  form.set('claimSource', 'campaign_context:offer')
  form.set('safeAreaReviewed', 'on')
  const parsed = parseCreativeForm(form)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.creative.claims[0].sourceRefs[0], 'campaign_context:offer')
  assert.equal(parsed.creative.reviewChecklist.safeAreaReviewed, true)
})

test('requires exact version and SHA-256 to approve', () => {
  const form = new FormData()
  for (const key of ['tenantId', 'campaignId', 'executionPlanId']) form.set(key, plan[key])
  form.set('creativeAction', 'approve'); form.set('version', '2'); form.set('contentHash', 'e'.repeat(64))
  assert.deepEqual(parseCreativeForm(form), { ok: true, action: 'approve', ...plan, version: 2, contentHash: 'e'.repeat(64) })
  form.set('contentHash', 'short')
  assert.equal(parseCreativeForm(form).ok, false)
})

test('parses three complete ad variants and rejects a partial pair', () => {
  const form = new FormData()
  for (const key of ['tenantId', 'campaignId', 'executionPlanId']) form.set(key, plan[key])
  form.set('creativeAction', 'create')
  for (const index of [1, 2, 3]) {
    const suffix = index === 1 ? '' : `_${index}`
    Object.entries({ [`primaryText${suffix}`]: `Texto ${index}`,
      [`headline${suffix}`]: `Título ${index}`,
      [`callToAction${suffix}`]: 'SEND_WHATSAPP_MESSAGE',
      [`storageRef${suffix}`]: `media/file-${index}`,
      [`sha256${suffix}`]: `${index}`.repeat(64),
      [`mimeType${suffix}`]: 'image/jpeg', [`width${suffix}`]: '1080',
      [`height${suffix}`]: '1350' }).forEach(([key, value]) => form.set(key, value))
  }
  const parsed = parseCreativeForm(form)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.creative.copies.length, 3)
  assert.equal(parsed.creative.assets.length, 3)
  form.delete('sha256_3')
  assert.equal(parseCreativeForm(form).ok, false)
})
