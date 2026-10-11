// ============================================================================
// AI bridge tools — beta reading
// ============================================================================
//
// wh_beta_package_create · wh_beta_import · wh_beta_comments ·
// wh_beta_comment_set_status
//
// The work is in services/betaReading, shared with the Beta reading panel;
// these handlers resolve the project, pin the caller's scope and shape the
// answer. Arguments are camelCase; the snake_case spelling is accepted too.

import { db } from '@/db';
import {
  BetaReadingError, createPackage, importResponse, listComments, packageChapterStatus,
  recordPackagePath, setCommentResolved, writePackageFile,
} from '@/services/betaReading/store';
import { BetaFormatError } from '@/services/betaReading/response';
import { statusOf } from '@/services/betaReading/types';
import { countStatuses } from '@/services/betaReading/core';
import {
  assertEngineEnabled, assertRowInScope, BridgeError, optEnum, optString, optStringArray, requireString,
  resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs,
} from './shared';

const ENGINE = 'beta-reading';
const KEYS = ['projectId', 'writingIds', 'writingId', 'commentId'] as const;

function normalized(args: ToolArgs): ToolArgs {
  const out: ToolArgs = { ...args };
  for (const key of KEYS) {
    const snake = key.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`);
    if (out[key] === undefined && out[snake] !== undefined) out[key] = out[snake];
    delete out[snake];
  }
  return out;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BetaReadingError) throw new BridgeError(error.code === 'not-found' ? 'not-found' : 'bad-args', error.message);
    if (error instanceof BetaFormatError) throw new BridgeError('bad-args', error.message);
    throw error;
  }
}

export async function whBetaPackageCreate(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = await resolveProjectForEngine(args, ENGINE);
  const ids = optStringArray(args, 'writingIds') ?? [];
  if (!ids.length) throw new BridgeError('bad-args', '"writingIds" must list at least one chapter id.');
  for (const id of ids) {
    const row = await db.writings.get(id);
    if (row) assertRowInScope(args, row.projectId);
  }
  const made = await guarded(() => createPackage(projectId, ids));
  let filePath: string | null = null;
  try {
    filePath = await writePackageFile(made.html, made.filename);
    if (filePath) await recordPackagePath(made.row.id, filePath);
  } catch {
    filePath = null;
  }
  return withAudit(
    {
      created: true,
      packageId: made.row.id,
      version: made.row.version,
      filename: made.filename,
      filePath,
      htmlBytes: made.html.length,
      chapters: made.row.chapters.map(chapter => ({
        id: chapter.chapterId, title: chapter.title, words: chapter.wordCount, contentHash: chapter.contentHash,
      })),
      missingIds: made.missingIds,
      emptyChapters: made.emptyTitles,
      note: filePath
        ? 'The package is one HTML file: send it to a reader; they send back the JSON their page downloads (wh_beta_import).'
        : 'The package was recorded but this build cannot write files; open the Beta reading panel to download it.',
    },
    { projectId, entityId: made.row.id, table: 'betaPackages', kind: 'create', summary: `built beta package v${made.row.version} of ${made.row.chapters.length} chapter(s)` },
  );
}

export async function whBetaImport(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = await resolveProjectForEngine(args, ENGINE);
  const json = requireString(args, 'json');
  const { newCommentIds, ...report } = await guarded(() => importResponse(projectId, json));
  const result = { ...report, note: report.imported ? undefined : 'Nothing new: every comment in this file was already imported.' };
  if (!newCommentIds.length) return result;
  // Undo removes the comments this call added (the reader's response row stays; it holds only reactions).
  return withAudit(result, {
    projectId, entityId: newCommentIds[0], entityIds: newCommentIds, table: 'betaComments', kind: 'create',
    summary: `imported ${report.imported} beta comment(s) from ${report.reader}`,
  });
}

export async function whBetaComments(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = resolveProjectId(args);
  const writingId = optString(args, 'writingId');
  const status = optEnum(args, 'status', ['attached', 'moved', 'orphaned', 'resolved'] as const);
  if (args.status !== undefined && !status) throw new BridgeError('bad-args', '"status" must be attached, moved, orphaned or resolved.');
  const [rows, all, chapters] = await Promise.all([
    listComments(projectId, { writingId, status }),
    listComments(projectId, {}),
    packageChapterStatus(projectId),
  ]);
  const titles = new Map<string, string>();
  for (const writing of await db.writings.where('projectId').equals(projectId).toArray()) titles.set(writing.id, writing.title);
  const changed = new Set(chapters.filter(item => item.change.changed).map(item => `${item.packageId}:${item.chapterId}`));
  return {
    count: rows.length,
    totals: countStatuses(all),
    comments: rows.map(row => ({
      id: row.id,
      status: statusOf(row),
      reader: row.reader,
      packageVersion: row.packageVersion,
      writingId: row.writingId,
      chapter: titles.get(row.writingId) ?? null,
      quote: row.anchor.quote,
      text: row.text,
      paragraphNow: row.matchParagraph,
      paragraphThen: row.anchor.paragraph,
      chapterChangedSincePackage: changed.has(`${row.packageId}:${row.writingId}`),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    })),
  };
}

export async function whBetaCommentSetStatus(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const commentId = requireString(args, 'commentId');
  const wanted = requireString(args, 'status');
  if (!['resolved', 'open', 'reopen', 'attached', 'moved', 'orphaned'].includes(wanted)) {
    throw new BridgeError('bad-args', '"status" must be "resolved" or "open".');
  }
  const before = await db.betaComments.get(commentId);
  if (!before) throw new BridgeError('not-found', `No beta comment ${commentId}.`);
  assertRowInScope(args, before.projectId);
  await assertEngineEnabled(before.projectId, ENGINE);
  const resolved = wanted === 'resolved';
  const row = await guarded(() => setCommentResolved(commentId, resolved));
  const result = { id: row.id, status: statusOf(row), changed: before.resolved !== resolved };
  if (!result.changed) return result;
  return withAudit(result, {
    projectId: row.projectId, entityId: row.id, table: 'betaComments', kind: 'update',
    summary: `${resolved ? 'resolved' : 'reopened'} a beta comment by ${row.reader}`,
    before: { resolved: before.resolved, resolvedAt: before.resolvedAt, __absent: before.resolvedAt === undefined ? ['resolvedAt'] : undefined },
  });
}
