// Continuity report: the travel check and the state ledger over the project's
// manuscript, world calendar, story events and Codex cards. One function feeds
// the chapter panel, the map trail and the AI bridge, so all three show the same data.
import { db } from '@/db';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { formatWorldDate, fromDayNumber, monthsInYear, daysInMonth, toDayNumber, toLastDayNumber, validateWorldRange, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { deserializeEdits } from '@/engines/worldgen/core/edits';
import { storyEventsFrom, type StoryEvent } from '@/engines/worldgen/core/storyEvents';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import type { Season, TravelMode } from '@/engines/worldgen/core/travel';
import { checkLedger, placeLedger, stateAt, type CharacterState, type PlacedLine, type Presence, type StateFinding } from '@/engines/writings/continuity/ledger';
import { chapterOfEvent, collectAppearances, judgeLeg, legsOf, seasonOfYearShare, type Appearance, type LegEstimate, type TravelLeg } from '@/engines/writings/continuity/travel';
import type { ChapterRef, CharacterContinuity, LedgerEntry } from '@/engines/writings/continuity/types';
import type { CodexEntry, Writing } from '@/types';

export interface ContinuityCharacter { id: string; title: string; continuity: CharacterContinuity }
export interface ContinuityReport {
  projectId: string;
  calendar: WorldCalendar | null;
  chapters: ChapterRef[];
  characters: ContinuityCharacter[];
  /** Title of every Codex card, by id (characters, items, places). */
  titles: Record<string, string>;
  worlds: { id: string; name: string }[];
  appearances: Record<string, Appearance[]>;
  legs: Array<TravelLeg & { intentional?: string }>;
  placed: PlacedLine[];
  stateFindings: Array<StateFinding & { intentional?: string }>;
  /** Worlds still being generated on this machine: their legs say "pending" until it finishes. */
  pendingWorlds: string[];
}

function dayRange(calendar: WorldCalendar | null, writing: Pick<Writing, 'worldDate' | 'worldDateEnd'>): { start: number | null; end: number | null } {
  if (!calendar || !writing.worldDate) return { start: null, end: null };
  try {
    if (validateWorldRange(calendar, writing.worldDate, writing.worldDateEnd) !== null) return { start: null, end: null };
    return { start: toDayNumber(calendar, writing.worldDate), end: toLastDayNumber(calendar, writing.worldDateEnd ?? writing.worldDate) };
  } catch { return { start: null, end: null }; }
}

/** The project's chapters with their numbers and calendar days. */
export function chapterRefs(writings: readonly Writing[], calendar: WorldCalendar | null): ChapterRef[] {
  return writings.map((w) => ({ writingId: w.id, chapter: typeof w.chapter === 'number' ? w.chapter : null, title: w.title, ...dayRange(calendar, w) }))
    .sort((a, b) => (a.chapter ?? 1e9) - (b.chapter ?? 1e9) || a.title.localeCompare(b.title));
}

/** Season a day falls in: the calendar year in quarters, starting in winter. */
export function seasonOfDay(calendar: WorldCalendar | null, day: number | null): Season {
  if (!calendar || day === null) return 'summer';
  try {
    const date = fromDayNumber(calendar, day);
    const months = monthsInYear(calendar, date.year);
    const index = Math.max(0, months.indexOf(date.month ?? months[0]));
    const length = daysInMonth(calendar, date.year, date.month ?? months[0]) || 1;
    return seasonOfYearShare((index + ((date.day ?? 1) - 1) / length) / Math.max(1, months.length));
  } catch { return 'summer'; }
}

export function continuityOf(entry: Pick<CodexEntry, 'continuity'>): CharacterContinuity {
  return entry.continuity ?? {};
}

const routeCache = new Map<string, LegEstimate>();
const ROUTE_CACHE_MAX = 400;

async function estimatorFor(world: GeneratedWorld, eraId: string | undefined): Promise<((from: Appearance, to: Appearance, mode: TravelMode, season: Season) => LegEstimate) | null> {
  const { openWorldForReading } = await import('@/engines/worldgen/bridgeAccess');
  const opened = await openWorldForReading(world, 'full', eraId);
  if (!opened.ok) return null;
  const { planRoute, normalizeTravelProfile } = await import('@/engines/worldgen/core/travel');
  const { data, geo } = opened.world;
  let profile: ReturnType<typeof normalizeTravelProfile> | undefined;
  try { profile = normalizeTravelProfile(world.travelProfile); } catch { profile = undefined; }
  const cell = (x: number, y: number) => {
    const cy = Math.max(0, Math.min(data.height - 1, Math.floor(y)));
    const cx = data.domain?.topology === 'finite' ? Math.max(0, Math.min(data.width - 1, Math.floor(x))) : ((Math.floor(x) % data.width) + data.width) % data.width;
    return { x: cx, y: cy };
  };
  const stamp = `${world.id}|${world.updatedAt}|${(world.edits ?? '').length}|${world.travelRevision ?? 0}`;
  return (from, to, mode, season) => {
    const a = cell(from.x, from.y), b = cell(to.x, to.y);
    const key = `${stamp}|${mode}|${season}|${a.x},${a.y}|${b.x},${b.y}`;
    const cached = routeCache.get(key);
    if (cached) return cached;
    let result: LegEstimate;
    try {
      const route = planRoute(data, geo, a, b, { mode, season, ...(world.travelPace && world.travelPace !== 'steady' ? { pace: world.travelPace } : {}), ...(profile && Object.keys(profile).length ? { profile } : {}) });
      result = route.impossible ? { impossible: route.impossible } : { days: route.days, km: route.km };
    } catch (error) {
      result = { impossible: error instanceof Error ? error.message : String(error) };
    }
    if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value as string);
    routeCache.set(key, result);
    return result;
  };
}

export interface ReportOptions {
  eraId?: string;
  /** Only this character's legs (the state checks always run on everyone: gifts cross characters). */
  characterId?: string;
  /** Skip route planning (state only, or when worlds should not be opened). */
  skipTravel?: boolean;
}

export async function buildContinuityReport(projectId: string, options: ReportOptions = {}): Promise<ContinuityReport> {
  const [writings, codex, resolved, worldRows] = await Promise.all([
    db.writings.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    resolveWorldCalendar(projectId, undefined, options.eraId),
    worldgenScopeOperations({ projectId, eraId: options.eraId }).worlds.getAll(projectId) as Promise<GeneratedWorld[]>,
  ]);
  const calendar = resolved?.calendar ?? null;
  const chapters = chapterRefs(writings, calendar);
  const characters = codex.filter((e) => e.type === 'character').map((e) => ({ id: e.id, title: e.title, continuity: continuityOf(e) }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const titles = Object.fromEntries(codex.map((e) => [e.id, e.title]));
  const ledgers = Object.fromEntries(characters.map((c) => [c.id, c.continuity.ledger ?? []])) as Record<string, LedgerEntry[]>;
  const worlds = worldRows.map((world) => {
    let events: StoryEvent[] = [];
    try { events = storyEventsFrom(deserializeEdits(world.edits ?? '[]')); } catch { events = []; }
    return { world, events };
  });
  const appearances = collectAppearances(worlds.map(({ world, events }) => ({ worldId: world.id, events })), ledgers, chapters);
  const notes = (characterId: string) => characters.find((c) => c.id === characterId)?.continuity.intentional ?? {};

  const legs: ContinuityReport['legs'] = [];
  const pendingWorlds: string[] = [];
  const estimators = new Map<string, Awaited<ReturnType<typeof estimatorFor>>>();
  for (const character of characters) {
    if (options.characterId && character.id !== options.characterId) continue;
    const mode = character.continuity.travelMode ?? 'foot';
    for (const { from, to } of legsOf(appearances.get(character.id) ?? [])) {
      let estimate: LegEstimate | null = null;
      if (!options.skipTravel && from.worldId === to.worldId) {
        if (!estimators.has(from.worldId)) {
          const row = worlds.find(({ world }) => world.id === from.worldId)?.world;
          const estimator = row ? await estimatorFor(row, options.eraId) : null;
          estimators.set(from.worldId, estimator);
          if (row && !estimator) pendingWorlds.push(row.id);
        }
        const estimator = estimators.get(from.worldId);
        const start = chapters.find((c) => c.writingId === from.writingId)?.start ?? null;
        estimate = estimator ? estimator(from, to, mode, seasonOfDay(calendar, start)) : 'pending';
      }
      const leg = judgeLeg(character.id, from, to, chapters, estimate);
      const note = notes(character.id)[leg.id];
      legs.push(note !== undefined ? { ...leg, intentional: note } : leg);
    }
  }

  const placed = placeLedger(ledgers, chapters);
  const presences: Presence[] = [];
  for (const { world, events } of worlds) {
    for (const event of events) {
      const chapter = chapterOfEvent(event, chapters);
      if (!chapter || chapter.chapter === null) continue;
      for (const characterId of event.who ?? []) presences.push({ characterId, chapter: chapter.chapter, writingId: chapter.writingId, lineId: `event:${world.id}:${event.id}`, label: event.title });
    }
  }
  const stateFindings = checkLedger(placed, presences).map((finding) => {
    const note = notes(finding.characterId)[finding.id];
    return note !== undefined ? { ...finding, intentional: note } : finding;
  });
  return {
    projectId, calendar, chapters, characters, titles,
    worlds: worldRows.map((w) => ({ id: w.id, name: w.title })),
    appearances: Object.fromEntries(appearances), legs, placed, stateFindings, pendingWorlds,
  };
}

/** A character's state at the end of a chapter (by number, or by the writing's own number). */
export function characterStateAt(report: ContinuityReport, characterId: string, chapter: number): CharacterState {
  return stateAt(report.placed, characterId, chapter);
}

/** A day number as text in the project calendar. */
export function dayText(calendar: WorldCalendar | null, day: number | null | undefined): string {
  if (!calendar || day === null || day === undefined) return '';
  try { return formatWorldDate(calendar, fromDayNumber(calendar, day)); } catch { return ''; }
}
