// ============================================
// Writings Engine — Database Operations
// ============================================

import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { deleteEntityAnnotations } from '@/engines/_shared/deleteEntityAnnotations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { Annotation, AnnotationReference } from '@/engines/annotations/types';
import type { Writing } from '@/types';
import { ensureSnapshot, takeSnapshot, type SnapshotWriteOutcome } from './snapshots';
import type { WritingSnapshot } from './snapshotTypes';

export async function getWritings(projectId: string): Promise<Writing[]> {
  return db.writings.where('projectId').equals(projectId).toArray();
}

export async function getWriting(id: string): Promise<Writing | undefined> {
  return db.writings.get(id);
}

export async function createWriting(writing: Writing): Promise<string> {
  const id = await db.writings.add(writing);
  // The dashboard sorts projects by their own updatedAt, which writing a
  // chapter would otherwise never move.
  void touchProject(writing.projectId);
  return id;
}

/**
 * Thrown when a write found no row to write to. Named so a caller can tell the
 * one failure that is not worth retrying — the chapter is gone — from a quota
 * or a closed database, which are.
 */
export class WritingGoneError extends Error {
  // A plain field, not a constructor parameter property: `erasableSyntaxOnly`
  // is on, and a parameter property is syntax that emits.
  readonly writingId: string;

  constructor(writingId: string) {
    super(`writing ${writingId} no longer exists`);
    this.name = 'WritingGoneError';
    this.writingId = writingId;
  }
}

/**
 * Update a writing. Every writer of the row comes through here, and the whole
 * of what that means — one transaction, a monotonic version stamp, a vanished
 * row raised as an error, a moved row refused with both texts kept — is on
 * `updateWritingAtVersion` below, which this is the `Promise<void>` face of.
 *
 * The two are separate only because of a type: `makeEntityHook`'s `updateFn` is
 * `(id, changes) => Promise<void>`, and a `Promise<number>` is not assignable to
 * it. Callers that need the new version back (the editor, which must keep its
 * baseline in step to save again) call the other one.
 */
export async function updateWriting(
  id: string,
  changes: Partial<Writing>,
  expectedVersion?: number,
): Promise<void> {
  await updateWritingAtVersion(id, changes, expectedVersion);
}

/**
 * The row's version token, for a caller that is about to hold a copy of the
 * chapter across time and will need to prove, later, that nothing moved.
 *
 * `undefined` when the chapter is gone — the caller has nothing to write to and
 * `updateWritingAtVersion` will say so with `WritingGoneError`.
 */
export async function getWritingVersion(id: string): Promise<number | undefined> {
  return (await db.writings.get(id))?.updatedAt;
}

/**
 * A write that lost a race, and everything needed to make the loss reversible.
 *
 * `rejectedSnapshotId` is the point of the whole class: the text this write
 * WOULD have put on disk has been filed in the chapter's version history before
 * the error was raised, so the loser can read both versions side by side and
 * restore theirs with one click. `current` is the row as it now stands — the
 * text that won — so a caller that has an editor on screen can offer the choice
 * without a second read.
 */
export class WritingConflictError extends Error {
  // Plain fields rather than constructor parameter properties, for the same
  // `erasableSyntaxOnly` reason as `WritingGoneError` above.
  readonly writingId: string;
  /** The version the caller composed its write against. */
  readonly expectedVersion: number;
  /** The version the row actually carries now. */
  readonly actualVersion: number;
  /** The row as it stands, i.e. the text that won the race. */
  readonly current: Writing;
  /**
   * Version-history row holding the text that was refused, or `null` when the
   * write carried no body (nothing was at stake) or the snapshot itself failed.
   */
  readonly rejectedSnapshotId: string | null;

  constructor(current: Writing, expectedVersion: number, rejectedSnapshotId: string | null) {
    super(
      `writing ${current.id} moved from ${expectedVersion} to ${current.updatedAt} ` +
      'while this write was being composed',
    );
    this.name = 'WritingConflictError';
    this.writingId = current.id;
    this.expectedVersion = expectedVersion;
    this.actualVersion = current.updatedAt;
    this.current = current;
    this.rejectedSnapshotId = rejectedSnapshotId;
  }
}

/**
 * The next version token for a row, given the one it carries now.
 *
 * `updatedAt` is the token because it is the only field EVERY writer of the row
 * already stamps, so it cannot fall out of date the way a parallel `rev` column
 * would the first time somebody wrote a chapter without remembering to bump it.
 * But a wall clock read is not a version: `Date.now()` repeats for as long as
 * the millisecond lasts, and two writes inside one millisecond are not a
 * thought experiment here — the copilot's tool call and the editor's 1.2 s
 * autosave flush run in the same renderer, on the same microtask queue, against
 * a warm IndexedDB object store. Two writes that share a token are exactly the
 * case a compare-and-swap must catch, and a raw timestamp is blind to it.
 *
 * So the stamp is forced strictly upward: the clock when the clock has moved,
 * and one tick past the previous version when it has not. That makes the value
 * a monotonic counter that also happens to be a timestamp — the sort order the
 * dashboard, `recentChanges` and the `updatedAt` index all read stays exactly
 * what it was, and the token can never repeat for a given row. It also survives
 * a backwards clock step (an NTP correction, a laptop crossing a timezone),
 * which a bare `Date.now()` does not.
 */
function nextWritingVersion(previous: number | undefined): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}

/**
 * Update a writing, INSIST that the update reached a row, and — when the caller
 * says which version it wrote against — refuse to overwrite a row that has
 * moved since.
 *
 * ## Why a vanished row is an error
 *
 * `db.writings.update` on an id that is no longer there resolves with 0 rather
 * than rejecting (see `chapterOrderPersist.ts`, which relies on exactly that to
 * pass over a chapter deleted in another window). For the reorder that is the
 * behaviour you want; for the editor's autosave it is the worst outcome the
 * save path has, because every layer above reads "the promise resolved" as "the
 * words are on disk": the indicator turns to Saved, the recovery journal — the
 * only other copy of the text — is deleted as residue, and every keystroke
 * after that is written to nothing at all. A chapter the copilot deleted while
 * the writer had it open is exactly the case, and the writer's evening of work
 * goes with it, under a green tick.
 *
 * ## Why a MOVED row is an error too
 *
 * The same two writers, both alive, is the other half of that story and the
 * worse one, because nothing is deleted and nothing looks wrong. The editor
 * holds the whole chapter in memory and flushes ALL of it 1.2 s after the last
 * keystroke; the copilot rewrites the same row through `wh_update_writing`.
 * Neither used to look at what the other did, and `notifyDataChanged` refreshes
 * the chapter LIST without touching the open editor's state — so after the
 * model rewrote a chapter the editor still held the pre-copilot text, and its
 * next flush put it back, silently, under a green tick. The mirror image loses
 * the writer's paragraph to the model.
 *
 * A blind overwrite is impossible from here on. Read and write happen inside
 * ONE `rw` transaction, so nothing can slip between the check and the write,
 * and a caller that passes `expectedVersion` gets a compare-and-swap: the write
 * lands only on the row it was composed against.
 *
 * The transaction is scoped to `db.writings` alone so it nests safely — the two
 * callers that already run inside a transaction of their own (`projectReplace`,
 * applying and undoing a batch) both hold that table in scope, and any future
 * one must, since it is updating writings.
 *
 * ## Why a rejection is never a loss
 *
 * A refused write still carries the loser's words, and they exist nowhere else
 * — they were never on disk. So before the error is raised they are filed in
 * `writingSnapshots`, the store this app already uses for exactly this (a
 * rescued crash draft is filed the same way, with the same `manual` reason, and
 * version history is never pruned). Both texts are then a click apart in the
 * history panel, and `WritingConflictError` carries the id of the one that was
 * refused plus the row that won, so the caller can put the choice to the writer
 * without reading anything again.
 *
 * ## Why the guard is opt-in
 *
 * `expectedVersion` is optional, and every existing caller keeps working
 * untouched. That is not a compromise, it is the only correct shape: the
 * baseline is a fact only the caller knows — "this is the row I read before I
 * composed this" — and there is no honest default for a caller that never read
 * one. Making it a required parameter would also force the shared
 * `makeEntityHook.updateFn` contract to change for every engine in the app, a
 * blast radius far wider than the bug.
 *
 * What IS mandatory, and inherited by every writer that comes later, is
 * everything around it: one transaction, one monotonic stamp, one existence
 * check, one error type, one recovery path. A caller that wants the guard turns
 * it on by naming the version it read; it never has to build it.
 */
export async function updateWritingAtVersion(
  id: string,
  changes: Partial<Writing>,
  expectedVersion?: number,
): Promise<number> {
  type Outcome =
    | { kind: 'gone' }
    | { kind: 'conflict'; row: Writing; expected: number }
    | { kind: 'written'; version: number };

  const outcome = await db.transaction('rw', [db.writings], async (): Promise<Outcome> => {
    const row = await db.writings.get(id);
    if (!row) return { kind: 'gone' };
    if (expectedVersion !== undefined && row.updatedAt !== expectedVersion) {
      return { kind: 'conflict', row, expected: expectedVersion };
    }
    const version = nextWritingVersion(row.updatedAt);
    // `updatedAt` is stamped LAST so a caller cannot hand in a version of its
    // own and quietly break the ordering every other reader depends on.
    const written = await db.writings.update(id, { ...changes, updatedAt: version });
    // Belt and braces: the row was there a line ago, inside this transaction,
    // so 0 here means something is wrong with the write rather than with the
    // key — but the caller's contract is the same either way.
    if (written === 0) return { kind: 'gone' };
    return { kind: 'written', version };
  });

  if (outcome.kind === 'gone') throw new WritingGoneError(id);

  if (outcome.kind === 'conflict') {
    // Only a body is worth filing. A refused metadata write (a status flip, a
    // tag) loses nothing the caller cannot simply send again, and filing a
    // version for it would fill the history panel with entries that read as
    // identical to the one above them.
    const rejected =
      changes.content === undefined
        ? null
        : await takeSnapshot(
            {
              id,
              projectId: outcome.row.projectId,
              title: changes.title ?? outcome.row.title,
              content: changes.content,
            },
            // `manual`, deliberately, and not a new reason: `manual` is the one
            // the app already files rescued-but-unsaved text under (see the
            // recovery-conflict path in WritingsView), it is never deduplicated
            // — which matters, because this text must survive even when it is
            // identical to a version already on file — and it renders with a
            // label the history panel already has.
            'manual',
          );
    throw new WritingConflictError(outcome.row, outcome.expected, rejected);
  }

  return outcome.version;
}

export type ProtectedWritingReplacement =
  | {
      status: 'applied';
      version: number;
      snapshot: SnapshotWriteOutcome;
      changes: Partial<Writing>;
    }
  | {
      status: 'conflict';
      expectedVersion: number;
      current: Writing;
      rejectedSnapshotId: string | null;
    }
  | { status: 'gone'; writingId: string };

/**
 * Replace a writing only if it is still the version a slow external operation
 * started from, and make the restore point part of the same IndexedDB commit.
 *
 * This is intentionally separate from the editor's ordinary compare-and-swap:
 * that path protects the losing in-memory text after a conflict, whereas this
 * one protects the CURRENT row before a wholesale remote/import replacement.
 * A quota or snapshot failure throws and aborts the transaction, so the live
 * chapter cannot move unless its recovery row landed too.
 */
export async function replaceWritingWithSnapshot(
  id: string,
  changes: Partial<Writing>,
  expectedVersion: number,
): Promise<ProtectedWritingReplacement> {
  type TransactionOutcome =
    | { kind: 'applied'; version: number; snapshot: SnapshotWriteOutcome; projectId: string }
    | { kind: 'conflict'; current: Writing }
    | { kind: 'gone' };

  const outcome = await db.transaction(
    'rw',
    [db.writings, db.writingSnapshots],
    async (): Promise<TransactionOutcome> => {
      const current = await db.writings.get(id);
      if (!current) return { kind: 'gone' };
      if (current.updatedAt !== expectedVersion) return { kind: 'conflict', current };

      const snapshot = await ensureSnapshot(current, 'auto');
      const version = nextWritingVersion(current.updatedAt);
      const written = await db.writings.update(id, { ...changes, updatedAt: version });
      if (written === 0) throw new WritingGoneError(id);
      return { kind: 'applied', version, snapshot, projectId: current.projectId };
    },
  );

  if (outcome.kind === 'gone') return { status: 'gone', writingId: id };
  if (outcome.kind === 'conflict') {
    let rejectedSnapshotId: string | null = null;
    if (changes.content !== undefined) {
      const preserved = await ensureSnapshot({
        id,
        projectId: outcome.current.projectId,
        title: changes.title ?? outcome.current.title,
        content: changes.content,
      }, 'manual');
      rejectedSnapshotId = preserved.status === 'skipped-empty' ? null : preserved.snapshotId;
    }
    return {
      status: 'conflict',
      expectedVersion,
      current: outcome.current,
      rejectedSnapshotId,
    };
  }

  void touchProject(outcome.projectId);
  notifyDataChanged({
    source: 'other',
    table: 'writings',
    entityId: id,
    projectId: outcome.projectId,
  });
  return {
    status: 'applied',
    version: outcome.version,
    snapshot: outcome.snapshot,
    changes: { ...changes, updatedAt: outcome.version },
  };
}

/**
 * Everything one `deleteWriting` took away, in the shape `restoreDeletedWriting`
 * puts back. The version history is the part that matters: the app never prunes
 * `writingSnapshots`, so a chapter's whole past used to end with the row.
 */
export interface DeletedWritingBundle {
  writing: Writing;
  /** The chapter's entire version history, oldest to newest as stored. */
  snapshots: WritingSnapshot[];
  /** Margin notes anchored on the writing. */
  annotations: Annotation[];
  /** Reference rows hanging off those annotations. */
  annotationReferences: AnnotationReference[];
  /** Beats whose `linkedWritingId` pointed here and was cleared, not deleted. */
  unlinkedBeatIds: string[];
  deletedAt: number;
}

/**
 * The one bundle a deletion may leave behind, and the writing it belongs to.
 *
 * The UI cannot read `deleteWritingRestorable`'s return value: the writings
 * list deletes through `makeEntityHook`, whose `deleteFn` is typed
 * `(id) => Promise<void>` and drops whatever the operation returns. So the view
 * names the delete it is about to offer an Undo for (`expectDeletedWriting`)
 * and collects that same id's bundle once its own delete resolves.
 *
 * Two things follow from arming the slot by id instead of parking every
 * deletion in it:
 *   • a delete nobody armed — the AI bridge's DELETABLE registry, which has no
 *     Undo bar to feed — parks nothing, so a copilot delete stops pinning a
 *     chapter's whole text and every snapshot ever taken of it in the heap;
 *   • a delete that lands between the writer's own delete and its collection
 *     can never be handed back in its place: the Undo bar is offered the id it
 *     asked for, or nothing.
 */
let expectedId: string | null = null;
let parked: { id: string; bundle: DeletedWritingBundle } | null = null;
let parkedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long an armed bundle waits to be collected. Comfortably longer than the
 * delete that armed it needs to finish its own list refresh, and short enough
 * that one nobody comes back for — a view unmounted mid-delete — is released
 * instead of held for the rest of the session.
 */
const UNCLAIMED_BUNDLE_MS = 30_000;

function releaseBundle(): void {
  parked = null;
  if (parkedTimer !== null) {
    clearTimeout(parkedTimer);
    parkedTimer = null;
  }
}

/**
 * Say which delete is about to be made undoable. Only that id's bundle is kept
 * — every other deletion goes straight to the garbage collector — and only
 * until it is taken or `UNCLAIMED_BUNDLE_MS` passes.
 */
export function expectDeletedWriting(id: string): void {
  releaseBundle();
  expectedId = id;
}

/**
 * Hand over the bundle for `id` and forget it, so a second caller (or a second
 * render) cannot resurrect a writing the user already restored. Null when the
 * slot holds nothing, or another writing's deletion.
 */
export function takeLastDeletedWriting(id: string): DeletedWritingBundle | null {
  if (!parked || parked.id !== id) return null;
  const { bundle } = parked;
  releaseBundle();
  return bundle;
}

/**
 * Delete a writing, its version history and its margin notes, and UNLINK the
 * outline beats that pointed at it — then hand back every row that went, so the
 * act can be taken back.
 *
 * Same policy as `deleteScene`: what only exists inside the writing goes with
 * it — snapshots, and the annotations anchored on it with their reference
 * rows — while a beat is the author's own text and survives unassigned, ready
 * to be relinked.
 *
 * Everything is READ inside the same transaction that deletes it, so the bundle
 * is exactly what was removed, not what was there a moment earlier. Returns
 * `null` when there was no such writing — nothing was deleted, so there is
 * nothing to offer back.
 */
export async function deleteWritingRestorable(id: string): Promise<DeletedWritingBundle | null> {
  const bundle = await db.transaction(
    'rw',
    [db.writings, db.writingSnapshots, db.outlineBeats, db.annotations, db.annotationReferences],
    async (): Promise<DeletedWritingBundle | null> => {
      const writing = await db.writings.get(id);
      if (!writing) return null;

      const snapshots = await db.writingSnapshots.where('writingId').equals(id).toArray();
      const annotations = await db.annotations
        .where('[sourceEngineId+sourceEntityId]')
        .equals(['writings', id])
        .toArray();
      const annotationReferences = annotations.length
        ? await db.annotationReferences
            .where('annotationId')
            .anyOf(annotations.map(annotation => annotation.id))
            .toArray()
        : [];

      const beatQuery = writing.projectId
        ? db.outlineBeats.where('projectId').equals(writing.projectId)
        : db.outlineBeats.toCollection();
      const linked = (await beatQuery.toArray()).filter(beat => beat.linkedWritingId === id);

      await db.writingSnapshots.where('writingId').equals(id).delete();

      for (const beat of linked) {
        await db.outlineBeats.update(beat.id, { linkedWritingId: undefined });
      }

      await deleteEntityAnnotations('writings', id);

      await db.writings.delete(id);

      return {
        writing,
        snapshots,
        annotations,
        annotationReferences,
        unlinkedBeatIds: linked.map(beat => beat.id),
        deletedAt: Date.now(),
      };
    },
  );

  // Kept only for the delete that armed the slot for this id; every other
  // deletion — the AI bridge's included — is free the moment this returns.
  if (expectedId === id) {
    expectedId = null;
    if (bundle) {
      releaseBundle();
      parked = { id, bundle };
      parkedTimer = setTimeout(releaseBundle, UNCLAIMED_BUNDLE_MS);
    }
  }
  if (bundle?.writing.projectId) void touchProject(bundle.writing.projectId);
  return bundle;
}

/**
 * `Promise<void>` face of `deleteWritingRestorable`, kept because both of its
 * callers demand that exact signature and neither is this engine's to retype:
 * `makeEntityHook`'s `deleteFn` and the AI bridge's `DELETABLE` registry. The
 * bundle reaches the UI through `takeLastDeletedWriting(id)`, and only for a
 * delete the UI armed with `expectDeletedWriting(id)` first.
 */
export async function deleteWriting(id: string): Promise<void> {
  await deleteWritingRestorable(id);
}

/**
 * Put a deleted writing back — row, version history, margin notes, reference
 * rows, and the outline beats that pointed at it.
 *
 * Idempotent by construction: every row goes back with `put`/`bulkPut`, so
 * restoring twice writes the same rows twice and changes nothing. A beat is
 * relinked only while it is still unassigned, so an undo can never steal a beat
 * the writer has since pointed at another chapter.
 */
export async function restoreDeletedWriting(bundle: DeletedWritingBundle): Promise<void> {
  await db.transaction(
    'rw',
    [db.writings, db.writingSnapshots, db.outlineBeats, db.annotations, db.annotationReferences],
    async () => {
      await db.writings.put(bundle.writing);
      if (bundle.snapshots.length) await db.writingSnapshots.bulkPut(bundle.snapshots);
      if (bundle.annotations.length) await db.annotations.bulkPut(bundle.annotations);
      if (bundle.annotationReferences.length) {
        await db.annotationReferences.bulkPut(bundle.annotationReferences);
      }
      for (const beatId of bundle.unlinkedBeatIds) {
        const beat = await db.outlineBeats.get(beatId);
        if (beat && !beat.linkedWritingId) {
          await db.outlineBeats.update(beatId, { linkedWritingId: bundle.writing.id });
        }
      }
    },
  );

  // The restore happened outside every list hook's own write path, so tell the
  // mounted lists (writings, outline, annotations) that their tables moved.
  notifyDataChanged({
    source: 'undo',
    table: 'writings',
    entityId: bundle.writing.id,
    projectId: bundle.writing.projectId,
  });
}
