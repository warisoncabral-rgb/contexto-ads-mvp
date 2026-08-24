import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperatorCampaignPulse } from '../lib/operator-campaign-pulse.mjs'

const item = (tenantId, campaignId, priority, owner, suffix) => ({ tenantId, tenantDisplayName: tenantId,
  campaignId, executionPlanId: `plan-${suffix}`, workItemId: `work-${suffix}`, priority, owner })

test('groups current work by tenant and campaign without inventing performance', () => {
  const queue = { items: [
    item('tenant-a', 'campaign-a', 'critical', 'operator', '1'),
    item('tenant-a', 'campaign-a', 'high', 'meta_environment', '2'),
    item('tenant-b', 'campaign-b', 'normal', 'system', '3'),
  ], snapshots: [{ comparison: { changes: [
    { tenantId: 'tenant-a', campaignId: 'campaign-a', kind: 'worsened' },
    { tenantId: 'tenant-b', campaignId: 'campaign-b', kind: 'resolved' },
  ] } }] }
  const result = deriveOperatorCampaignPulse(queue)
  assert.equal(result.campaigns.length, 2)
  assert.equal(result.campaigns[0].campaignId, 'campaign-a')
  assert.equal(result.campaigns[0].pendingCount, 2)
  assert.equal(result.campaigns[0].criticalCount, 1)
  assert.equal(result.campaigns[0].enteredOrWorsenedCount, 1)
  assert.equal(result.campaigns[1].resolvedCount, 1)
  assert.equal(result.boundaries.performanceInferred, false)
  assert.equal(result.boundaries.riskScoreInvented, false)
})

test('does not combine equal campaign ids across tenants', () => {
  const queue = { items: [item('tenant-a', 'same', 'normal', 'operator', '1'), item('tenant-b', 'same', 'normal', 'operator', '2')], snapshots: [] }
  assert.equal(deriveOperatorCampaignPulse(queue).campaigns.length, 2)
})
