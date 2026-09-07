import type { IndexableType, Transaction } from 'dexie';
import { db } from '@/db';
import {
  applyGoogleDocSync,
  hasDocChanged,
  type GoogleDocSyncPreview,
} from '@/services/googleDocs';
import { listSnapshots } from '@/engines/writings/snapshots';
import type { Project, Writing } from '@/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-google-doc-safety';

function makeProject(now: number): Project {
  return {
    id: PROJECT_ID,
    title: 'Google Docs safety fixture',
    mode: 'novelist',
    type: 'standalone',
    color: '#000000',
    description: '',
    status: 'in-progress',
    enabledEngines: ['writings'],
    engineOrder: ['writings'],
    createdAt: now,
    updatedAt: now,
  };
}

function makeWriting(id: string, content: string, version: number): Writing {
  return {
    id,
    projectId: PROJECT_ID,
    title: 'Linked chapter',
    status: 'draft',
    content,
    wordCount: content.includes('local') ? 3 : 4,
    tags: ['google-doc'],
    createdAt: version,
    updatedAt: version,
    googleDocId: `doc-${id}`,
    googleDocUrl: `https://docs.google.com/document/d/doc-${id}`,
    googleDocName: 'Linked chapter',
    syncDirection: 'pull',
    isGoogleDoc: true,
  };
}

function previewFor(writing: Writing, html: string): GoogleDocSyncPreview {
  return {
    writingId: writing.id,
    projectId: writing.projectId,
    expectedVersion: writing.updatedAt,
    changes: {
      title: 'Remote chapter',
      googleDocName: 'Remote chapter',
      content: html,
      wordCount: 5,
    },
    risk: 'none',
    cachedWordCount: writing.wordCount,
    incomingWordCount: 5,
  };
}

async function clearFixture(): Promise<void> {
  const ids = await db.writings.where('projectId').equals(PROJECT_ID).primaryKeys();
  await db.transaction('rw', [db.projects, db.writings, db.writingSnapshots], async () => {
    if (ids.length) {
      await db.writingSnapshots.where('writingId').anyOf(ids).delete();
      await db.writings.bulkDelete(ids);
    }
    await db.projects.delete(PROJECT_ID);
  });
}

export async function testGoogleDocWriteSafety(): Promise<string[]> {
  await clearFixture();
  const now = Date.now();
  await db.projects.add(makeProject(now));

  try {
    const original = makeWriting('gdoc-happy', '<p>The local beginning.</p>', now);
    await db.writings.add(original);
    const incoming = '<p>The remote continuation arrives intact.</p>';
    const happy = await applyGoogleDocSync(original, previewFor(original, incoming));
    assert(happy.status === 'applied', `ordinary Google pull produced ${happy.status}`);
    assert((await db.writings.get(original.id))?.content === incoming, 'ordinary pull did not land');
    const happyHistory = await listSnapshots(original.id);
    assert(happyHistory.length === 1 && happyHistory[0].content === original.content, 'pull did not snapshot the replaced local text');

    const base = makeWriting('gdoc-conflict', '<p>The original local line.</p>', now + 10);
    await db.writings.add(base);
    const remote = '<p>The remote line that arrived later.</p>';
    const preview = previewFor(base, remote);
    const locallyEdited = '<p>The local line changed while the network was in flight.</p>';
    await db.writings.update(base.id, {
      content: locallyEdited,
      wordCount: 10,
      updatedAt: base.updatedAt + 1,
    });

    const conflict = await applyGoogleDocSync(base, preview);
    assert(conflict.status === 'conflict', `concurrent Google pull produced ${conflict.status}`);
    assert((await db.writings.get(base.id))?.content === locallyEdited, 'concurrent pull overwrote the local edit');
    assert(conflict.incomingSnapshotId, 'the refused Google version was not kept in History');
    assert((await db.writingSnapshots.get(conflict.incomingSnapshotId))?.content === remote, 'History kept the wrong side of the conflict');

    const forced = await applyGoogleDocSync(conflict.current, preview, conflict.current.updatedAt);
    assert(forced.status === 'applied', `explicit use-remote choice produced ${forced.status}`);
    assert((await db.writings.get(base.id))?.content === remote, 'explicit use-remote choice did not land');
    const conflictHistory = await listSnapshots(base.id);
    assert(conflictHistory.some(row => row.content === locallyEdited), 'use-remote did not preserve the displaced local edit');
    assert(conflictHistory.some(row => row.content === remote), 'conflict did not preserve the incoming remote text');

    // Force the restore-point write to fail. The writing update is in the same
    // transaction, so not one field may move.
    const guarded = makeWriting('gdoc-snapshot-failure', '<p>Only local copy.</p>', now + 20);
    await db.writings.add(guarded);
    const failSnapshot = function (
      _primaryKey: IndexableType,
      row: WritingSnapshot,
      _transaction: Transaction,
    ): void {
      if (row.writingId === guarded.id) throw new Error('forced snapshot failure');
    };
    db.writingSnapshots.hook('creating', failSnapshot);
    let snapshotFailed = false;
    try {
      await applyGoogleDocSync(guarded, previewFor(guarded, '<p>Must not land.</p>'));
    } catch {
      snapshotFailed = true;
    } finally {
      db.writingSnapshots.hook.creating.unsubscribe(failSnapshot);
    }
    assert(snapshotFailed, 'forced snapshot failure was swallowed');
    const afterFailure = await db.writings.get(guarded.id);
    assert(afterFailure?.content === guarded.content, 'snapshot failure partially overwrote the writing');
    assert(afterFailure?.updatedAt === guarded.updatedAt, 'snapshot failure still advanced the writing version');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    let metadataFailed = false;
    try {
      await hasDocChanged('token', { ...guarded, lastSyncedAt: now });
    } catch {
      metadataFailed = true;
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert(metadataFailed, 'metadata network failure was reported as unchanged');
    assert(
      (await hasDocChanged('token', { ...guarded, googleDocId: undefined })).status === 'not-linked',
      'unlinked writing did not return a distinct status',
    );
    assert(
      (await hasDocChanged('token', { ...guarded, lastSyncedAt: undefined })).status === 'never-synced',
      'never-synced writing did not return a distinct status',
    );

    return [
      'Google Docs pull commits snapshot and replacement atomically',
      'Google Docs conflict preserves both local and remote versions',
      'Google Docs metadata failures never masquerade as unchanged',
    ];
  } finally {
    await clearFixture();
  }
}
