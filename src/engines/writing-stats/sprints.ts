// ============================================================================
// Writing sprints — persistence and the rules of a timed window
// ============================================================================
//
// Sprints get no Dexie table. Everything one needs is a handful of numbers per
// project, and the `settings` store already holds exactly this class of state
// (the locale, the project recipes, the per-project AI privacy switches): one
// row, one JSON payload, versioned so a future shape can be told apart from
// this one and a corrupt one can be dropped instead of crashing a view.
//
// Two payloads per project, plus one app-wide preferences payload:
//
//   • THE LOG — finished sprints, newest first, capped at MAX_SPRINT_LOG.
//   • THE ACTIVE SPRINT — the one still running, if any. It stores the
//     scheduled END, never a countdown: remaining time is always
//     `endsAt - Date.now()`, so a re-render, a jump to another chapter, a walk
//     through another engine and a full restart of the app all read the same
//     wall clock. A sprint whose end passed while the app was shut is filed at
//     that scheduled end — `endSprint` clamps to `endsAt` — so reopening the
//     app days later does not log a three-day sprint. It also carries the last
//     word total that was OBSERVED while it ran, so filing it late cannot
//     credit it with words that arrived after the clock stopped.
//
// Words are counted by diffing the project's total word count against a
// snapshot taken at the start (`baselineWords`). `recordEditorActivity` — the
// mechanism that feeds daily counts — accumulates into ONE row per project per
// day with negatives clamped away, so it can say what was written today but
// not what was written between two instants. The snapshot is the smallest
// thing that answers the sprint's question, and it reads the same numbers the
// daily counter is fed from: `writings.wordCount`, written by the editor's
// autosave flush. Nothing here records a second activity stream, and a
// finished sprint deliberately does NOT create a `WritingSession` row — those
// words are already counted for the day by the editor.

import { db } from '@/db';
import { getSetting, PROJECT_SETTING_PREFIXES, setSetting, updateSetting } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { shiftLocalDateKey, toLocalDateKey } from './date';
import type { ActiveSprint, SprintPrefs, SprintRecord } from './types';

// The two per-project keys are taken from the declaration `deleteProject`
// sweeps, so a project deleted mid-sprint cannot leave a log or a live sprint
// behind for a re-import with the same id to inherit.
const LOG_KEY_PREFIX = PROJECT_SETTING_PREFIXES.sprintLog;
const ACTIVE_KEY_PREFIX = PROJECT_SETTING_PREFIXES.activeSprint;
/** App-wide, not per project: it is the last setup, not a project's state. */
const PREFS_KEY = 'writingStats.sprintPrefs';

/** Shape version carried by every payload this module writes. */
const SHAPE_VERSION = 1;

/** How many finished sprints a project keeps. Older ones fall off the end. */
export const MAX_SPRINT_LOG = 100;

/** One-tap durations, in minutes. Anything else goes in the custom field. */
export const SPRINT_PRESETS = [15, 25, 45] as const;

/** A duration outside this range is a typo, not an intention. */
export const MIN_SPRINT_MINUTES = 1;
export const MAX_SPRINT_MINUTES = 480;

export const DEFAULT_SPRINT_PREFS: SprintPrefs = { durationMinutes: 25, targetWords: 0 };

interface LogPayload {
  v: number;
  sprints: SprintRecord[];
}

interface ActivePayload {
  v: number;
  sprint: StoredSprint;
}

interface PrefsPayload {
  v: number;
  prefs: SprintPrefs;
}

/**
 * What the app actually SAW while a sprint was running.
 *
 * A sprint's words are a diff against `baselineWords`, and the subtraction is
 * only honest if the second measurement was taken inside the window. Nothing
 * bounded that gap: a sprint whose clock ran out with the app closed was filed
 * with whatever the project weighed when someone next opened it — including a
 * chapter the copilot wrote half an hour after the sprint was over.
 *
 * These two numbers ride on the active-sprint payload as optional keys, so
 * SHAPE_VERSION does not move: a payload written before this existed simply
 * carries no observation, and an older build ignores the keys.
 */
interface SprintObservation {
  /** The project's word total at the last measurement taken inside the window. */
  observedWords: number;
  /** When that measurement was taken. */
  observedAt: number;
}

/** An active sprint as it is stored: the shared shape, plus the observation. */
export type StoredSprint = ActiveSprint & Partial<SprintObservation>;

/**
 * How late a measurement may be and still describe the sprint's window.
 *
 * A background tab's timers are throttled to roughly one a minute, so the tick
 * that files a sprint can land a little after the finish line; a reconcile
 * within a couple of minutes of it is reading the same manuscript the sprint
 * ended with. Beyond that, the words that appeared cannot be attributed to a
 * window nobody was watching.
 */
const MEASUREMENT_GRACE_MS = 2 * 60_000;

// ---------------------------------------------------------------------------
// Synchronous hints
//
// The control lives in the writings toolbar, which unmounts and remounts every
// time the author goes list → chapter → list. Re-reading Dexie each time is
// correct but takes a few milliseconds, and for those milliseconds a running
// sprint would render as a "start" button. These remember the last value this
// session so a remount paints the truth immediately; the async read still
// runs and still wins.
// ---------------------------------------------------------------------------
const activeHints = new Map<string, StoredSprint | null>();
let prefsHint: SprintPrefs | null = null;

/** Last known active sprint for a project; `undefined` when never read here. */
export function peekActiveSprint(projectId: string): ActiveSprint | null | undefined {
  return activeHints.get(projectId);
}

/** Last known sprint preferences, or `null` when never read this session. */
export function peekSprintPrefs(): SprintPrefs | null {
  return prefsHint;
}

// ---------------------------------------------------------------------------
// Reading and writing the settings payloads
// ---------------------------------------------------------------------------

function parsePayload<T extends { v: number }>(raw: string | undefined): T | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if ((parsed as { v?: unknown }).v !== SHAPE_VERSION) return null;
  return parsed as T;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeRecord(value: unknown): SprintRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<SprintRecord>;
  if (typeof row.id !== 'string' || typeof row.projectId !== 'string') return null;
  if (!isFiniteNumber(row.startedAt) || !isFiniteNumber(row.endedAt)) return null;
  if (!isFiniteNumber(row.targetWords) || !isFiniteNumber(row.actualWords)) return null;

  const record: SprintRecord = {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt,
    endedAt: Math.max(row.startedAt, row.endedAt),
    targetWords: Math.max(0, Math.round(row.targetWords)),
    actualWords: Math.max(0, Math.round(row.actualWords)),
  };
  if (typeof row.writingId === 'string') record.writingId = row.writingId;
  if (row.stopped === true) record.stopped = true;
  return record;
}

function sanitizeActive(value: unknown): StoredSprint | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<StoredSprint>;
  if (typeof row.id !== 'string' || typeof row.projectId !== 'string') return null;
  if (!isFiniteNumber(row.startedAt) || !isFiniteNumber(row.endsAt)) return null;
  if (!isFiniteNumber(row.targetWords) || !isFiniteNumber(row.baselineWords)) return null;
  if (row.endsAt <= row.startedAt) return null;

  const sprint: StoredSprint = {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt,
    endsAt: row.endsAt,
    targetWords: Math.max(0, Math.round(row.targetWords)),
    baselineWords: Math.max(0, Math.round(row.baselineWords)),
  };
  if (typeof row.writingId === 'string') sprint.writingId = row.writingId;
  // An observation is only evidence about this sprint if it was taken between
  // its start and its scheduled end. Anything else is dropped, exactly like a
  // malformed number.
  if (
    isFiniteNumber(row.observedWords) &&
    isFiniteNumber(row.observedAt) &&
    row.observedAt >= row.startedAt &&
    row.observedAt <= row.endsAt
  ) {
    sprint.observedWords = Math.max(0, Math.round(row.observedWords));
    sprint.observedAt = row.observedAt;
  }
  return sprint;
}

function parseLog(raw: string | undefined): SprintRecord[] {
  const payload = parsePayload<LogPayload>(raw);
  if (!payload || !Array.isArray(payload.sprints)) return [];
  return payload.sprints
    .map(sanitizeRecord)
    .filter((row): row is SprintRecord => row !== null)
    .sort((left, right) => right.startedAt - left.startedAt);
}

/** Every finished sprint for a project, newest first. */
export async function listSprints(projectId: string): Promise<SprintRecord[]> {
  if (!projectId) return [];
  return parseLog(await getSetting(LOG_KEY_PREFIX + projectId));
}

/**
 * Add one sprint to the log, in ONE transaction.
 *
 * The whole log is a single JSON value. Read-then-write across two awaits and
 * two sprints filed together — the toolbar closing a stopped one while the
 * stats view reconciles an expired one — leave only the second: the first
 * sprint is written into a list the second call had already read without it.
 */
async function appendToLog(projectId: string, record: SprintRecord): Promise<void> {
  await updateSetting(LOG_KEY_PREFIX + projectId, current => {
    const payload: LogPayload = {
      v: SHAPE_VERSION,
      sprints: [record, ...parseLog(current).filter(row => row.id !== record.id)].slice(
        0,
        MAX_SPRINT_LOG,
      ),
    };
    return JSON.stringify(payload);
  });
}

/** The sprint still running for a project, or `null`. */
export async function readActiveSprint(projectId: string): Promise<StoredSprint | null> {
  if (!projectId) return null;
  const payload = parsePayload<ActivePayload>(await getSetting(ACTIVE_KEY_PREFIX + projectId));
  const sprint = payload ? sanitizeActive(payload.sprint) : null;
  activeHints.set(projectId, sprint);
  return sprint;
}

// `settings` has no delete helper and this module may not add one, so "no
// active sprint" is written as an empty value — `parsePayload` reads that back
// as nothing, exactly like a missing row.
async function writeActiveSprint(projectId: string, sprint: StoredSprint | null): Promise<void> {
  activeHints.set(projectId, sprint);
  const payload: ActivePayload | null = sprint ? { v: SHAPE_VERSION, sprint } : null;
  await setSetting(ACTIVE_KEY_PREFIX + projectId, payload ? JSON.stringify(payload) : '');
}

function sanitizePrefs(value: unknown): SprintPrefs {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SPRINT_PREFS };
  const row = value as Partial<SprintPrefs>;
  return {
    durationMinutes: clampMinutes(row.durationMinutes),
    targetWords: clampTarget(row.targetWords),
  };
}

/** The remembered sprint setup, falling back to a sane default. */
export async function readSprintPrefs(): Promise<SprintPrefs> {
  const payload = parsePayload<PrefsPayload>(await getSetting(PREFS_KEY));
  const prefs = payload ? sanitizePrefs(payload.prefs) : { ...DEFAULT_SPRINT_PREFS };
  prefsHint = prefs;
  return prefs;
}

async function writeSprintPrefs(prefs: SprintPrefs): Promise<void> {
  prefsHint = prefs;
  const payload: PrefsPayload = { v: SHAPE_VERSION, prefs };
  await setSetting(PREFS_KEY, JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// The sprint itself
// ---------------------------------------------------------------------------

/** Coerce anything a duration field can produce into a usable number of minutes. */
export function clampMinutes(value: unknown): number {
  const minutes = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_SPRINT_PREFS.durationMinutes;
  return Math.min(MAX_SPRINT_MINUTES, Math.max(MIN_SPRINT_MINUTES, Math.round(minutes)));
}

/** Coerce a word-target field; anything unusable means "no target". */
export function clampTarget(value: unknown): number {
  const target = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(1_000_000, Math.round(target));
}

export interface BeginSprintInput {
  projectId: string;
  durationMinutes: number;
  targetWords: number;
  /** The project's word count right now — the diff is measured against this. */
  baselineWords: number;
  writingId?: string;
}

/** Start a sprint, persist it, and remember the setup for the next one. */
export async function beginSprint(input: BeginSprintInput): Promise<ActiveSprint> {
  const durationMinutes = clampMinutes(input.durationMinutes);
  const targetWords = clampTarget(input.targetWords);
  const startedAt = Date.now();

  const baselineWords = Math.max(0, Math.round(input.baselineWords));

  const sprint: StoredSprint = {
    id: generateId('sprint'),
    projectId: input.projectId,
    startedAt,
    endsAt: startedAt + durationMinutes * 60_000,
    targetWords,
    baselineWords,
    // The first observation is the baseline itself. A sprint that is never
    // looked at again is then filed with the words it was actually seen with —
    // zero — rather than with everything that appeared while nobody watched.
    observedWords: baselineWords,
    observedAt: startedAt,
  };
  if (input.writingId) sprint.writingId = input.writingId;

  await writeActiveSprint(input.projectId, sprint);
  await writeSprintPrefs({ durationMinutes, targetWords });
  return sprint;
}

export interface EndSprintOutcome {
  /** Net words added since the sprint started. Negative values file as zero. */
  words: number;
  /** True when the writer ended it before the clock ran out. */
  stopped: boolean;
}

/**
 * File a sprint into the log and clear the active record.
 *
 * A sprint that ran its course is always stamped with its SCHEDULED end, and a
 * stopped one can never be stamped later than that end — the app may have been
 * shut across the finish line, and the sprint still ended when it said it
 * would.
 */
export async function endSprint(
  sprint: ActiveSprint,
  outcome: EndSprintOutcome,
): Promise<SprintRecord> {
  const endedAt = outcome.stopped
    ? Math.max(sprint.startedAt, Math.min(Date.now(), sprint.endsAt))
    : sprint.endsAt;

  const record: SprintRecord = {
    id: sprint.id,
    projectId: sprint.projectId,
    startedAt: sprint.startedAt,
    endedAt,
    targetWords: sprint.targetWords,
    actualWords: Math.max(0, Math.round(outcome.words)),
  };
  if (sprint.writingId) record.writingId = sprint.writingId;
  if (outcome.stopped) record.stopped = true;

  await appendToLog(sprint.projectId, record);
  await writeActiveSprint(sprint.projectId, null);
  // The log lives in `settings`, which no entity hook watches; this is what
  // makes the history section refresh the moment a sprint is filed.
  notifyDataChanged({ source: 'other', table: 'settings', projectId: sprint.projectId });
  return record;
}

/** Sum of every writing's stored word count for a project. */
export async function projectWordTotal(projectId: string): Promise<number> {
  if (!projectId) return 0;
  const rows = await db.writings.where('projectId').equals(projectId).toArray();
  return rows.reduce((sum, row) => sum + (row.wordCount || 0), 0);
}

export interface SprintReconciliation {
  /** The sprint still running, if any. */
  active: ActiveSprint | null;
  /** A sprint whose clock had already run out, filed by this call. */
  finished: SprintRecord | null;
}

/**
 * Remember the word total a caller could see while the sprint was running.
 *
 * This is the sprint's only witness. `reconcileSprint` is where it is taken,
 * which means every caller that already holds a word count keeps it fresh —
 * the writings toolbar re-reads on each remount, so walking list → chapter →
 * list during a sprint keeps banking what has been written.
 */
async function observeWordTotal(
  sprint: StoredSprint,
  words: number | undefined,
  at: number,
): Promise<StoredSprint> {
  if (words === undefined) return sprint;
  const observedWords = Math.max(0, Math.round(words));
  if (sprint.observedWords === observedWords) return sprint;
  const observed: StoredSprint = { ...sprint, observedWords, observedAt: at };
  await writeActiveSprint(sprint.projectId, observed);
  return observed;
}

/**
 * Bring a project's sprint state up to date with the clock.
 *
 * Called wherever sprints surface — the editor toolbar and the stats history —
 * so a sprint whose window closed while the app was shut is filed at its
 * scheduled end rather than left dangling.
 *
 * Filing it late must not also credit it late. `endedAt` was already clamped to
 * the scheduled end, but the WORDS were `now - baseline` with nothing bounding
 * `now`: a sprint that ended at 10:25 unwatched, reconciled at 11:00 after the
 * copilot added a chapter at 10:40, was logged as nine hundred words nobody
 * typed inside it — and that number went on to be the "best sprint". So a
 * measurement taken long after the window is not used at all; the sprint is
 * filed with the last total that was seen while it ran.
 *
 * `currentWords` lets a caller that already holds the project's word count skip
 * the read; anyone else pays for one query, and only when there is an expired
 * sprint whose window a measurement taken now could still describe.
 */
export async function reconcileSprint(
  projectId: string,
  currentWords?: number,
): Promise<SprintReconciliation> {
  const active = await readActiveSprint(projectId);
  if (!active) return { active: null, finished: null };
  const now = Date.now();
  if (now < active.endsAt) {
    return { active: await observeWordTotal(active, currentWords, now), finished: null };
  }

  const seenWords =
    now <= active.endsAt + MEASUREMENT_GRACE_MS
      ? (currentWords ?? (await projectWordTotal(projectId)))
      : (active.observedWords ?? active.baselineWords);

  const finished = await endSprint(active, {
    words: seenWords - active.baselineWords,
    stopped: false,
  });
  return { active: null, finished };
}

// ---------------------------------------------------------------------------
// Presentation helpers, shared by both engines
// ---------------------------------------------------------------------------

/** `mm:ss` for a countdown. Never negative, never longer than it has to be. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Whole minutes between two instants, floored at one. */
export function minutesBetween(fromMs: number, toMs: number): number {
  return Math.max(1, Math.round((toMs - fromMs) / 60_000));
}

/** Did the writer hit the target? A sprint with no target never "misses". */
export function targetMet(sprint: Pick<SprintRecord, 'targetWords' | 'actualWords'>): boolean {
  return sprint.targetWords > 0 && sprint.actualWords >= sprint.targetWords;
}

export interface SprintTotals {
  /** Sprints started in the last seven local days, today included. */
  thisWeek: number;
  /** Most words in any single logged sprint. */
  bestWords: number;
}

export function summarizeSprints(sprints: SprintRecord[]): SprintTotals {
  const weekStart = shiftLocalDateKey(toLocalDateKey(), -6);
  let thisWeek = 0;
  let bestWords = 0;
  for (const sprint of sprints) {
    if (toLocalDateKey(new Date(sprint.startedAt)) >= weekStart) thisWeek += 1;
    if (sprint.actualWords > bestWords) bestWords = sprint.actualWords;
  }
  return { thisWeek, bestWords };
}
