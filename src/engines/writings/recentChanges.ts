// ============================================
// What changed this week
// ============================================
//
// A writer coming back on Monday has no way to see what they touched. The list
// sorts, but nothing says "these five chapters moved". This is the arithmetic
// behind that panel: which pieces fall inside a window, and how much each of
// them moved while it was open.
//
// Every boundary here is a LOCAL calendar boundary, computed through
// `writing-stats/date.ts`. `toISOString()` names a UTC day, which is yesterday
// for half the planet for part of every day — that bug has been fixed in this
// codebase three times and is not being reintroduced here.

import { db } from '@/db';
import type { Writing } from '@/types';
import { shiftLocalDateKey, toLocalDateKey } from '@/engines/writing-stats/date';

export type ChangeWindow = 'today' | 'week' | 'month';

/** Offered in this order, `week` first — the Monday-morning question. */
export const CHANGE_WINDOWS: readonly ChangeWindow[] = ['week', 'today', 'month'];

/** Days shown by the longest window. */
const MONTH_DAYS = 30;

/** Local midnight of a `YYYY-MM-DD` key, in ms. Never through UTC. */
export function startOfLocalDay(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

/** Monday = 0. Read off a local date, so it is the writer's own week. */
function mondayOffset(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return (new Date(year, month - 1, day).getDay() + 6) % 7;
}

/** The first calendar day a window covers. */
export function windowStartKey(window: ChangeWindow, today = toLocalDateKey()): string {
  switch (window) {
    case 'today':
      return today;
    case 'month':
      return shiftLocalDateKey(today, -(MONTH_DAYS - 1));
    case 'week':
    default:
      return shiftLocalDateKey(today, -mondayOffset(today));
  }
}

/** The instant a window opens: local midnight of its first day. */
export function windowStartMs(window: ChangeWindow, today = toLocalDateKey()): number {
  return startOfLocalDay(windowStartKey(window, today));
}

/** The pieces touched inside the window, most recently touched first. */
export function changedInWindow(writings: Writing[], startMs: number): Writing[] {
  return writings
    .filter((writing) => writing.updatedAt >= startMs)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

/**
 * How much each piece moved, in words.
 *
 * There is no per-chapter word log in this app — `writingSessions` totals a
 * whole project per day — so the only honest baseline is version history. The
 * editor takes one snapshot per session, of the text as it was BEFORE that
 * session, so the EARLIEST snapshot inside the window is the piece as it stood
 * when the window's first editing session began. Now minus that is what the
 * writer did in the window.
 *
 * A piece with no snapshot inside the window gets no number rather than an
 * invented one: it was changed by something that does not snapshot (a Google
 * Doc sync), or its text was already identical to its last saved version, and
 * either way the panel says so instead of guessing.
 *
 * Cost: ONE indexed range read over `createdAt`, bounded by the window, and
 * streamed with `.each` so a month of history is never held in memory at once.
 */
export async function readWordDeltas(
  projectId: string,
  changed: Writing[],
  startMs: number,
): Promise<Map<string, number>> {
  const deltas = new Map<string, number>();
  if (changed.length === 0) return deltas;

  const current = new Map(changed.map((writing) => [writing.id, writing.wordCount]));
  const baselines = new Map<string, number>();

  // Ascending `createdAt`: the first snapshot seen for a writing is the
  // earliest one inside the window, which is the baseline we want.
  await db.writingSnapshots
    .where('createdAt')
    .aboveOrEqual(startMs)
    .each((snapshot) => {
      if (snapshot.projectId !== projectId) return;
      if (!current.has(snapshot.writingId) || baselines.has(snapshot.writingId)) return;
      baselines.set(snapshot.writingId, snapshot.wordCount);
    });

  for (const [id, words] of current) {
    const baseline = baselines.get(id);
    if (baseline !== undefined) deltas.set(id, words - baseline);
  }
  return deltas;
}
