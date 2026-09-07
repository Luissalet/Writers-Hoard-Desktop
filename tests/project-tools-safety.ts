import type { IndexableType } from 'dexie';
import { db } from '@/db';
import {
  promoteNoteToWriting,
  undoConversion,
} from '@/services/projectTools';
import type { Project, Writing } from '@/types';
import type { ConversionReceipt, EntityLink } from '@/types/projectTools';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-conversion-safety';

function project(now: number): Project {
  return {
    id: PROJECT_ID,
    title: 'Conversion safety fixture',
    mode: 'novelist',
    type: 'standalone',
    color: '#000000',
    description: '',
    status: 'in-progress',
    enabledEngines: ['notes', 'writings'],
    engineOrder: ['notes', 'writings'],
    createdAt: now,
    updatedAt: now,
  };
}

async function addNote(id: string, text: string, now: number): Promise<void> {
  await db.notes.add({
    id,
    projectId: PROJECT_ID,
    kind: 'idea',
    text,
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
}

function legacyWriting(id: string, projectId: string, now: number): Writing {
  return {
    id,
    projectId,
    title: 'Legacy promoted writing',
    status: 'idea',
    content: '<p>These words must survive.</p>',
    wordCount: 4,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function clearFixture(): Promise<void> {
  const writings = await db.writings.where('projectId').equals(PROJECT_ID).primaryKeys();
  const annotations = await db.annotations.where('projectId').equals(PROJECT_ID).primaryKeys();
  await db.transaction('rw', [
    db.projects,
    db.notes,
    db.writings,
    db.writingSnapshots,
    db.entityLinks,
    db.conversionReceipts,
    db.outlineBeats,
    db.annotations,
    db.annotationReferences,
    db.citations,
    db.publishingProfiles,
  ], async () => {
    await db.notes.where('projectId').equals(PROJECT_ID).delete();
    if (writings.length) {
      await db.writingSnapshots.where('writingId').anyOf(writings).delete();
      await db.writings.bulkDelete(writings);
    }
    if (annotations.length) {
      await db.annotationReferences.where('annotationId').anyOf(annotations).delete();
      await db.annotations.bulkDelete(annotations);
    }
    await db.entityLinks.where('projectId').equals(PROJECT_ID).delete();
    await db.conversionReceipts.where('projectId').equals(PROJECT_ID).delete();
    await db.outlineBeats.where('projectId').equals(PROJECT_ID).delete();
    await db.citations.where('projectId').equals(PROJECT_ID).delete();
    await db.publishingProfiles.where('projectId').equals(PROJECT_ID).delete();
    await db.projects.delete(PROJECT_ID);
  });
}

export async function testConversionUndoSafety(): Promise<string[]> {
  await clearFixture();
  const now = Date.now();
  await db.projects.add(project(now));

  try {
    // A fresh v2 receipt owns exactly the untouched row it just created.
    await addNote('conversion-note-intact', 'An untouched seed', now);
    const intact = await promoteNoteToWriting('conversion-note-intact');
    assert(intact.receiptVersion === 2, 'new conversions must carry a guarded v2 receipt');
    assert(intact.targetVersion !== undefined && intact.targetFingerprint, 'new receipt lacks target identity');
    const removed = await undoConversion(intact.id);
    assert(removed.status === 'removed-intact', `untouched conversion produced ${removed.status}`);
    assert(!(await db.writings.get(intact.targetEntityId)), 'an untouched generated writing was not removed');
    assert(
      (await db.conversionReceipts.get(intact.id))?.undoDisposition === 'removed-intact',
      'the receipt did not audit the physical removal',
    );

    // Any later words OR history turn deletion into a provenance-only detach.
    await addNote('conversion-note-edited', 'A seed that grows', now + 1);
    const edited = await promoteNoteToWriting('conversion-note-edited');
    const editedRow = await db.writings.get(edited.targetEntityId);
    assert(editedRow, 'edited fixture target was not created');
    const laterContent = '<p>A seed that grew into a chapter.</p>';
    await db.writings.update(editedRow.id, {
      content: laterContent,
      wordCount: 7,
      updatedAt: editedRow.updatedAt + 1,
    });
    await db.writingSnapshots.add({
      id: 'conversion-history-kept',
      writingId: editedRow.id,
      projectId: PROJECT_ID,
      title: editedRow.title,
      content: editedRow.content,
      wordCount: editedRow.wordCount,
      reason: 'manual',
      createdAt: now + 2,
    });
    const detached = await undoConversion(edited.id);
    assert(detached.status === 'detached-preserved', `edited conversion produced ${detached.status}`);
    assert((await db.writings.get(editedRow.id))?.content === laterContent, 'undo destroyed later writing work');
    assert(await db.writingSnapshots.get('conversion-history-kept'), 'undo destroyed writing history');
    assert(
      !(await db.entityLinks.get(edited.conversionLinkId!)),
      'detaching an edited conversion left its conversion edge active',
    );

    // A legacy receipt has no reliable target identity and is always preserved.
    const legacyTarget = legacyWriting('conversion-legacy-target', PROJECT_ID, now + 3);
    const legacyReceipt: ConversionReceipt = {
      id: 'conversion-legacy-receipt',
      projectId: PROJECT_ID,
      sourceEngineId: 'notes',
      sourceEntityId: 'conversion-note-legacy',
      targetEngineId: 'writings',
      targetEntityId: legacyTarget.id,
      targetTable: 'writings',
      preview: 'Legacy → writing',
      undoPayload: { targetId: legacyTarget.id, targetTable: 'writings' },
      createdAt: now + 3,
    };
    const legacyLink: EntityLink = {
      id: 'conversion-legacy-link',
      projectId: PROJECT_ID,
      sourceEngineId: 'notes',
      sourceEntityType: 'note',
      sourceEntityId: legacyReceipt.sourceEntityId,
      sourceTitle: 'Legacy',
      targetEngineId: 'writings',
      targetEntityType: 'writing',
      targetEntityId: legacyTarget.id,
      targetTitle: legacyTarget.title,
      relation: 'promoted-to',
      provenance: 'conversion',
      createdAt: now + 3,
      updatedAt: now + 3,
    };
    await db.transaction('rw', [db.writings, db.conversionReceipts, db.entityLinks], async () => {
      await db.writings.add(legacyTarget);
      await db.conversionReceipts.add(legacyReceipt);
      await db.entityLinks.add(legacyLink);
    });
    const legacy = await undoConversion(legacyReceipt.id);
    assert(legacy.status === 'detached-preserved' && legacy.reason === 'legacy', 'legacy receipt authorised a delete');
    assert(await db.writings.get(legacyTarget.id), 'legacy target did not survive safe undo');

    // If the final receipt update fails, IndexedDB must roll the preceding
    // unlink/delete back with it. This proves the transaction, not just intent.
    await addNote('conversion-note-rollback', 'Rollback me safely', now + 4);
    const rollback = await promoteNoteToWriting('conversion-note-rollback');
    const failReceiptUpdate = (
      _changes: object,
      primaryKey: IndexableType,
    ): void => {
      if (primaryKey === rollback.id) throw new Error('forced receipt failure');
    };
    db.conversionReceipts.hook('updating', failReceiptUpdate);
    let failed = false;
    try {
      await undoConversion(rollback.id);
    } catch {
      failed = true;
    } finally {
      db.conversionReceipts.hook.updating.unsubscribe(failReceiptUpdate);
    }
    assert(failed, 'forced receipt failure did not abort undo');
    assert(await db.writings.get(rollback.targetEntityId), 'failed undo partially deleted its target');
    assert(await db.entityLinks.get(rollback.conversionLinkId!), 'failed undo partially removed its provenance link');
    assert(!(await db.conversionReceipts.get(rollback.id))?.undoneAt, 'failed undo was marked complete');

    const retry = await undoConversion(rollback.id);
    assert(retry.status === 'removed-intact', 'a rolled-back undo was not safely retryable');
    const repeated = await undoConversion(rollback.id);
    assert(repeated.status === 'already-undone', 'undo is not idempotent after completion');

    return [
      'conversion undo removes only an untouched v2 target',
      'edited and legacy conversion targets keep their writing and history',
      'conversion undo is atomic, audited and idempotent',
    ];
  } finally {
    await clearFixture();
  }
}
