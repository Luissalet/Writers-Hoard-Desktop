// ============================================================================
// AI bridge tools — the manuscript
// ============================================================================
//
// Every path that can lose text takes a 'pre-ai' snapshot first, so anything
// an external model does here is undoable from the app's history panel.

import type { Writing, WritingStatus } from '@/types';
import {
  createWriting,
  getWriting,
  getWritings,
  updateWriting,
} from '@/engines/writings/operations';
import { listSnapshots, restoreSnapshot, takeSnapshot } from '@/engines/writings/snapshots';
import { countWords } from '@/utils/text';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  htmlFromMarkdown,
  markdownFromHtml,
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

async function mustGetWriting(id: string): Promise<Writing> {
  const writing = await getWriting(id);
  if (!writing) throw new BridgeError('not-found', `No writing with id "${id}".`);
  return writing;
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
    content: markdownFromHtml(writing.content),
  };
}

export async function whCreateWriting(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'writings');
  const title = requireString(args, 'title');
  const markdown = optString(args, 'content') ?? '';
  const html = markdown ? htmlFromMarkdown(markdown) : '';
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
  const markdown = optString(args, 'content');
  const changes: Partial<Writing> = {};

  if (markdown !== undefined) {
    // Overwriting a body is the one destructive act left in this surface.
    await takeSnapshot(existing, 'pre-ai');
    changes.content = htmlFromMarkdown(markdown);
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
  await updateWriting(existing.id, changes);
  return withAudit(
    { id: existing.id, updated: Object.keys(changes), wordCount: changes.wordCount ?? existing.wordCount },
    {
      projectId: existing.projectId,
      entityId: existing.id,
      summary: `updated writing "${existing.title}" (${Object.keys(changes).join(', ')})`,
      before: { title: existing.title, status: existing.status, wordCount: existing.wordCount },
    },
  );
}

export async function whAppendWriting(args: ToolArgs): Promise<unknown> {
  const existing = await mustGetWriting(requireString(args, 'id'));
  const addition = htmlFromMarkdown(requireString(args, 'content'));
  await takeSnapshot(existing, 'pre-ai');
  const content = `${existing.content ?? ''}${addition}`;
  const wordCount = countWords(content);
  await updateWriting(existing.id, { content, wordCount });
  return withAudit(
    { id: existing.id, wordCount, added: wordCount - existing.wordCount },
    {
      projectId: existing.projectId,
      entityId: existing.id,
      summary: `appended to writing "${existing.title}"`,
      before: { wordCount: existing.wordCount },
    },
  );
}

export async function whListWritingVersions(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const snapshots = await listSnapshots(id);
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
  const restored = await restoreSnapshot(snapshotId);
  if (!restored) {
    throw new BridgeError('not-found', `No snapshot with id "${snapshotId}", or its writing is gone.`);
  }
  return withAudit(
    { restored: true, title: restored.title, wordCount: restored.wordCount },
    { entityId: snapshotId, summary: `restored writing "${restored.title}" from a saved version` },
  );
}
