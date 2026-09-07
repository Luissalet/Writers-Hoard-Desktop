import { db } from '@/db';
import {
  BranchConflictError,
  createCreativeBranch,
  previewBranchPromotion,
  promoteCreativeBranch,
  stageBranchCreate,
  stageBranchRemoval,
  stageBranchUpdate,
  undoBranchPromotion,
} from '@/services/branching';
import type { Outline, OutlineBeat } from '@/engines/outline/types';
import type { Timeline, TimelineConnection, TimelineEvent } from '@/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-creative-branches';

async function clearFixture(): Promise<void> {
  await db.transaction('rw', [
    db.creativeBranches,
    db.creativeBranchDeltas,
    db.branchPromotionReceipts,
    db.outlines,
    db.outlineBeats,
    db.timelines,
    db.timelineEvents,
    db.timelineConnections,
    db.seeds,
  ], async () => {
    await db.creativeBranches.where('projectId').equals(PROJECT_ID).delete();
    await db.creativeBranchDeltas.where('projectId').equals(PROJECT_ID).delete();
    await db.branchPromotionReceipts.where('projectId').equals(PROJECT_ID).delete();
    await db.outlines.where('projectId').equals(PROJECT_ID).delete();
    await db.outlineBeats.where('projectId').equals(PROJECT_ID).delete();
    await db.timelines.where('projectId').equals(PROJECT_ID).delete();
    await db.timelineEvents.where('projectId').equals(PROJECT_ID).delete();
    await db.timelineConnections.where('projectId').equals(PROJECT_ID).delete();
    await db.seeds.where('projectId').equals(PROJECT_ID).delete();
  });
}

export async function testCreativeBranchKernel(): Promise<string> {
  if (!db.isOpen()) await db.open();
  await clearFixture();
  const now = Date.now();
  const outline: Outline = {
    id: 'creative-outline', projectId: PROJECT_ID, title: 'Canon', createdAt: now, updatedAt: now,
  };
  const root: OutlineBeat = {
    id: 'creative-root', outlineId: outline.id, projectId: PROJECT_ID, order: 0,
    level: 'beat', title: 'The door opens', description: 'Canon version', storyPosition: 20,
    status: 'outlined', createdAt: now, updatedAt: now,
  };
  const dependant: OutlineBeat = {
    id: 'creative-child', outlineId: outline.id, projectId: PROJECT_ID, order: 1,
    level: 'beat', parentId: root.id, title: 'A consequence', description: '', storyPosition: 25,
    status: 'empty', createdAt: now, updatedAt: now,
  };
  const timeline: Timeline = {
    id: 'creative-timeline', projectId: PROJECT_ID, title: 'Story', color: '#fff',
    createdAt: now, updatedAt: now,
  };
  const firstEvent: TimelineEvent = {
    id: 'creative-event-one', projectId: PROJECT_ID, timelineId: timeline.id,
    title: 'First event', description: '', date: 'Then', dateMode: 'text', eventType: 'point',
    order: 0, lane: 'main', color: '#fff', createdAt: now, updatedAt: now,
  };
  await db.transaction('rw', [db.outlines, db.outlineBeats, db.timelines, db.timelineEvents], async () => {
    await db.outlines.add(outline);
    await db.outlineBeats.bulkAdd([root, dependant]);
    await db.timelines.add(timeline);
    await db.timelineEvents.add(firstEvent);
  });

  try {
    const branch = await createCreativeBranch({
      projectId: PROJECT_ID,
      title: 'What if the door stays shut?',
      question: 'Who pays for waiting?',
      rootKind: 'outline-beat',
      rootId: root.id,
    });
    await stageBranchUpdate(branch.id, 'outline-beat', root.id, {
      description: 'Alternative version',
    });
    const secondEvent: TimelineEvent = {
      ...firstEvent,
      id: 'creative-event-two',
      projectId: 'foreign-project',
      title: 'Alternative event',
      order: 1,
      createdAt: now + 1,
      updatedAt: now + 1,
    };
    await stageBranchCreate(branch.id, 'timeline-event', secondEvent);
    const connection: TimelineConnection = {
      id: 'creative-connection', projectId: PROJECT_ID, timelineId: timeline.id,
      sourceEventId: firstEvent.id, targetEventId: secondEvent.id, label: 'therefore',
      color: '#fff', style: 'solid', createdAt: now + 1,
    };
    await stageBranchCreate(branch.id, 'timeline-connection', connection);

    const preview = await previewBranchPromotion(branch.id);
    assert(preview.canPromote && preview.changes.length === 3, 'a clean structural branch was not promotable');
    assert((await db.outlineBeats.get(root.id))?.description === 'Canon version', 'staging changed canon');
    assert(!await db.timelineEvents.get(secondEvent.id), 'a proposed event escaped into canon');

    const receipt = await promoteCreativeBranch(branch.id);
    assert(receipt.changes.length === 3, 'promotion receipt did not describe every change');
    assert((await db.outlineBeats.get(root.id))?.description === 'Alternative version', 'promotion missed the beat update');
    assert((await db.timelineEvents.get(secondEvent.id))?.projectId === PROJECT_ID, 'promotion accepted foreign ownership');
    assert(await db.timelineConnections.get(connection.id), 'promotion missed the proposed connection');

    await undoBranchPromotion(receipt.id);
    assert((await db.outlineBeats.get(root.id))?.description === 'Canon version', 'promotion undo did not restore the beat');
    assert(!await db.timelineEvents.get(secondEvent.id), 'promotion undo kept a created event');
    assert(!await db.timelineConnections.get(connection.id), 'promotion undo kept a created connection');

    const promotedAgain = await promoteCreativeBranch(branch.id);
    await db.outlineBeats.update(root.id, { description: 'Later canonical work', updatedAt: Date.now() + 100 });
    let refused = false;
    try {
      await undoBranchPromotion(promotedAgain.id);
    } catch (error) {
      refused = error instanceof BranchConflictError;
    }
    assert(refused, 'undo overwrote work written after branch promotion');
    assert((await db.outlineBeats.get(root.id))?.description === 'Later canonical work', 'refused undo still mutated canon');

    const removalBranch = await createCreativeBranch({
      projectId: PROJECT_ID,
      title: 'Remove the root',
      rootKind: 'outline-beat',
      rootId: dependant.id,
    });
    await stageBranchRemoval(removalBranch.id, 'outline-beat', root.id);
    const unsafeRemoval = await previewBranchPromotion(removalBranch.id);
    assert(
      unsafeRemoval.changes[0]?.conflict === 'invalid-reference' && !unsafeRemoval.canPromote,
      'a beat with a live child was allowed to leave an orphan',
    );

    return 'Creative branches: deltas stay off-canon; preview, promotion and guarded undo are atomic';
  } finally {
    await clearFixture();
  }
}
