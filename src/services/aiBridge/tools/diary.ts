// ============================================================================
// AI bridge tools — the writer's diary
// ============================================================================

import type { DiaryEntry, DiaryMood } from '@/engines/diary/types';
import { createEntry, getEntries, getEntry, updateEntry } from '@/engines/diary/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  EMPTY_CONTENT,
  htmlFromMarkdown,
  markdownFromHtml,
  optBoolean,
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

const MOODS = ['great', 'good', 'neutral', 'low', 'bad'] as const satisfies readonly DiaryMood[];

/** Local "YYYY-MM-DDTHH:mm", the shape the diary engine stores and sorts on. */
function localStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * `entryDate` as the diary stores it — local "YYYY-MM-DDTHH:mm" — or a refusal.
 *
 * The editor's datetime-local input, the day grouping (`slice(0, 10)`) and the
 * newest-first sort (a plain string compare) all read that exact shape, so a
 * free-form "yesterday" or "March 3" used to be stored verbatim: an entry the
 * editor cannot show a date for, sorted wherever its first letter falls.
 * Accepted: that shape, a bare date (stored at 00:00), seconds (dropped), a
 * space for the "T", and an ISO stamp with a zone (converted to local time).
 */
function normalizeEntryDate(raw: string): string {
  const text = raw.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(text);
  if (local) {
    const [year, month, day, hour, minute] = local.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
    const date = new Date(year, month - 1, day, hour, minute);
    // Round-trip the parts: 2026-02-30 or 25:00 would silently roll over.
    if (
      date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
      date.getHours() === hour && date.getMinutes() === minute
    ) {
      return localStamp(date);
    }
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return localStamp(date);
  }
  throw new BridgeError(
    'bad-args',
    `"entryDate" must be a local date and time as "YYYY-MM-DDTHH:mm" (or a date as "YYYY-MM-DD"); got "${raw}".`,
  );
}

export async function whListDiary(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const limit = clampLimit(optNumber(args, 'limit'), 30, 200);
  const entries = await getEntries(projectId);
  return {
    projectId,
    entries: entries.slice(0, limit).map((entry) => ({
      id: entry.id,
      entryDate: entry.entryDate,
      title: entry.title,
      mood: entry.mood,
      tags: entry.tags,
      pinned: entry.pinned,
      content: markdownFromHtml(entry.content),
      updatedAt: entry.updatedAt,
    })),
  };
}

export async function whCreateDiaryEntry(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'diary');
  const markdown = requireString(args, 'content');
  const rawDate = optString(args, 'entryDate');
  const now = Date.now();
  const entry: DiaryEntry = {
    id: generateId('diary'),
    projectId,
    entryDate: rawDate?.trim() ? normalizeEntryDate(rawDate) : localStamp(),
    title: optString(args, 'title') ?? '',
    content: htmlFromMarkdown(markdown),
    mood: optEnum(args, 'mood', MOODS),
    tags: optStringArray(args, 'tags') ?? [],
    pinned: optBoolean(args, 'pinned') ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await createEntry(entry);
  return withAudit(
    { id: entry.id, entryDate: entry.entryDate, created: true },
    { projectId, entityId: entry.id, summary: `created diary entry for ${entry.entryDate}` },
  );
}

export async function whUpdateDiaryEntry(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await getEntry(id);
  if (!existing) throw new BridgeError('not-found', `No diary entry with id "${id}".`);
  await assertEngineEnabled(existing.projectId, 'diary');
  assertRowInScope(args, existing.projectId);

  const changes: Partial<DiaryEntry> = {};
  const markdown = optString(args, 'content');
  if (markdown !== undefined) {
    if (!markdown.trim()) throw new BridgeError('bad-args', EMPTY_CONTENT);
    changes.content = htmlFromMarkdown(markdown);
  }
  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const entryDate = optString(args, 'entryDate');
  if (entryDate !== undefined) changes.entryDate = normalizeEntryDate(entryDate);
  const mood = optEnum(args, 'mood', MOODS);
  if (mood !== undefined) changes.mood = mood;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const pinned = optBoolean(args, 'pinned');
  if (pinned !== undefined) changes.pinned = pinned;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const before: Record<string, unknown> = {
    title: existing.title,
    entryDate: existing.entryDate,
    mood: existing.mood,
  };
  // The page is replaced whole, and nothing else keeps a copy of it.
  if (changes.content !== undefined) before.content = existing.content;
  await updateEntry(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated diary entry for ${existing.entryDate}`,
      before,
    },
  );
}
