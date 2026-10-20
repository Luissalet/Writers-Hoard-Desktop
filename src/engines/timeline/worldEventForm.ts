// The world-calendar part of the two event forms (list and swim lanes):
// the text typed in, read in the project's calendar.
import type { TimelineEvent } from '@/types';
import { formatWorldRange, parseWorldDate, validateWorldRange, type WorldCalendar } from './worldCalendar';
import { worldEventEndKey, worldEventKey, worldEventLabel } from './worldCalendarStore';
import { realEventTimeKey } from './eventClock';

export interface WorldFormResult {
  /** i18n key of the problem, or null. */
  error: string | null;
  fields: Pick<TimelineEvent, 'worldDate' | 'worldDateEnd'>;
  label: string;
}

export function readWorldForm(calendar: WorldCalendar | null | undefined, startText: string, endText: string): WorldFormResult {
  const empty = { fields: { worldDate: undefined, worldDateEnd: undefined }, label: '' };
  if (!calendar) return { error: 'timeline.world.noCalendar', ...empty };
  if (!startText.trim()) return { error: 'timeline.world.needStart', ...empty };
  const start = parseWorldDate(calendar, startText);
  if (!start) return { error: 'timeline.world.badStart', ...empty };
  const end = endText.trim() ? parseWorldDate(calendar, endText) : undefined;
  if (end === null) return { error: 'timeline.world.badEnd', ...empty };
  if (validateWorldRange(calendar, start, end)) return { error: 'timeline.dateEndBeforeStart', ...empty };
  return { error: null, fields: { worldDate: start, worldDateEnd: end }, label: formatWorldRange(calendar, start, end) };
}

/** Chronological comparison for the list view: world dates, then real dates, then the rest by order. */
export function chronologicalCompare(calendar: WorldCalendar | null | undefined) {
  return (a: TimelineEvent, b: TimelineEvent): number => {
    const aw = worldEventKey(a, calendar);
    const bw = worldEventKey(b, calendar);
    if (aw !== null && bw !== null) return aw - bw || (worldEventEndKey(a, calendar)! - worldEventEndKey(b, calendar)!) || a.order - b.order;
    if (aw !== null) return -1;
    if (bw !== null) return 1;
    const aDate = realEventTimeKey(a);
    const bDate = realEventTimeKey(b);
    if (aDate !== null && bDate !== null) return aDate - bDate || a.order - b.order;
    if (aDate !== null) return -1;
    if (bDate !== null) return 1;
    return a.order - b.order;
  };
}

export { worldEventKey, worldEventLabel };
