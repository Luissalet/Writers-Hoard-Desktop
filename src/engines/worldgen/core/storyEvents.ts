import type { WorldEdit } from './edits';

/**
 * Story events on the map: what happens where, and in which chapter.
 *
 * Stored as world edits so they are undoable, era-scoped and travel with the
 * world. A `story` edit is the whole record of one event under its id (a later
 * one replaces an earlier one); `storyRemove` takes it off. They change nothing
 * in the world itself.
 */
export const STORY_TYPES = ['fight', 'find', 'meeting', 'rest', 'change', 'journey', 'camp', 'inn', 'custom'] as const;
export type StoryType = (typeof STORY_TYPES)[number];
export const STORY_STATUSES = ['planned', 'happened'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export const STORY_TITLE_MAX = 120;
export const STORY_NOTE_MAX = 2000;

export interface StoryEvent {
  // x, y: world coordinates in cells (continuous; a cell centre is n + 0.5).
  id: string;
  x: number;
  y: number;
  type: StoryType;
  title: string;
  note?: string;
  /** The chapter in which it happens; absent = not tied to a chapter. */
  chapter?: number;
  status: StoryStatus;
}

/** Colour of each kind of event, for every view. */
export const STORY_COLORS: Record<StoryType, string> = {
  fight: '#b3261e', find: '#c08a1e', meeting: '#2f6db3', rest: '#3d8b5a', change: '#7b3fa0',
  journey: '#8a5a2b', camp: '#5e6b2f', inn: '#a0522d', custom: '#4a4a4a',
};

/** Validate and tidy one record; throws with a readable message. */
export function normalizeStoryEvent(input: unknown): StoryEvent {
  if (!input || typeof input !== 'object') throw new Error('A story event must be an object.');
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 80) throw new Error('id must be a short non-empty string.');
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x) || typeof raw.y !== 'number' || !Number.isFinite(raw.y)) throw new Error('x and y must be numbers (world cells).');
  if (!STORY_TYPES.includes(raw.type as StoryType)) throw new Error(`type must be one of ${STORY_TYPES.join(', ')}.`);
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('title must not be empty.');
  if (raw.note !== undefined && typeof raw.note !== 'string') throw new Error('note must be text.');
  if (raw.chapter !== undefined && !(typeof raw.chapter === 'number' && Number.isInteger(raw.chapter) && raw.chapter >= 0)) throw new Error('chapter must be a whole number from 0 up.');
  if (raw.status !== undefined && !STORY_STATUSES.includes(raw.status as StoryStatus)) throw new Error('status must be planned or happened.');
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, STORY_NOTE_MAX) : '';
  return {
    id: raw.id.trim(),
    x: Math.round(raw.x * 256) / 256,
    y: Math.round(raw.y * 256) / 256,
    type: raw.type as StoryType,
    title: raw.title.trim().slice(0, STORY_TITLE_MAX),
    ...(note ? { note } : {}),
    ...(typeof raw.chapter === 'number' ? { chapter: raw.chapter } : {}),
    status: (raw.status as StoryStatus | undefined) ?? 'happened',
  };
}

/** The events an edit list holds now, ordered by chapter (unchaptered last), then by when they were first placed. */
export function storyEventsFrom(edits: readonly WorldEdit[]): StoryEvent[] {
  const byId = new Map<string, { event: StoryEvent; order: number }>();
  let order = 0;
  for (const edit of edits) {
    if (edit.kind === 'story') {
      const { kind: _kind, ...record } = edit;
      void _kind;
      const prior = byId.get(record.id);
      byId.set(record.id, { event: record, order: prior?.order ?? order++ });
    } else if (edit.kind === 'storyRemove') {
      byId.delete(edit.id);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (a.event.chapter ?? Infinity) - (b.event.chapter ?? Infinity) || a.order - b.order)
    .map((entry) => entry.event);
}

/** What the reader knows up to a chapter: events that happened, in or before it (unchaptered ones always). */
export function storyKnownBy(events: readonly StoryEvent[], chapter: number | null): StoryEvent[] {
  return events.filter((event) => event.status === 'happened'
    && (chapter === null || event.chapter === undefined || event.chapter <= chapter));
}

/** A fresh id for a new event. */
export function newStoryId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `ev-${Date.now().toString(36)}-${random}`;
}

/** True for edits the world itself ignores: the reader's fog, story events and trade sites. */
export function isViewOnlyEdit(edit: WorldEdit): boolean {
  return edit.kind === 'fog' || edit.kind === 'story' || edit.kind === 'storyRemove'
    || edit.kind === 'tradeSite' || edit.kind === 'tradeSiteRemove' || edit.kind === 'tradeSiteRestore';
}
