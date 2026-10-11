// ============================================================================
// Beta reading — the Dexie side: packages out, responses in
// ============================================================================
//
// Every function takes the project explicitly. Nothing here reads the open
// project, writes outside the three beta tables, or touches a chapter: a
// comment is data ABOUT a Writing, and the Writing is never changed by it.

import { db } from '@/db';
import { compareManuscriptOrder } from '@/engines/writings/chapterOrder';
import { sanitizeFilename } from '@/engines/writings/manuscriptExport';
import { selectChapterExport } from '@/engines/writings/chapterExport';
import { useLocaleStore } from '@/stores/localeStore';
import { generateId } from '@/utils/idGenerator';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import type { Writing } from '@/types';
import {
  chapterChange, chapterTextFromHtml, countAnchorStates, evaluateComment, planImport,
  type ChapterChange, type ChapterText,
} from './core';
import { buildBetaPackage, scrubChapterHtml } from './package';
import { parseResponse } from './response';
import type { BetaCommentRow, BetaPackageRow, BetaResponseRow, BetaStatus } from './types';

export class BetaReadingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BetaReadingError';
    this.code = code;
  }
}

/** How a chapter reads today, in the same terms its package was built in. */
export function currentChapterText(writing: Pick<Writing, 'content'>): ChapterText {
  return chapterTextFromHtml(scrubChapterHtml(sanitizeRichHtml(writing.content ?? '')));
}

async function chaptersOf(projectId: string): Promise<Map<string, ChapterText>> {
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  return new Map(writings.map(writing => [writing.id, currentChapterText(writing)]));
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export interface CreatedPackage {
  row: BetaPackageRow;
  html: string;
  filename: string;
  /** Pieces that were asked for but are not in the project. */
  missingIds: string[];
  /** Chosen pieces with no prose in them (included anyway). */
  emptyTitles: string[];
}

export function packageFilename(projectTitle: string, version: number): string {
  return `${sanitizeFilename(projectTitle)} - beta v${version}.html`;
}

/** Render a stored package again, byte for byte what was first sent. */
export function renderStoredPackage(row: BetaPackageRow, projectTitle?: string): { html: string; filename: string } {
  const built = buildBetaPackage({
    packageId: row.id, version: row.version, projectId: row.projectId,
    projectTitle: projectTitle ?? row.title, createdAt: row.createdAt, locale: row.locale,
    chapters: row.chapters.map(chapter => ({ writingId: chapter.chapterId, title: chapter.title, html: chapter.html })),
  });
  return { html: built.html, filename: packageFilename(row.title, row.version) };
}

/** Compile the chosen chapters into a package and remember it. The version is the next free one for the project. */
export async function createPackage(projectId: string, writingIds: readonly string[]): Promise<CreatedPackage> {
  const project = await db.projects.get(projectId);
  if (!project) throw new BetaReadingError('no-project', `Project ${projectId} does not exist.`);
  const all = await db.writings.where('projectId').equals(projectId).toArray();
  const selection = selectChapterExport(all, writingIds);
  if (!selection.writings.length) throw new BetaReadingError('no-chapters', 'None of the chosen chapters exist in this project.');
  if (selection.googleDocsWithoutContent.length) {
    throw new BetaReadingError('google-docs-without-content', 'A linked Google Doc has no local copy, so its package page would be empty.');
  }
  const existing = await db.betaPackages.where('projectId').equals(projectId).toArray();
  const version = existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  const now = Date.now();
  const built = buildBetaPackage({
    packageId: generateId('beta'), version, projectId, projectTitle: project.title, createdAt: now,
    locale: useLocaleStore.getState().locale,
    chapters: [...selection.writings].sort(compareManuscriptOrder).map(writing => ({
      writingId: writing.id,
      title: writing.title,
      html: sanitizeRichHtml(writing.content ?? ''),
    })),
  });
  const row: BetaPackageRow = {
    id: built.manifest.packageId, projectId, version, title: project.title,
    locale: built.manifest.locale, createdAt: now, chapters: built.chapters,
  };
  await db.betaPackages.add(row);
  return {
    row, html: built.html, filename: packageFilename(project.title, version),
    missingIds: selection.missingIds,
    emptyTitles: selection.emptyWritings.map(writing => writing.title),
  };
}

/**
 * Write the package file under the app's exports folder. Only the desktop shell
 * can; elsewhere the caller downloads it instead and `filePath` stays null.
 */
export async function writePackageFile(html: string, filename: string): Promise<string | null> {
  const writer = typeof window !== 'undefined' ? window.electronAPI?.exporter?.writeBetaPackage : undefined;
  if (!writer) return null;
  const result = await writer(html, filename);
  return result.ok && result.filePath ? result.filePath : null;
}

export async function recordPackagePath(packageId: string, filePath: string): Promise<void> {
  await db.betaPackages.update(packageId, { filePath });
}

// ---------------------------------------------------------------------------
// Re-anchoring
// ---------------------------------------------------------------------------

/**
 * Re-evaluate every comment whose chapter changed since it was last judged.
 * Cheap when nothing changed (one hash compare per chapter that has comments).
 * Returns how many comments changed state.
 */
export async function refreshAnchors(projectId: string): Promise<number> {
  const rows = await db.betaComments.where('projectId').equals(projectId).toArray();
  if (!rows.length) return 0;
  const writingIds = [...new Set(rows.map(row => row.writingId))];
  const writings = await db.writings.bulkGet(writingIds);
  const texts = new Map<string, ChapterText | null>();
  writingIds.forEach((id, index) => {
    const writing = writings[index];
    texts.set(id, writing && writing.projectId === projectId ? currentChapterText(writing) : null);
  });
  const updates: BetaCommentRow[] = [];
  const now = Date.now();
  for (const row of rows) {
    const chapter = texts.get(row.writingId) ?? null;
    const wanted = chapter ? chapter.hash : 'missing';
    if (row.evaluatedHash === wanted) continue;
    updates.push({ ...row, ...evaluateComment(row.anchor, chapter), updatedAt: now });
  }
  if (updates.length) await db.betaComments.bulkPut(updates);
  return updates.length;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportReport {
  responseId: string;
  reader: string;
  packageId: string;
  packageVersion: number;
  /** The package row is in this project's database (its snapshot can be diffed). */
  packageKnown: boolean;
  /** Comments in the file that were usable. */
  comments: number;
  /** Of those, new to the project. */
  imported: number;
  /** Of those, already there — importing the same file again lands here. */
  duplicates: number;
  /** Comments in the file that could not be used. */
  dropped: number;
  /** State of the file's comments against the chapters as they are NOW (new and old alike). */
  attached: number;
  moved: number;
  orphaned: number;
  /** Comments whose chapter is not in this project at all. */
  unknownChapters: string[];
  /** Chapters the reader saw that have changed since. */
  changedChapters: string[];
  /** Ids of the rows this call added (for undo; not shown to a model). */
  newCommentIds: string[];
}

/** Store a reader's response. Idempotent: the same file, or a later file from the same reader, adds only what is new. */
export async function importResponse(projectId: string, input: string | unknown): Promise<ImportReport> {
  const { response, dropped } = parseResponse(input);
  const chapters = await chaptersOf(projectId);
  const known = await db.betaPackages.get(response.packageId);
  const packageKnown = Boolean(known && known.projectId === projectId);
  const now = Date.now();

  const unknownChapters: string[] = [];
  const existingRows = await db.betaComments.where('projectId').equals(projectId).primaryKeys();
  const plan = planImport(projectId, response, new Set(existingRows as string[]), chapters, now);

  const chapterHashes: Record<string, string> = {};
  for (const item of response.chapters) chapterHashes[item.chapterId] = item.contentHash;
  const previous = await db.betaResponses.get(plan.responseId);
  const newerFile = !previous || Date.parse(response.exportedAt) >= previous.exportedAt;
  const responseRow: BetaResponseRow = {
    id: plan.responseId, projectId,
    packageId: response.packageId, packageVersion: response.packageVersion, reader: response.reader,
    exportedAt: newerFile ? Date.parse(response.exportedAt) || 0 : previous.exportedAt,
    importedAt: previous?.importedAt ?? now,
    reactions: newerFile ? response.reactions : previous.reactions,
    chapterHashes: newerFile ? chapterHashes : previous.chapterHashes,
  };

  await db.transaction('rw', db.betaResponses, db.betaComments, async () => {
    await db.betaResponses.put(responseRow);
    if (plan.fresh.length) await db.betaComments.bulkAdd(plan.fresh);
  });
  // Comments already stored may be about a chapter that has changed since they were judged.
  await refreshAnchors(projectId);

  const stored = (await db.betaComments.bulkGet(plan.allIds)).filter((row): row is BetaCommentRow => Boolean(row));
  for (const row of stored) if (!chapters.has(row.writingId) && !unknownChapters.includes(row.writingId)) unknownChapters.push(row.writingId);
  const states = countAnchorStates(stored);

  const changedChapters: string[] = [];
  for (const item of response.chapters) {
    const current = chapters.get(item.chapterId);
    if (current && item.contentHash && current.hash !== item.contentHash) changedChapters.push(item.chapterId);
  }

  return {
    responseId: plan.responseId, reader: response.reader,
    packageId: response.packageId, packageVersion: response.packageVersion, packageKnown,
    comments: response.comments.length, imported: plan.fresh.length, duplicates: plan.duplicateIds.length, dropped,
    attached: states.attached, moved: states.moved, orphaned: states.orphaned,
    unknownChapters, changedChapters, newCommentIds: plan.fresh.map(row => row.id),
  };
}

// ---------------------------------------------------------------------------
// Reading and editing comments
// ---------------------------------------------------------------------------

export interface CommentFilter {
  writingId?: string;
  status?: BetaStatus;
  packageId?: string;
  reader?: string;
}

/** The project's comments, re-anchored first, oldest first within a chapter. */
export async function listComments(projectId: string, filter: CommentFilter = {}): Promise<BetaCommentRow[]> {
  await refreshAnchors(projectId);
  const rows = await db.betaComments.where('projectId').equals(projectId).toArray();
  return rows
    .filter(row => !filter.writingId || row.writingId === filter.writingId)
    .filter(row => !filter.packageId || row.packageId === filter.packageId)
    .filter(row => !filter.reader || row.reader === filter.reader)
    .filter(row => {
      if (!filter.status) return true;
      return filter.status === 'resolved' ? row.resolved : !row.resolved && row.anchorState === filter.status;
    })
    .sort((a, b) => (a.writingId === b.writingId ? a.createdAt - b.createdAt : a.writingId.localeCompare(b.writingId)));
}

/** Resolve or reopen. Reopening puts back the anchor state the chapter gives it today. */
export async function setCommentResolved(commentId: string, resolved: boolean): Promise<BetaCommentRow> {
  const row = await db.betaComments.get(commentId);
  if (!row) throw new BetaReadingError('not-found', `No beta comment ${commentId}.`);
  const next: BetaCommentRow = {
    ...row, resolved, updatedAt: Date.now(),
    resolvedAt: resolved ? Date.now() : undefined,
  };
  await db.betaComments.put(next);
  return next;
}

export async function deleteComment(commentId: string): Promise<BetaCommentRow | undefined> {
  const row = await db.betaComments.get(commentId);
  if (row) await db.betaComments.delete(commentId);
  return row;
}

/** Put a deleted comment back (the undo of deleteComment). */
export async function restoreComment(row: BetaCommentRow): Promise<void> {
  await db.betaComments.put(row);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface PackageChapterStatus {
  packageId: string;
  version: number;
  chapterId: string;
  title: string;
  exists: boolean;
  change: ChapterChange;
}

/** For every chapter of every package: has it changed since the package left? */
export async function packageChapterStatus(projectId: string): Promise<PackageChapterStatus[]> {
  const [packages, chapters] = await Promise.all([
    db.betaPackages.where('projectId').equals(projectId).toArray(),
    chaptersOf(projectId),
  ]);
  const out: PackageChapterStatus[] = [];
  for (const pack of packages.sort((a, b) => b.version - a.version)) {
    for (const chapter of pack.chapters) {
      const current = chapters.get(chapter.chapterId) ?? null;
      out.push({
        packageId: pack.id, version: pack.version, chapterId: chapter.chapterId, title: chapter.title,
        exists: Boolean(current), change: chapterChange(chapter.contentHash, chapter.text, current),
      });
    }
  }
  return out;
}
