import { db } from '@/db';
import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';
import { generateId } from '@/utils/idGenerator';
import {
  BranchConflictError,
  type BranchEntityByKind,
  type BranchEntityKind,
  type BranchEntitySnapshot,
  type BranchPreviewChange,
  type BranchPromotionChange,
  type BranchPromotionPreview,
  type BranchPromotionReceipt,
  type CreativeBranch,
  type CreativeBranchDelta,
} from './types';

const EMPTY_HASH = sha256Hex('null');

function entityHash(snapshot: BranchEntitySnapshot | null): string {
  return snapshot === null ? EMPTY_HASH : sha256Hex(canonicalJson(snapshot));
}

function snapshotOf<Kind extends BranchEntityKind>(
  kind: Kind,
  value: BranchEntityByKind[Kind],
): Extract<BranchEntitySnapshot, { kind: Kind }> {
  return { kind, value } as Extract<BranchEntitySnapshot, { kind: Kind }>;
}

async function readSnapshot(
  kind: BranchEntityKind,
  entityId: string,
): Promise<BranchEntitySnapshot | null> {
  switch (kind) {
    case 'outline-beat': {
      const value = await db.outlineBeats.get(entityId);
      return value ? snapshotOf(kind, value) : null;
    }
    case 'timeline-event': {
      const value = await db.timelineEvents.get(entityId);
      return value ? snapshotOf(kind, value) : null;
    }
    case 'timeline-connection': {
      const value = await db.timelineConnections.get(entityId);
      return value ? snapshotOf(kind, value) : null;
    }
  }
}

async function putSnapshot(snapshot: BranchEntitySnapshot): Promise<void> {
  switch (snapshot.kind) {
    case 'outline-beat':
      await db.outlineBeats.put(snapshot.value);
      return;
    case 'timeline-event':
      await db.timelineEvents.put(snapshot.value);
      return;
    case 'timeline-connection':
      await db.timelineConnections.put(snapshot.value);
  }
}

async function deleteSnapshot(kind: BranchEntityKind, entityId: string): Promise<void> {
  switch (kind) {
    case 'outline-beat':
      await db.outlineBeats.delete(entityId);
      return;
    case 'timeline-event':
      await db.timelineEvents.delete(entityId);
      return;
    case 'timeline-connection':
      await db.timelineConnections.delete(entityId);
  }
}

function assertOwned(snapshot: BranchEntitySnapshot, projectId: string): void {
  if (snapshot.value.projectId !== projectId) {
    throw new Error('The branch cannot contain structure owned by another project.');
  }
}

function proposalKey(kind: BranchEntityKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

function changedFields(
  before: BranchEntitySnapshot | null,
  after: BranchEntitySnapshot | null,
): string[] {
  if (!before) return ['created'];
  if (!after) return ['removed'];
  const beforeValue = before.value as unknown as Record<string, unknown>;
  const afterValue = after.value as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)])]
    .filter((field) => !['id', 'projectId', 'createdAt', 'updatedAt'].includes(field))
    .filter((field) => canonicalJson(beforeValue[field]) !== canonicalJson(afterValue[field]));
}

function snapshotTitle(snapshot: BranchEntitySnapshot): string {
  if (snapshot.kind === 'timeline-connection') {
    return snapshot.value.label?.trim() || 'Timeline connection';
  }
  return snapshot.value.title;
}

async function branchById(branchId: string): Promise<CreativeBranch> {
  const branch = await db.creativeBranches.get(branchId);
  if (!branch) throw new Error('Creative branch not found.');
  return branch;
}

function assertEditable(branch: CreativeBranch): void {
  if (branch.status !== 'active') {
    throw new Error('Only an active alternative can be edited.');
  }
}

async function deltaFor(
  branchId: string,
  kind: BranchEntityKind,
  targetId: string,
): Promise<CreativeBranchDelta | undefined> {
  return db.creativeBranchDeltas
    .where('[branchId+targetKind+targetId]')
    .equals([branchId, kind, targetId])
    .first();
}

function proposalMap(deltas: readonly CreativeBranchDelta[]): Map<string, BranchEntitySnapshot> {
  const proposals = new Map<string, BranchEntitySnapshot>();
  for (const delta of deltas) {
    if (delta.proposal) proposals.set(proposalKey(delta.targetKind, delta.targetId), delta.proposal);
  }
  return proposals;
}

async function validateReferences(
  snapshot: BranchEntitySnapshot,
  projectId: string,
  proposals: ReadonlyMap<string, BranchEntitySnapshot>,
): Promise<void> {
  assertOwned(snapshot, projectId);
  if (snapshot.kind === 'outline-beat') {
    const outline = await db.outlines.get(snapshot.value.outlineId);
    if (!outline || outline.projectId !== projectId) throw new Error('The outline is outside this project.');
    if (snapshot.value.parentId) {
      const proposed = proposals.get(proposalKey('outline-beat', snapshot.value.parentId));
      const parent = proposed?.kind === 'outline-beat'
        ? proposed.value
        : await db.outlineBeats.get(snapshot.value.parentId);
      if (!parent || parent.projectId !== projectId || parent.outlineId !== snapshot.value.outlineId) {
        throw new Error('The proposed parent beat is unavailable.');
      }
    }
    return;
  }
  if (snapshot.kind === 'timeline-event') {
    const timeline = await db.timelines.get(snapshot.value.timelineId);
    if (!timeline || timeline.projectId !== projectId) throw new Error('The timeline is outside this project.');
    return;
  }
  const timeline = await db.timelines.get(snapshot.value.timelineId);
  if (!timeline || timeline.projectId !== projectId) throw new Error('The timeline is outside this project.');
  for (const eventId of [snapshot.value.sourceEventId, snapshot.value.targetEventId]) {
    const proposed = proposals.get(proposalKey('timeline-event', eventId));
    const event = proposed?.kind === 'timeline-event'
      ? proposed.value
      : await db.timelineEvents.get(eventId);
    if (!event || event.projectId !== projectId) throw new Error('A connected event is unavailable.');
  }
}

async function validateRemoval(
  delta: CreativeBranchDelta,
  deltas: readonly CreativeBranchDelta[],
): Promise<void> {
  const removed = new Set(
    deltas
      .filter((candidate) => candidate.operation === 'remove')
      .map((candidate) => proposalKey(candidate.targetKind, candidate.targetId)),
  );
  if (delta.targetKind === 'timeline-event') {
    const [outgoing, incoming] = await Promise.all([
      db.timelineConnections.where('sourceEventId').equals(delta.targetId).toArray(),
      db.timelineConnections.where('targetEventId').equals(delta.targetId).toArray(),
    ]);
    if ([...outgoing, ...incoming].some((connection) =>
      !removed.has(proposalKey('timeline-connection', connection.id)),
    )) {
      throw new Error('Remove the event connections in the same alternative first.');
    }
    return;
  }
  if (delta.targetKind !== 'outline-beat') return;
  // `linkedBeatId` is not an index on seeds, payoffs or arc beats: a
  // `where('linkedBeatId')` threw a SchemaError, which the preview reported as
  // an invalid reference — so NO alternative could ever remove a beat. Scope by
  // the indexed project and test the link in memory instead.
  const linkedToBeat = (row: { linkedBeatId?: string }) => row.linkedBeatId === delta.targetId;
  const [children, seeds, payoffs, arcBeats] = await Promise.all([
    db.outlineBeats.where('parentId').equals(delta.targetId).toArray(),
    db.seeds.where('projectId').equals(delta.projectId).filter(linkedToBeat).count(),
    db.payoffs.where('projectId').equals(delta.projectId).filter(linkedToBeat).count(),
    db.arcBeats.where('projectId').equals(delta.projectId).filter(linkedToBeat).count(),
  ]);
  const liveChildren = children.some((child) => !removed.has(proposalKey('outline-beat', child.id)));
  if (liveChildren || seeds || payoffs || arcBeats) {
    throw new Error('This beat still has canonical dependants and cannot be removed by the branch.');
  }
}

function withPromotionTimestamp(snapshot: BranchEntitySnapshot, now: number): BranchEntitySnapshot {
  if (snapshot.kind === 'outline-beat') {
    return snapshotOf(snapshot.kind, { ...snapshot.value, updatedAt: now });
  }
  if (snapshot.kind === 'timeline-event') {
    return snapshotOf(snapshot.kind, { ...snapshot.value, updatedAt: now });
  }
  return snapshot;
}

export async function createCreativeBranch(input: {
  projectId: string;
  title: string;
  question?: string;
  rootKind: BranchEntityKind;
  rootId: string;
}): Promise<CreativeBranch> {
  const title = input.title.trim();
  if (!title) throw new Error('A creative branch needs a title.');
  const root = await readSnapshot(input.rootKind, input.rootId);
  if (!root) throw new Error('The branch point no longer exists.');
  assertOwned(root, input.projectId);
  const now = Date.now();
  const branch: CreativeBranch = {
    id: generateId('branch'),
    projectId: input.projectId,
    title,
    ...(input.question?.trim() ? { question: input.question.trim() } : {}),
    root: {
      kind: input.rootKind,
      entityId: input.rootId,
      title: snapshotTitle(root),
    },
    baseHash: entityHash(root),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await db.creativeBranches.add(branch);
  return branch;
}

export async function listCreativeBranches(projectId: string): Promise<CreativeBranch[]> {
  return db.creativeBranches.where('projectId').equals(projectId).reverse().sortBy('updatedAt');
}

export async function listBranchDeltas(branchId: string): Promise<CreativeBranchDelta[]> {
  return db.creativeBranchDeltas.where('branchId').equals(branchId).sortBy('createdAt');
}

export async function stageBranchUpdate<Kind extends BranchEntityKind>(
  branchId: string,
  kind: Kind,
  targetId: string,
  changes: Partial<BranchEntityByKind[Kind]>,
): Promise<CreativeBranchDelta> {
  return db.transaction('rw', [db.creativeBranches, db.creativeBranchDeltas, db.outlineBeats, db.timelineEvents, db.timelineConnections], async () => {
    const branch = await branchById(branchId);
    assertEditable(branch);
    const previous = await deltaFor(branchId, kind, targetId);
    if (previous?.operation === 'remove') throw new Error('Restore this proposed removal before editing it.');
    const starting = previous?.proposal ?? await readSnapshot(kind, targetId);
    if (!starting || starting.kind !== kind) throw new Error('The branch target no longer exists.');
    assertOwned(starting, branch.projectId);
    const now = Date.now();
    const value = {
      ...starting.value,
      ...changes,
      id: targetId,
      projectId: branch.projectId,
    } as BranchEntityByKind[Kind];
    const proposal = snapshotOf(kind, value);
    const delta: CreativeBranchDelta = previous
      ? { ...previous, operation: previous.operation, proposal, updatedAt: now }
      : {
          id: generateId('branch_delta'),
          projectId: branch.projectId,
          branchId,
          targetKind: kind,
          targetId,
          operation: 'update',
          base: starting,
          baseHash: entityHash(starting),
          proposal,
          createdAt: now,
          updatedAt: now,
        };
    await db.creativeBranchDeltas.put(delta);
    await db.creativeBranches.update(branchId, { updatedAt: now });
    return delta;
  });
}

export async function stageBranchCreate<Kind extends BranchEntityKind>(
  branchId: string,
  kind: Kind,
  value: BranchEntityByKind[Kind],
): Promise<CreativeBranchDelta> {
  return db.transaction('rw', [db.creativeBranches, db.creativeBranchDeltas, db.outlineBeats, db.timelineEvents, db.timelineConnections], async () => {
    const branch = await branchById(branchId);
    assertEditable(branch);
    if (await deltaFor(branchId, kind, value.id)) throw new Error('That target is already part of this alternative.');
    if (await readSnapshot(kind, value.id)) throw new Error('That canonical id already exists.');
    const proposal = snapshotOf(kind, { ...value, projectId: branch.projectId });
    assertOwned(proposal, branch.projectId);
    const now = Date.now();
    const delta: CreativeBranchDelta = {
      id: generateId('branch_delta'),
      projectId: branch.projectId,
      branchId,
      targetKind: kind,
      targetId: value.id,
      operation: 'create',
      base: null,
      baseHash: EMPTY_HASH,
      proposal,
      createdAt: now,
      updatedAt: now,
    };
    await db.creativeBranchDeltas.add(delta);
    await db.creativeBranches.update(branchId, { updatedAt: now });
    return delta;
  });
}

export async function stageBranchRemoval(
  branchId: string,
  kind: BranchEntityKind,
  targetId: string,
): Promise<CreativeBranchDelta | null> {
  return db.transaction('rw', [db.creativeBranches, db.creativeBranchDeltas, db.outlineBeats, db.timelineEvents, db.timelineConnections], async () => {
    const branch = await branchById(branchId);
    assertEditable(branch);
    const previous = await deltaFor(branchId, kind, targetId);
    if (previous?.operation === 'create') {
      await db.creativeBranchDeltas.delete(previous.id);
      await db.creativeBranches.update(branchId, { updatedAt: Date.now() });
      return null;
    }
    const live = previous?.base ?? await readSnapshot(kind, targetId);
    if (!live) throw new Error('The branch target no longer exists.');
    assertOwned(live, branch.projectId);
    const now = Date.now();
    const delta: CreativeBranchDelta = previous
      ? { ...previous, operation: 'remove', proposal: null, updatedAt: now }
      : {
          id: generateId('branch_delta'),
          projectId: branch.projectId,
          branchId,
          targetKind: kind,
          targetId,
          operation: 'remove',
          base: live,
          baseHash: entityHash(live),
          proposal: null,
          createdAt: now,
          updatedAt: now,
        };
    await db.creativeBranchDeltas.put(delta);
    await db.creativeBranches.update(branchId, { updatedAt: now });
    return delta;
  });
}

export async function discardBranchDelta(deltaId: string): Promise<void> {
  const delta = await db.creativeBranchDeltas.get(deltaId);
  if (!delta) return;
  const branch = await branchById(delta.branchId);
  assertEditable(branch);
  await db.transaction('rw', [db.creativeBranches, db.creativeBranchDeltas], async () => {
    await db.creativeBranchDeltas.delete(deltaId);
    await db.creativeBranches.update(branch.id, { updatedAt: Date.now() });
  });
}

async function buildPreview(
  branch: CreativeBranch,
  deltas: readonly CreativeBranchDelta[],
): Promise<BranchPromotionPreview> {
  const proposals = proposalMap(deltas);
  const changes: BranchPreviewChange[] = [];
  for (const delta of deltas) {
    const live = await readSnapshot(delta.targetKind, delta.targetId);
    let conflict: BranchPreviewChange['conflict'];
    if (delta.operation === 'create') {
      if (live) conflict = 'target-now-exists';
    } else if (!live) {
      conflict = 'target-missing';
    } else if (entityHash(live) !== delta.baseHash) {
      conflict = 'canonical-changed';
    }
    if (!conflict) {
      try {
        if (delta.proposal) await validateReferences(delta.proposal, branch.projectId, proposals);
        if (delta.operation === 'remove') await validateRemoval(delta, deltas);
      } catch {
        conflict = 'invalid-reference';
      }
    }
    changes.push({
      deltaId: delta.id,
      targetKind: delta.targetKind,
      targetId: delta.targetId,
      operation: delta.operation,
      before: live,
      after: delta.proposal,
      beforeHash: entityHash(live),
      afterHash: entityHash(delta.proposal),
      changedFields: changedFields(delta.base, delta.proposal),
      ...(conflict ? { conflict } : {}),
    });
  }
  const root = await readSnapshot(branch.root.kind, branch.root.entityId);
  const rootChanged = entityHash(root) !== branch.baseHash;
  return {
    branch,
    changes,
    rootChanged,
    canPromote:
      branch.status === 'active' &&
      changes.length > 0 &&
      !rootChanged &&
      changes.every((change) => !change.conflict),
  };
}

export async function previewBranchPromotion(branchId: string): Promise<BranchPromotionPreview> {
  const branch = await branchById(branchId);
  const deltas = await listBranchDeltas(branchId);
  return buildPreview(branch, deltas);
}

const PROMOTION_TABLES = () => [
  db.creativeBranches,
  db.creativeBranchDeltas,
  db.branchPromotionReceipts,
  db.outlines,
  db.outlineBeats,
  db.timelines,
  db.timelineEvents,
  db.timelineConnections,
  db.seeds,
  db.payoffs,
  db.arcBeats,
];

export async function promoteCreativeBranch(branchId: string): Promise<BranchPromotionReceipt> {
  const initial = await previewBranchPromotion(branchId);
  if (!initial.canPromote) throw new BranchConflictError('The alternative no longer matches canon.', initial);
  return db.transaction('rw', PROMOTION_TABLES(), async () => {
    const branch = await branchById(branchId);
    const deltas = await listBranchDeltas(branchId);
    const preview = await buildPreview(branch, deltas);
    if (!preview.canPromote) throw new BranchConflictError('Canon changed while the preview was open.', preview);
    const now = Date.now();
    const changes: BranchPromotionChange[] = preview.changes.map((change) => {
      const after = change.after ? withPromotionTimestamp(change.after, now) : null;
      return {
        deltaId: change.deltaId,
        targetKind: change.targetKind,
        targetId: change.targetId,
        before: change.before,
        after,
        beforeHash: entityHash(change.before),
        afterHash: entityHash(after),
      };
    });

    for (const kind of ['timeline-connection', 'timeline-event', 'outline-beat'] as const) {
      for (const change of changes.filter((candidate) => candidate.targetKind === kind && !candidate.after)) {
        await deleteSnapshot(kind, change.targetId);
      }
    }
    for (const kind of ['outline-beat', 'timeline-event', 'timeline-connection'] as const) {
      for (const change of changes.filter((candidate) => candidate.targetKind === kind && candidate.after)) {
        await putSnapshot(change.after!);
      }
    }

    const receipt: BranchPromotionReceipt = {
      id: generateId('branch_promotion'),
      projectId: branch.projectId,
      branchId,
      changes,
      createdAt: now,
    };
    await db.branchPromotionReceipts.add(receipt);
    await db.creativeBranches.update(branchId, { status: 'promoted', promotedAt: now, updatedAt: now });
    return receipt;
  });
}

export async function undoBranchPromotion(receiptId: string): Promise<BranchPromotionReceipt> {
  const receipt = await db.branchPromotionReceipts.get(receiptId);
  if (!receipt) throw new Error('Branch promotion receipt not found.');
  if (receipt.undoneAt) return receipt;
  return db.transaction('rw', PROMOTION_TABLES(), async () => {
    const current = await db.branchPromotionReceipts.get(receiptId);
    if (!current) throw new Error('Branch promotion receipt not found.');
    if (current.undoneAt) return current;
    const branch = await branchById(current.branchId);
    const conflicts: BranchPreviewChange[] = [];
    for (const change of current.changes) {
      const live = await readSnapshot(change.targetKind, change.targetId);
      if (entityHash(live) === change.afterHash) continue;
      conflicts.push({
        ...change,
        operation: change.before ? 'update' : 'create',
        changedFields: changedFields(change.after, live),
        conflict: live ? 'canonical-changed' : 'target-missing',
      });
    }
    if (conflicts.length) {
      throw new BranchConflictError('Later canonical work prevents this promotion from being undone.', {
        branch,
        changes: conflicts,
        rootChanged: true,
        canPromote: false,
      });
    }
    const beforeMap = new Map<string, BranchEntitySnapshot>();
    for (const change of current.changes) {
      if (change.before) beforeMap.set(proposalKey(change.targetKind, change.targetId), change.before);
    }
    for (const change of current.changes) {
      if (change.before) await validateReferences(change.before, current.projectId, beforeMap);
    }

    for (const kind of ['timeline-connection', 'timeline-event', 'outline-beat'] as const) {
      for (const change of current.changes.filter((candidate) => candidate.targetKind === kind && !candidate.before)) {
        await deleteSnapshot(kind, change.targetId);
      }
    }
    for (const kind of ['outline-beat', 'timeline-event', 'timeline-connection'] as const) {
      for (const change of current.changes.filter((candidate) => candidate.targetKind === kind && candidate.before)) {
        await putSnapshot(change.before!);
      }
    }
    const undoneAt = Date.now();
    const undone = { ...current, undoneAt };
    await db.branchPromotionReceipts.put(undone);
    await db.creativeBranches.update(current.branchId, {
      status: 'active',
      promotedAt: undefined,
      updatedAt: undoneAt,
    });
    return undone;
  });
}

export async function archiveCreativeBranch(branchId: string): Promise<void> {
  const branch = await branchById(branchId);
  if (branch.status === 'promoted') throw new Error('Undo the promotion before archiving this alternative.');
  await db.creativeBranches.update(branchId, { status: 'archived', updatedAt: Date.now() });
}

export async function reactivateCreativeBranch(branchId: string): Promise<void> {
  const branch = await branchById(branchId);
  if (branch.status === 'promoted') throw new Error('This alternative is currently canonical.');
  await db.creativeBranches.update(branchId, { status: 'active', updatedAt: Date.now() });
}
