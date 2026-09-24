// ============================================================================
// AI bridge tools — the manuscript
// ============================================================================
//
// Every path that can lose text takes a 'pre-ai' snapshot first, so anything
// an external model does here is undoable from the app's history panel.

import { db } from '@/db';
import type { Writing, WritingStatus } from '@/types';
import {
  createWriting,
  getWriting,
  getWritings,
  updateWriting,
  WritingConflictError,
} from '@/engines/writings/operations';
import { listSnapshotMeta, restoreSnapshot, takeSnapshot } from '@/engines/writings/snapshots';
import { extractFootnotesFromHtml } from '@/components/editor/footnotes/footnoteModel';
import { countWords } from '@/utils/text';
import { generateId } from '@/utils/idGenerator';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { markdownToTiptapHtml, tiptapHtmlToMarkdown } from '../markdown';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const STATUSES = ['idea', 'draft', 'finished'] as const satisfies readonly WritingStatus[];

/**
 * The manuscript's own Markdown door, footnotes included.
 *
 * `shared.ts` has `htmlFromMarkdown`/`markdownFromHtml` for every other body
 * in the app, and those deliberately leave `[^1]` as text: only the manuscript
 * editor loads the footnote node, so a `<sup data-footnote>` written into a
 * codex entry would be parsed away with its note. Here the node exists, and
 * a note the writer took must reach the model and come back as a note — the
 * same sanitizer gate on the way in, the same converter, one option more.
 */
function manuscriptHtmlFromMarkdown(markdown: string, reservedFootnoteIds?: readonly string[]): string {
  return sanitizeRichHtml(markdownToTiptapHtml(markdown, { footnotes: true, reservedFootnoteIds }));
}

function manuscriptMarkdownFromHtml(html: string | undefined): string {
  return html ? tiptapHtmlToMarkdown(html, { footnotes: true }) : '';
}

async function mustGetWriting(id: string): Promise<Writing> {
  const writing = await getWriting(id);
  if (!writing) throw new BridgeError('not-found', `No writing with id "${id}".`);
  return writing;
}

/**
 * Write the model's change ONLY onto the row the model was shown.
 *
 * Both handlers below read the chapter, then spend several awaits composing the
 * write — a snapshot, a Markdown conversion, and in the append case the whole
 * existing body concatenated to the addition. The writer's editor is flushing
 * its own in-memory copy of that same chapter every 1.2 seconds throughout. So
 * `existing` is a photograph, and writing it back without checking is how a
 * paragraph the writer typed while the model was thinking disappears without a
 * trace.
 *
 * `updateWriting` refuses that write when the row has moved, and files the text
 * it refused as a version first. What is left to do here is tell the model, in
 * terms it can act on: nothing was lost, read the chapter again, and decide.
 * `conflict` is a code, not a crash, so the run continues.
 */
async function writeToUnmovedRow(
  existing: Writing,
  changes: Partial<Writing>,
): Promise<void> {
  try {
    await updateWriting(existing.id, changes, existing.updatedAt);
  } catch (err) {
    if (!(err instanceof WritingConflictError)) throw err;
    throw new BridgeError(
      'conflict',
      `"${existing.title}" was changed by someone else while this call was being prepared, ` +
      'so it was NOT overwritten. Nothing is lost: the text this call would have written ' +
      'is saved in the chapter\'s version history' +
      (err.rejectedSnapshotId ? ` as snapshot "${err.rejectedSnapshotId}"` : '') +
      '. Read the chapter again with wh_get_writing before deciding what to do.',
    );
  }
}

export async function whListWritings(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const status = optEnum(args, 'status', STATUSES);
  const writings = await getWritings(projectId);
  const filtered = status ? writings.filter((w) => w.status === status) : writings;
  return {
    projectId,
    writings: filtered.map((w) => ({
      id: w.id,
      title: w.title,
      status: w.status,
      chapter: w.chapter,
      synopsis: w.synopsis,
      wordCount: w.wordCount,
      tags: w.tags,
      isGoogleDoc: w.isGoogleDoc === true,
      updatedAt: w.updatedAt,
    })),
  };
}

export async function whGetWriting(args: ToolArgs): Promise<unknown> {
  const writing = await mustGetWriting(requireString(args, 'id'));
  assertRowInScope(args, writing.projectId);
  return {
    id: writing.id,
    projectId: writing.projectId,
    title: writing.title,
    status: writing.status,
    chapter: writing.chapter,
    synopsis: writing.synopsis,
    tags: writing.tags,
    wordCount: writing.wordCount,
    updatedAt: writing.updatedAt,
    content: manuscriptMarkdownFromHtml(writing.content),
  };
}

export async function whCreateWriting(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'writings');
  const title = requireString(args, 'title');
  const markdown = optString(args, 'content') ?? '';
  const html = markdown ? manuscriptHtmlFromMarkdown(markdown) : '';
  const now = Date.now();
  const writing: Writing = {
    id: generateId('writing'),
    projectId,
    title,
    status: optEnum(args, 'status', STATUSES) ?? 'draft',
    content: html,
    synopsis: optString(args, 'synopsis'),
    wordCount: countWords(html),
    chapter: optNumber(args, 'chapter'),
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createWriting(writing);
  return withAudit(
    { id: writing.id, title: writing.title, wordCount: writing.wordCount, created: true },
    { projectId, entityId: writing.id, summary: `created writing "${title}"` },
  );
}

export async function whUpdateWriting(args: ToolArgs): Promise<unknown> {
  const existing = await mustGetWriting(requireString(args, 'id'));
  await assertEngineEnabled(existing.projectId, 'writings');
  assertRowInScope(args, existing.projectId);
  const markdown = optString(args, 'content');
  const changes: Partial<Writing> = {};

  if (markdown !== undefined) {
    // Overwriting a body is the one destructive act left in this surface.
    await takeSnapshot(existing, 'pre-ai');
    changes.content = manuscriptHtmlFromMarkdown(markdown);
    changes.wordCount = countWords(changes.content);
  }
  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const synopsis = optString(args, 'synopsis');
  if (synopsis !== undefined) changes.synopsis = synopsis;
  const status = optEnum(args, 'status', STATUSES);
  if (status !== undefined) changes.status = status;
  const chapter = optNumber(args, 'chapter');
  if (chapter !== undefined) changes.chapter = chapter;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  // Every field this call changes, as it was. Recording only title, status and
  // wordCount made undo of a body rewrite put the OLD word count back on the
  // NEW text and still report the change as reverted — the same lie
  // wh_append_writing was fixed for. Same for synopsis, chapter and tags.
  const before: Record<string, unknown> = {
    title: existing.title,
    status: existing.status,
    wordCount: existing.wordCount,
  };
  for (const key of Object.keys(changes) as Array<keyof Writing>) {
    before[key] = key === 'content' ? existing.content ?? '' : existing[key];
  }
  await writeToUnmovedRow(existing, changes);
  return withAudit(
    { id: existing.id, updated: Object.keys(changes), wordCount: changes.wordCount ?? existing.wordCount },
    {
      projectId: existing.projectId,
      entityId: existing.id,
      summary: `updated writing "${existing.title}" (${Object.keys(changes).join(', ')})`,
      before,
    },
  );
}

export async function whAppendWriting(args: ToolArgs): Promise<unknown> {
  const existing = await mustGetWriting(requireString(args, 'id'));
  await assertEngineEnabled(existing.projectId, 'writings');
  assertRowInScope(args, existing.projectId);
  // Only the addition is converted; the chapter's own bytes — its notes, their
  // ids and their numbering — are appended to, never re-read or renumbered.
  // The ids it already holds are reserved so a `[^1]` in the addition cannot
  // collide with a note an earlier append created under that very label.
  const addition = manuscriptHtmlFromMarkdown(
    requireString(args, 'content'),
    extractFootnotesFromHtml(existing.content ?? '').map((note) => note.id),
  );
  await takeSnapshot(existing, 'pre-ai');
  const content = `${existing.content ?? ''}${addition}`;
  const wordCount = countWords(content);
  await writeToUnmovedRow(existing, { content, wordCount });
  return withAudit(
    { id: existing.id, wordCount, added: wordCount - existing.wordCount },
    {
      projectId: existing.projectId,
      entityId: existing.id,
      summary: `appended to writing "${existing.title}"`,
      // The body as well as the count: recording the count alone made undo a
      // lie — the appended words stayed in the manuscript and the stored
      // wordCount no longer matched them, with nothing to recompute it.
      before: { content: existing.content ?? '', wordCount: existing.wordCount },
    },
  );
}

export async function whListWritingVersions(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  // Load the writing first: the snapshot list itself carries no projectId to
  // check, and the id alone would page through another project's history.
  const writing = await mustGetWriting(id);
  assertRowInScope(args, writing.projectId);
  const snapshots = await listSnapshotMeta(id);
  return {
    writingId: id,
    versions: snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      title: snapshot.title,
      wordCount: snapshot.wordCount,
      reason: snapshot.reason,
      createdAt: snapshot.createdAt,
    })),
  };
}

export async function whRestoreWritingVersion(args: ToolArgs): Promise<unknown> {
  const snapshotId = requireString(args, 'snapshotId');
  // The snapshot is read BEFORE restoring, not after: `restoreSnapshot` does
  // the whole job in one call and answers with prose only, so by the time it
  // returns there is nothing left to check the engine against — and the write
  // would already have happened.
  const snapshot = await db.writingSnapshots.get(snapshotId);
  if (!snapshot) throw new BridgeError('not-found', `No snapshot with id "${snapshotId}".`);
  await assertEngineEnabled(snapshot.projectId, 'writings');
  assertRowInScope(args, snapshot.projectId);

  const restored = await restoreSnapshot(snapshotId);
  if (!restored) {
    throw new BridgeError('not-found', `No snapshot with id "${snapshotId}", or its writing is gone.`);
  }
  return withAudit(
    { restored: true, writingId: snapshot.writingId, title: restored.title, wordCount: restored.wordCount },
    {
      projectId: snapshot.projectId,
      // The thing that changed is the writing, not the snapshot it came from:
      // an undo has to land on the piece, or it lands on nothing.
      entityId: snapshot.writingId,
      summary: `restored writing "${restored.title}" from a saved version`,
    },
  );
}
