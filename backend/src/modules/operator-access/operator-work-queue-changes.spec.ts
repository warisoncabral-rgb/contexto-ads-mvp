import { OperatorWorkItemV1, OperatorWorkQueueStoredSnapshotV1 } from '../../domain/contracts/operator-work-queue';
import { compareWorkQueueSnapshots } from './operator-work-queue-changes';

const baseItem: OperatorWorkItemV1 = {
  workItemId: 'a'.repeat(64), tenantId: '11111111-1111-4111-8111-111111111111',
  tenantDisplayName: 'Rosa VIP', role: 'owner',
  campaignId: '22222222-2222-4222-8222-222222222222',
  executionPlanId: '33333333-3333-4333-8333-333333333333',
  source: 'operational_blocker', blockerCode: 'approval_valid', owner: 'operator',
  priority: 'high', meaning: 'Aprovação pendente.', nextAction: 'Revisar.',
  evidenceRefs: ['approval:none'], observedAt: '2026-08-24T18:00:00.000Z',
};

const previous = (items: OperatorWorkItemV1[]): OperatorWorkQueueStoredSnapshotV1 => ({
  snapshotId: '44444444-4444-4444-8444-444444444444', tenantId: baseItem.tenantId,
  queueDate: '2026-08-23', calendarBasis: 'UTC', snapshotHash: 'b'.repeat(64),
  itemCount: items.length, sourceDecisions: [], generatedAt: '2026-08-23T18:00:00.000Z', items,
});

describe('compareWorkQueueSnapshots', () => {
  it('does not invent changes when no previous snapshot exists', () => {
    expect(compareWorkQueueSnapshots('2026-08-24', [baseItem], null))
      .toEqual({ baselineAvailable: false, changes: [] });
  });

  it.each([
    ['normal', 'critical', 'worsened'],
    ['critical', 'normal', 'improved'],
    ['high', 'high', 'unchanged'],
  ] as const)('classifies priority %s -> %s as %s', (priorPriority, currentPriority, kind) => {
    const result = compareWorkQueueSnapshots('2026-08-24',
      [{ ...baseItem, priority: currentPriority }], previous([{ ...baseItem, priority: priorPriority }]));
    expect(result.changes[0]).toEqual(expect.objectContaining({
      kind, previousPriority: priorPriority, currentPriority,
    }));
  });

  it('classifies presence changes without interpreting copy', () => {
    const entered = { ...baseItem, workItemId: 'c'.repeat(64), blockerCode: 'new_blocker' };
    const result = compareWorkQueueSnapshots('2026-08-24', [entered], previous([baseItem]));
    expect(result.changes.map((change) => [change.workItemId, change.kind])).toEqual([
      [baseItem.workItemId, 'resolved'], [entered.workItemId, 'entered'],
    ]);
  });
});
