import { readEraRow, listEraRows, mutateEraRows, type EraRowMutation } from '@/services/worldEras/store';
import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { Timeline, TimelineEvent } from '@/types';
import { timelineEventLabel, validateEventClock } from './eventClock';
import { validateWorldCalendar, validateWorldRange, type WorldCalendar, formatWorldDate } from './worldCalendar';
import { resolveWorldCalendar } from './worldCalendarStore';

export function eventWithinYearRange(event: TimelineEvent, range?: Timeline['yearRange']): boolean {
  if (!range || event.dateMode === 'text' || !event.dateMode) return true;
  const year = event.dateMode === 'world' ? event.worldDate?.year : Number(event.realDate?.match(/^(-?\d+)-/)?.[1]);
  const end = event.dateMode === 'world' ? event.worldDateEnd?.year ?? year : Number(event.realDateEnd?.match(/^(-?\d+)-/)?.[1] ?? year);
  return year === undefined || !Number.isFinite(year) || (year <= range.end && (end ?? year) >= range.start);
}

export function compactTimelineLabel(event: TimelineEvent, calendar: WorldCalendar | null | undefined, precision: Timeline['displayPrecision'], locale?: string): string {
  if (!precision || precision === 'hour' || event.dateMode === 'text') return timelineEventLabel(event, calendar, locale);
  if (event.dateMode === 'world' && calendar && event.worldDate) {
    const date = precision === 'year' ? { year: event.worldDate.year, approx: event.worldDate.approx } : event.worldDate;
    const end = event.worldDateEnd && (precision === 'year' ? { year: event.worldDateEnd.year, approx: event.worldDateEnd.approx } : event.worldDateEnd);
    return `${formatWorldDate(calendar, date)}${end ? ` – ${formatWorldDate(calendar, end)}` : ''}`;
  }
  if (precision === 'year' && event.realDate) return `${event.realDate.split('-')[0]}${event.realDateEnd ? ` – ${event.realDateEnd.split('-')[0]}` : ''}`;
  return timelineEventLabel({ ...event, time: undefined, endTime: undefined }, calendar, locale);
}

/** Validate all existing dates before replacing calendar semantics. One atomic write. */
export async function saveTimelineSettings(projectId: string, timelineId: string, changes: Pick<Partial<Timeline>, 'worldCalendar' | 'yearRange' | 'displayPrecision'>, eraId?: string): Promise<void> {
  if (changes.worldCalendar) {
    const problems = validateWorldCalendar(changes.worldCalendar);
    if (problems.length) throw new Error(problems.join(' '));
  }
  const range = changes.yearRange;
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || Math.abs(range.start) > 1000000 || Math.abs(range.end) > 1000000 || range.start > range.end)) throw new Error('timeline.settings.invalidRange');
  await db.transaction('rw', eraId ? db.tables : [db.timelines, db.timelineEvents, db.projects], async () => {
    const scope = { projectId, eraId }, mutations: EraRowMutation[] = [];
    const timeline = eraId ? await readEraRow<Timeline>(scope, 'timelines', timelineId) : await db.timelines.get(timelineId);
    if (!timeline || timeline.projectId !== projectId) throw new Error('timeline.settings.missing');
    const effectiveCalendar = changes.worldCalendar ?? (('worldCalendar' in changes ? undefined : timeline.worldCalendar) ?? (await resolveWorldCalendar(projectId, undefined, eraId))?.calendar);
    if (range && effectiveCalendar?.allowNegativeYears === false && range.start < Math.min(...effectiveCalendar.eras.map(era => era.startYear))) throw new Error('timeline.settings.invalidRange');
    if ('worldCalendar' in changes) {
      const calendar = changes.worldCalendar ?? (await resolveWorldCalendar(projectId, undefined, eraId))?.calendar;
      const events = eraId ? (await listEraRows<TimelineEvent>(scope, 'timelineEvents')).filter(event => event.timelineId === timelineId) : await db.timelineEvents.where('timelineId').equals(timelineId).toArray();
      for (const event of events) {
        if (event.projectId !== projectId || event.dateMode !== 'world' || !event.worldDate) continue;
        if (!calendar || validateWorldRange(calendar, event.worldDate, event.worldDateEnd) || validateEventClock(event, calendar)) throw new Error(`timeline.settings.invalidExisting:${event.title}`);
        if (eraId) mutations.push({ table: 'timelineEvents', id: event.id, changes: { date: timelineEventLabel(event, calendar), updatedAt: Math.max(Date.now(), event.updatedAt + 1) } }); else await db.timelineEvents.update(event.id, { date: timelineEventLabel(event, calendar), updatedAt: Math.max(Date.now(), event.updatedAt + 1) });
      }
    }
    if (eraId) await mutateEraRows(scope, [...mutations, { table: 'timelines', id: timelineId, changes: { ...changes, updatedAt: Math.max(Date.now(), timeline.updatedAt + 1) } }]); else await db.timelines.update(timelineId, { ...changes, updatedAt: Math.max(Date.now(), timeline.updatedAt + 1) });
  });
  if (!eraId) void touchProject(projectId);
  notifyDataChanged({ source: 'other', table: 'timelines', entityId: timelineId, projectId });
}
