// Travel check: can each character get from one appearance to the next in the
// days the world calendar gives them? Pure: the route estimate is passed in.
import type { StoryEvent } from '@/engines/worldgen/core/storyEvents';
import type { ChapterRef, LedgerEntry } from './types';

/** One place and moment where a character is: a story event naming them, or a ledger location on the map. */
export interface Appearance {
  /** `event:<worldId>:<eventId>` or `ledger:<entryId>`. */
  id: string;
  characterId: string;
  writingId: string;
  chapter: number;
  /** Order within the chapter (events and lines placed in order first). */
  rank: number;
  worldId: string;
  x: number;
  y: number;
  label: string;
  source: 'event' | 'ledger';
}

export type TravelVerdict = 'impossible' | 'tight' | 'comfortable' | 'unknown';
export type UnknownReason = 'undated' | 'other-world' | 'no-route' | 'pending';

/** What the route engine says a leg takes. */
export type LegEstimate = { days: number; km: number } | { impossible: string } | 'pending';

export interface TravelLeg {
  /** Stable: the two appearances; the key an "intended" mark is kept under. */
  id: string;
  characterId: string;
  from: Appearance;
  to: Appearance;
  /** Days between leaving (first day of the first chapter) and arriving (last day of the second), both counted. */
  availableDays: number | null;
  neededDays: number | null;
  km: number | null;
  verdict: TravelVerdict;
  reason?: UnknownReason;
  /** For an impossible leg: the earliest first day (day number) the destination chapter could start on. */
  minStart?: number;
}

/** Share of the available days above which a leg counts as tight. */
export const TIGHT_SHARE = 0.75;

/** A chapter's place in order for a story event: its own writing when it names one, else its chapter number. */
export function chapterOfEvent(event: Pick<StoryEvent, 'chapter' | 'writingId'>, chapters: readonly ChapterRef[]): ChapterRef | null {
  if (event.writingId) {
    const own = chapters.find((c) => c.writingId === event.writingId);
    if (own && own.chapter !== null) return own;
  }
  if (event.chapter === undefined) return null;
  return chapters.find((c) => c.chapter === event.chapter) ?? null;
}

/**
 * Every appearance of every character, in story order per character. Story
 * events come from the map; a ledger location with a map point counts only for
 * a chapter where the character has no story event.
 */
export function collectAppearances(
  worlds: readonly { worldId: string; events: readonly StoryEvent[] }[],
  ledgers: Readonly<Record<string, readonly LedgerEntry[]>>,
  chapters: readonly ChapterRef[],
): Map<string, Appearance[]> {
  const out = new Map<string, Appearance[]>();
  const push = (a: Appearance) => out.set(a.characterId, [...(out.get(a.characterId) ?? []), a]);
  for (const { worldId, events } of worlds) {
    events.forEach((event, index) => {
      const chapter = chapterOfEvent(event, chapters);
      if (!chapter || chapter.chapter === null) return;
      for (const characterId of event.who ?? []) {
        push({ id: `event:${worldId}:${event.id}`, characterId, writingId: chapter.writingId, chapter: chapter.chapter, rank: event.order ?? 1e6 + index, worldId, x: event.x, y: event.y, label: event.title, source: 'event' });
      }
    });
  }
  const byWriting = new Map(chapters.map((c) => [c.writingId, c]));
  for (const [characterId, entries] of Object.entries(ledgers)) {
    const evented = new Set((out.get(characterId) ?? []).map((a) => a.writingId));
    entries.forEach((entry) => {
      const chapter = byWriting.get(entry.writingId);
      const place = entry.place;
      if (entry.kind !== 'location' || !place || place.worldId === undefined || place.x === undefined || place.y === undefined) return;
      if (!chapter || chapter.chapter === null || evented.has(entry.writingId)) return;
      push({ id: `ledger:${entry.id}`, characterId, writingId: entry.writingId, chapter: chapter.chapter, rank: entry.order ?? 1e6 + entry.createdAt / 1e13, worldId: place.worldId, x: place.x, y: place.y!, label: place.label, source: 'ledger' });
    });
  }
  for (const [key, list] of out) out.set(key, list.sort((a, b) => a.chapter - b.chapter || a.rank - b.rank));
  return out;
}

/** The legs between consecutive appearances at different points (same point = no journey). */
export function legsOf(appearances: readonly Appearance[]): Array<{ from: Appearance; to: Appearance }> {
  const legs: Array<{ from: Appearance; to: Appearance }> = [];
  for (let i = 1; i < appearances.length; i++) {
    const from = appearances[i - 1], to = appearances[i];
    if (from.worldId === to.worldId && Math.hypot(from.x - to.x, from.y - to.y) < 0.75) continue;
    legs.push({ from, to });
  }
  return legs;
}

/** Judge one leg against the calendar, given the route estimate. */
export function judgeLeg(
  characterId: string,
  from: Appearance,
  to: Appearance,
  chapters: readonly ChapterRef[],
  estimate: LegEstimate | null,
): TravelLeg {
  const base = { id: `${from.id}>${to.id}`, characterId, from, to };
  const a = chapters.find((c) => c.writingId === from.writingId), b = chapters.find((c) => c.writingId === to.writingId);
  const availableDays = a?.start != null && b?.end != null ? b.end - a.start + 1 : null;
  if (from.worldId !== to.worldId) return { ...base, availableDays, neededDays: null, km: null, verdict: 'unknown', reason: 'other-world' };
  if (estimate === 'pending' || estimate === null) return { ...base, availableDays, neededDays: null, km: null, verdict: 'unknown', reason: 'pending' };
  if ('impossible' in estimate) return { ...base, availableDays, neededDays: null, km: null, verdict: 'unknown', reason: 'no-route' };
  const neededDays = Math.round(estimate.days * 100) / 100, km = Math.round(estimate.km);
  if (availableDays === null) return { ...base, availableDays, neededDays, km, verdict: 'unknown', reason: 'undated' };
  if (neededDays > availableDays) {
    // Shift the destination chapter so its last day leaves enough days, keeping its length.
    const length = b!.end! - b!.start!;
    const minStart = Math.max(a!.start!, a!.start! + Math.ceil(neededDays) - 1 - length);
    return { ...base, availableDays, neededDays, km, verdict: 'impossible', minStart };
  }
  return { ...base, availableDays, neededDays, km, verdict: neededDays > availableDays * TIGHT_SHARE ? 'tight' : 'comfortable' };
}

/** Season for a day of the year: the year in quarters, starting in winter. */
export function seasonOfYearShare(share: number): 'winter' | 'spring' | 'summer' | 'autumn' {
  const q = Math.max(0, Math.min(0.9999, share));
  return q < 0.25 ? 'winter' : q < 0.5 ? 'spring' : q < 0.75 ? 'summer' : 'autumn';
}
