import type { TimelineEvent } from '@/types';
import type { WorldCalendar } from './worldCalendar';
import { toDayNumber } from './worldCalendar';
import { clockMinutes, formatTimedRange } from './eventDetails';
import { worldEventLabel } from './worldCalendarStore';

export function validateEventClock(event: Pick<TimelineEvent, 'dateMode' | 'realDate' | 'realDateEnd' | 'worldDate' | 'worldDateEnd' | 'time' | 'endTime'>, calendar?: WorldCalendar | null): string | null {
  if (event.dateMode === 'text' || (!event.time && !event.endTime)) return null;
  const hours = event.dateMode === 'world' ? calendar?.hoursPerDay ?? 24 : 24;
  const start = clockMinutes(event.time, hours), end = clockMinutes(event.endTime, hours);
  if (start === null || end === null) return 'timeline.details.badClock';
  let sameDay = true;
  if (event.dateMode === 'world') {
    if (!calendar || event.worldDate?.month === undefined || event.worldDate?.day === undefined || (event.endTime && event.worldDateEnd && (event.worldDateEnd.month === undefined || event.worldDateEnd.day === undefined))) return 'timeline.details.exactDay';
    try { sameDay = !event.worldDateEnd || toDayNumber(calendar, event.worldDateEnd) === toDayNumber(calendar, event.worldDate); } catch { return 'timeline.details.exactDay'; }
  } else {
    if (!event.realDate) return 'timeline.details.exactDay';
    sameDay = !event.realDateEnd || event.realDateEnd === event.realDate;
  }
  return event.endTime && sameDay && end < start ? 'timeline.dateEndBeforeStart' : null;
}

/** UTC here is an arithmetic coordinate, never a user's timezone conversion. */
export function realEventTimeKey(event: Pick<TimelineEvent, 'dateMode' | 'realDate' | 'time'>): number | null {
  if (event.dateMode !== 'calendar' || !event.realDate) return null;
  const minutes = clockMinutes(event.time);
  const day = Date.parse(`${event.realDate}T00:00:00Z`);
  return minutes === null || !Number.isFinite(day) ? null : day + minutes * 60000;
}

export function timelineEventLabel(event: Pick<TimelineEvent, 'date' | 'dateMode' | 'realDate' | 'realDateEnd' | 'worldDate' | 'worldDateEnd' | 'time' | 'endTime'>, calendar?: WorldCalendar | null, locale?: string): string {
  if (event.dateMode === 'world') return worldEventLabel(event, calendar);
  if (event.dateMode !== 'calendar' || !event.realDate) return event.date || '';
  const format = (iso: string) => {
    try { return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)); }
    catch { return iso; }
  };
  return formatTimedRange(format(event.realDate), event.realDateEnd ? format(event.realDateEnd) : undefined, event.time, event.endTime);
}
