import {
  OperatorWorkItemV1,
  OperatorWorkQueueChangeV1,
  OperatorWorkQueueStoredSnapshotV1,
} from '../../domain/contracts/operator-work-queue';

const priorityRank = { critical: 0, high: 1, normal: 2 } as const;

export interface WorkQueueComparisonV1 {
  baselineAvailable: boolean;
  changes: OperatorWorkQueueChangeV1[];
}

export function compareWorkQueueSnapshots(
  currentQueueDate: string,
  currentItems: OperatorWorkItemV1[],
  previous: OperatorWorkQueueStoredSnapshotV1 | null,
): WorkQueueComparisonV1 {
  if (!previous) return { baselineAvailable: false, changes: [] };

  const currentById = new Map(currentItems.map((item) => [item.workItemId, item]));
  const previousById = new Map(previous.items.map((item) => [item.workItemId, item]));
  const ids = [...new Set([...currentById.keys(), ...previousById.keys()])].sort();

  const changes = ids.map((workItemId): OperatorWorkQueueChangeV1 => {
    const current = currentById.get(workItemId) ?? null;
    const prior = previousById.get(workItemId) ?? null;
    const reference = current ?? prior;
    if (!reference) throw new Error('Work queue comparison invariant failed');

    let kind: OperatorWorkQueueChangeV1['kind'];
    if (!prior) kind = 'entered';
    else if (!current) kind = 'resolved';
    else if (priorityRank[current.priority] < priorityRank[prior.priority]) kind = 'worsened';
    else if (priorityRank[current.priority] > priorityRank[prior.priority]) kind = 'improved';
    else kind = 'unchanged';

    return {
      workItemId,
      tenantId: reference.tenantId,
      tenantDisplayName: reference.tenantDisplayName,
      campaignId: reference.campaignId,
      executionPlanId: reference.executionPlanId,
      blockerCode: reference.blockerCode,
      kind,
      previousPriority: prior?.priority ?? null,
      currentPriority: current?.priority ?? null,
      meaning: current?.meaning ?? prior?.meaning ?? '',
      evidenceRefs: [...(current?.evidenceRefs ?? prior?.evidenceRefs ?? [])],
      previousQueueDate: previous.queueDate,
      currentQueueDate,
    };
  });

  return { baselineAvailable: true, changes };
}
