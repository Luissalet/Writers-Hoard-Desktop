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
  /** Where it falls within its chapter, from 0; absent = in the order it was placed. */
  order?: number;
  /** Who was there: Codex entry ids (characters, factions), at most `STORY_WHO_MAX`. */
  who?: string[];
}

export const STORY_WHO_MAX = 20;

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
  if (raw.order !== undefined && !(typeof raw.order === 'number' && Number.isInteger(raw.order) && raw.order >= 0 && raw.order < 10000)) throw new Error('order must be a whole number from 0 to 9999.');
  if (raw.who !== undefined && !(Array.isArray(raw.who) && raw.who.length <= STORY_WHO_MAX && raw.who.every((id) => typeof id === 'string' && id.trim() && id.length <= 80))) throw new Error(`who must be a list of up to ${STORY_WHO_MAX} Codex entry ids.`);
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, STORY_NOTE_MAX) : '';
  const who = Array.isArray(raw.who) ? [...new Set((raw.who as string[]).map((id) => id.trim()))] : [];
  return {
    id: raw.id.trim(),
    x: Math.round(raw.x * 256) / 256,
    y: Math.round(raw.y * 256) / 256,
    type: raw.type as StoryType,
    title: raw.title.trim().slice(0, STORY_TITLE_MAX),
    ...(note ? { note } : {}),
    ...(typeof raw.chapter === 'number' ? { chapter: raw.chapter } : {}),
    status: (raw.status as StoryStatus | undefined) ?? 'happened',
    ...(typeof raw.order === 'number' ? { order: raw.order } : {}),
    ...(who.length ? { who } : {}),
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
  // Within a chapter, an event the author placed in order comes first by that
  // order; the rest follow in the order they were placed.
  const rank = (entry: { event: StoryEvent; order: number }) => entry.event.order ?? 1e6 + entry.order;
  return [...byId.values()]
    .sort((a, b) => (a.event.chapter ?? Infinity) - (b.event.chapter ?? Infinity) || rank(a) - rank(b) || a.order - b.order)
    .map((entry) => entry.event);
}

/** What the reader knows up to a chapter: events that happened, in or before it (unchaptered ones always). */
export function storyKnownBy(events: readonly StoryEvent[], chapter: number | null): StoryEvent[] {
  return events.filter((event) => event.status === 'happened'
    && (chapter === null || event.chapter === undefined || event.chapter <= chapter));
}

/** One step of the story's playback: what happens in that chapter, and what is still only planned for it. */
export interface StoryChapterFrame { chapter: number; happened: StoryEvent[]; planned: StoryEvent[] }

/**
 * The chapters the story can be played through, in order: those with events
 * and those the reader's fog was painted for (`fogChapters`), each with its
 * events.
 */
export function storyChapterFrames(events: readonly StoryEvent[], fogChapters: readonly number[] = []): StoryChapterFrame[] {
  const chapters = [...new Set([...fogChapters, ...events.flatMap((event) => event.chapter === undefined ? [] : [event.chapter])])].sort((a, b) => a - b);
  return chapters.map((chapter) => ({
    chapter,
    happened: events.filter((event) => event.chapter === chapter && event.status === 'happened'),
    planned: events.filter((event) => event.chapter === chapter && event.status === 'planned'),
  }));
}

/**
 * Move an event up or down within its chapter: the chapter's events in their
 * current order with this one shifted, as the new `order` of each.
 */
export function reorderInChapter(events: readonly StoryEvent[], id: string, by: -1 | 1): StoryEvent[] {
  const moving = events.find((event) => event.id === id);
  if (!moving) return [];
  const group = chapterGroup(events, moving.chapter);
  const from = group.indexOf(moving), to = from + by;
  if (to < 0 || to >= group.length) return [];
  const next = [...group];
  [next[from], next[to]] = [next[to], next[from]];
  // Every event of the chapter takes its place number, so the order holds whatever was placed later.
  return next.map((event, order) => ({ ...event, order }));
}

/**
 * The events of a chapter in their story order. `events` may carry records
 * written since it was sorted (a move just made), so the order is re-read:
 * placed in order first, by that order, then the rest as they stand.
 */
function chapterGroup(events: readonly StoryEvent[], chapter: number | undefined): StoryEvent[] {
  return events.map((event, index) => ({ event, index }))
    .filter(({ event }) => (event.chapter ?? null) === (chapter ?? null))
    .sort((a, b) => (a.event.order ?? 1e6 + a.index) - (b.event.order ?? 1e6 + b.index) || a.index - b.index)
    .map(({ event }) => event);
}

/**
 * Put an event at a position within its chapter (0 = first; past the end =
 * last): the others move along, and every event of the chapter is returned
 * with its new `order`. `events` must include the event as it should be.
 */
export function placeInChapter(events: readonly StoryEvent[], id: string, index: number): StoryEvent[] {
  const moving = events.find((event) => event.id === id);
  if (!moving) return [];
  const group = chapterGroup(events, moving.chapter).filter((event) => event.id !== id);
  group.splice(Math.max(0, Math.min(group.length, Math.floor(index))), 0, moving);
  return group.map((event, order) => ({ ...event, order }));
}

/** The chapter after `current` in the playback order (the first one from the start), or null at the end. */
export function nextStoryChapter(chapters: readonly number[], current: number | null): number | null {
  if (!chapters.length) return null;
  if (current === null) return chapters[0];
  return chapters.find((chapter) => chapter > current) ?? null;
}

/** The chapter before `current`, or null before the first. */
export function previousStoryChapter(chapters: readonly number[], current: number | null): number | null {
  if (current === null) return null;
  const earlier = chapters.filter((chapter) => chapter < current);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/** A fresh id for a new event. */
export function newStoryId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `ev-${Date.now().toString(36)}-${random}`;
}

/** True for edits the world itself ignores: the reader's fog, story events, trade sites and place locks. */
export function isViewOnlyEdit(edit: WorldEdit): boolean {
  return edit.kind === 'fog' || edit.kind === 'story' || edit.kind === 'storyRemove'
    || edit.kind === 'tradeSite' || edit.kind === 'tradeSiteRemove' || edit.kind === 'tradeSiteRestore'
    || edit.kind === 'lock';
}
