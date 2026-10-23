// Re-dating events when the calendar changes: a date the new calendar no
// longer has moves to the nearest one it has — a removed month to the last
// month, a day past the month's end to its last day, an hour past the day's
// hours to its last hour — and an end never comes before its start.
import type { TimelineEvent } from '@/types';
import { daysInMonth, toDayNumber, validateWorldRange, type WorldCalendar, type WorldDate } from './worldCalendar';
import { validateEventClock, timelineEventLabel } from './eventClock';

function clampDate(calendar: WorldCalendar, date: WorldDate): WorldDate {
  const next: WorldDate = { ...date };
  if (calendar.allowNegativeYears === false) next.year = Math.max(next.year, Math.min(...calendar.eras.map(era => era.startYear)));
  if (next.month !== undefined) {
    next.month = Math.min(Math.max(1, next.month), calendar.months.length);
    // A leap month in a common year has no days: go back to the last month that has some that year.
    while (next.month > 1 && daysInMonth(calendar, next.year, next.month) === 0) next.month--;
    if (daysInMonth(calendar, next.year, next.month) === 0) next.month = calendar.months.findIndex((_, index) => daysInMonth(calendar, next.year, index + 1) > 0) + 1 || 1;
    if (next.day !== undefined) next.day = Math.min(Math.max(1, next.day), daysInMonth(calendar, next.year, next.month));
  }
  return next;
}
function clampClock(value: string | undefined, hours: number): string | undefined {
  if (!value) return value;
  const match = /^(\d{1,4}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const h = Math.min(Number(match[1]), hours - 1), m = Math.min(Number(match[2]), 59);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface RedateChange { id: string; title: string; before: string; after: string; changes: Pick<TimelineEvent, 'worldDate' | 'worldDateEnd' | 'time' | 'endTime' | 'date'> }

/** The world-dated events this calendar no longer accepts, each with the date it would move to. */
export function redatePlan(events: readonly TimelineEvent[], calendar: WorldCalendar): RedateChange[] {
  const plan: RedateChange[] = [];
  for (const event of events) {
    if (event.dateMode !== 'world' || !event.worldDate) continue;
    let fits = false;
    try { fits = validateWorldRange(calendar, event.worldDate, event.worldDateEnd) === null && validateEventClock(event, calendar) === null; } catch { fits = false; }
    if (fits) continue;
    const worldDate = clampDate(calendar, event.worldDate);
    let worldDateEnd = event.worldDateEnd ? clampDate(calendar, event.worldDateEnd) : undefined;
    try { if (worldDateEnd && toDayNumber(calendar, worldDateEnd) < toDayNumber(calendar, worldDate)) worldDateEnd = undefined; } catch { worldDateEnd = undefined; }
    const hours = calendar.hoursPerDay ?? 24;
    let time = clampClock(event.time, hours), endTime = clampClock(event.endTime, hours);
    const candidate = { ...event, worldDate, worldDateEnd, time, endTime };
    if (validateEventClock(candidate, calendar)) { endTime = undefined; if (validateEventClock({ ...candidate, endTime }, calendar)) time = undefined; }
    const moved = { ...candidate, time, endTime };
    // A move that still does not fit is never written.
    try { if (validateWorldRange(calendar, worldDate, worldDateEnd) !== null) continue; } catch { continue; }
    plan.push({ id: event.id, title: event.title, before: event.date, after: timelineEventLabel(moved, calendar), changes: { worldDate, worldDateEnd, time, endTime, date: timelineEventLabel(moved, calendar) } });
  }
  return plan;
}

/** World-dated events dated in the project's calendar (on timelines without one of their own). */
export async function projectCalendarEvents(projectId: string, eraId?: string): Promise<TimelineEvent[]> {
  const { db } = await import('@/db');
  const { listEraRows } = await import('@/services/worldEras/store');
  const scope = { projectId, eraId };
  const timelines = eraId ? await listEraRows<import('@/types').Timeline>(scope, 'timelines') : await db.timelines.where('projectId').equals(projectId).toArray();
  const own = new Set(timelines.filter(timeline => timeline.worldCalendar).map(timeline => timeline.id));
  const events = eraId ? await listEraRows<TimelineEvent>(scope, 'timelineEvents') : await db.timelineEvents.where('projectId').equals(projectId).toArray();
  return events.filter(event => !own.has(event.timelineId) && event.dateMode === 'world' && event.worldDate);
}

/** Move the planned events in one write. */
export async function applyRedate(projectId: string, plan: readonly RedateChange[], eraId?: string): Promise<void> {
  if (!plan.length) return;
  const { db } = await import('@/db');
  const { mutateEraRows } = await import('@/services/worldEras/store');
  const { notifyDataChanged } = await import('@/engines/_shared/dataChanged');
  const now = Date.now();
  if (eraId) await mutateEraRows({ projectId, eraId }, plan.map(change => ({ table: 'timelineEvents', id: change.id, changes: { ...change.changes, updatedAt: now } })));
  else await db.transaction('rw', db.timelineEvents, async () => { for (const change of plan) await db.timelineEvents.update(change.id, { ...change.changes, updatedAt: now }); });
  notifyDataChanged({ source: 'other', table: 'timelineEvents', projectId });
}

/** The world-dated events of one timeline. */
export async function timelineWorldEvents(projectId: string, timelineId: string, eraId?: string): Promise<TimelineEvent[]> {
  const { db } = await import('@/db');
  const { listEraRows } = await import('@/services/worldEras/store');
  const events = eraId ? (await listEraRows<TimelineEvent>({ projectId, eraId }, 'timelineEvents')).filter(event => event.timelineId === timelineId) : await db.timelineEvents.where('timelineId').equals(timelineId).toArray();
  return events.filter(event => event.projectId === projectId && event.dateMode === 'world' && event.worldDate);
}
