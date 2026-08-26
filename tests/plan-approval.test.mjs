import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPlanApproval, parseApprovalAction, validApproval } from '../lib/plan-approval.mjs'

const plan = { tenantId: '11111111-1111-4111-8111-111111111111', campaignId: '22222222-2222-4222-8222-222222222222', executionPlanId: '33333333-3333-4333-8333-333333333333', planHash: 'a'.repeat(64), maximumPlannedSpendMinor: 8400, currency: 'BRL' }
const approval = { approvalId: '44444444-4444-4444-8444-444444444444', ...plan, approvedPlanHash: plan.planHash, status: 'pending', requestedBy: 'operator:warison', scope: [`plan_hash:${plan.planHash}`, 'maximum_spend_minor:8400', 'currency:BRL', 'external_write:false'], createdAt: '2026-08-24T16:00:00.000Z' }

test('accepts only approval evidence bound to the displayed hash and ceiling', () => {
  assert.equal(validApproval(approval, plan), true)
  assert.equal(validApproval({ ...approval, approvedPlanHash: 'b'.repeat(64) }, plan), false)
  assert.equal(validApproval({ ...approval, scope: approval.scope.filter((item) => item !== 'external_write:false') }, plan), false)
})

test('loads tenant-scoped approval with server-only authentication', async () => {
  let request
  const result = await loadPlanApproval({ approvalId: approval.approvalId, plan, apiBaseUrl: 'https://api.test/', operatorToken: 'secret', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => approval } } })
  assert.equal(result.kind, 'ready')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.match(request.url, new RegExp(`/tenants/${plan.tenantId}/approvals/${approval.approvalId}$`))
})

test('parses decisions and requires a reason for rejection or revocation', () => {
  const form = new FormData()
  for (const key of ['tenantId', 'campaignId', 'executionPlanId']) form.set(key, plan[key])
  form.set('approvalId', approval.approvalId); form.set('decision', 'reject')
  assert.equal(parseApprovalAction(form).ok, false)
  form.set('reason', 'Teto precisa ser revisado')
  assert.equal(parseApprovalAction(form).ok, true)
})
