// The calendar grid: a month laid out in weeks, a year as its months, and the
// events that fall on each day. Pure, on a world calendar — the project's own,
// or the Gregorian one built as a world calendar for real dates.
import type { TimelineEvent } from '@/types';
import { isoDate, type CalendarLens } from './calendarLens';
import { daysInMonth, fromDayNumber, holidaysOn, isLeapYear, moonsOn, toDayNumber, toLastDayNumber, weekdayOf, type MoonPhase, type WorldCalendar, type WorldDate } from './worldCalendar';

export type CalendarKind = 'world' | 'earth';

/** The days an event covers on this calendar, or null when it is not dated on it. */
export function eventDayRange(calendar: WorldCalendar, kind: CalendarKind, event: TimelineEvent, lens?: CalendarLens | null): { from: number; to: number } | null {
  try {
    // Through the lens: a world-dated event on the Earth calendar, a real-dated one on the world calendar.
    if (lens && kind === 'earth' && event.dateMode === 'world' && event.worldDate) {
      const from = toDayNumber(lens.world, event.worldDate) + lens.offset;
      const to = toLastDayNumber(lens.world, event.worldDateEnd ?? event.worldDate) + lens.offset;
      return { from, to: Math.max(from, to) };
    }
    if (lens && kind === 'world' && event.dateMode === 'calendar' && event.realDate) {
      const start = isoDate(event.realDate); if (!start) return null;
      const end = event.realDateEnd ? isoDate(event.realDateEnd) : null;
      const from = toDayNumber(lens.earth, start) - lens.offset, to = end ? toDayNumber(lens.earth, end) - lens.offset : from;
      return { from, to: Math.max(from, to) };
    }
    if (kind === 'world' && event.dateMode === 'world' && event.worldDate) {
      const from = toDayNumber(calendar, event.worldDate);
      const to = toLastDayNumber(calendar, event.worldDateEnd ?? event.worldDate);
      return { from, to: Math.max(from, to) };
    }
    if (kind === 'earth' && event.dateMode === 'calendar' && event.realDate) {
      const iso = (value: string): WorldDate | null => { const m = /^(-?\d{1,6})-(\d{2})-(\d{2})$/.exec(value); return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null; };
      const start = iso(event.realDate); if (!start) return null;
      const end = event.realDateEnd ? iso(event.realDateEnd) : null;
      const from = toDayNumber(calendar, start), to = end ? toDayNumber(calendar, end) : from;
      return { from, to: Math.max(from, to) };
    }
  } catch { /* a date that no longer fits the calendar is not placed */ }
  return null;
}

/**
 * The day ranges an event covers between two day numbers: once, or every
 * year (same month and day), month (same day) or week (same weekday) from its
 * date on, until its last year. A repeat keeps the event's length.
 */
export function eventOccurrences(calendar: WorldCalendar, kind: CalendarKind, event: TimelineEvent, from: number, to: number, lens?: CalendarLens | null): { from: number; to: number }[] {
  const range = eventDayRange(calendar, kind, event, lens);
  if (!range) return [];
  const span = range.to - range.from;
  const within = (start: number) => start <= to && start + span >= from;
  if (!event.repeat) return within(range.from) ? [range] : [];
  const start = fromDayNumber(calendar, range.from);
  const lastYear = event.repeat.untilYear;
  const result: { from: number; to: number }[] = [];
  const push = (startDay: number) => { if (startDay >= range.from && within(startDay) && (lastYear === undefined || fromDayNumber(calendar, startDay).year <= lastYear)) result.push({ from: startDay, to: startDay + span }); };
  if (event.repeat.every === 'week') {
    // Where weeks restart each month or festival days stand outside the week, "the same weekday" is looked up day by day.
    if (calendar.weekMode === 'monthStart' || calendar.months.some(month => month.intercalary)) {
      const weekday = weekdayOf(calendar, start);
      if (weekday === null) return within(range.from) ? [range] : [];
      for (let day = Math.max(range.from, from - span); day <= to; day++) { const date = fromDayNumber(calendar, day); if (weekdayOf(calendar, date) === weekday) push(day); }
      return result;
    }
    const week = Math.max(1, calendar.weekdays.length);
    const k0 = Math.max(0, Math.floor((from - span - range.from) / week));
    for (let k = k0; range.from + k * week <= to; k++) push(range.from + k * week);
    return result;
  }
  // A month or a year shown: look at the months the window touches.
  const a = fromDayNumber(calendar, Math.max(from - span, range.from)), b = fromDayNumber(calendar, to);
  for (let year = a.year; year <= b.year; year++) {
    for (let month = 1; month <= calendar.months.length; month++) {
      if (event.repeat.every === 'year' && month !== start.month) continue;
      if (year === a.year && month < a.month! || year === b.year && month > b.month!) continue;
      if (start.day! > daysInMonth(calendar, year, month)) continue;
      push(toDayNumber(calendar, { year, month, day: start.day! }));
    }
  }
  return result;
}

/** The phase the calendar marks on a day, as its moonDisplay asks. */
export function moonMark(calendar: WorldCalendar, dayNumber: number): MoonPhase | null {
  const display = calendar.moonDisplay ?? 'quarters';
  if (display === 'none' || !calendar.moons.length) return null;
  if (display === 'every') return moonsOn(calendar, dayNumber)[0]?.phase ?? null;
  const principal = principalPhase(calendar, dayNumber);
  return display === 'full' ? (principal === 'full' ? 'full' : null) : principal;
}

/** The first moon's new, quarter or full phase when it falls during this day. */
export function principalPhase(calendar: WorldCalendar, dayNumber: number): MoonPhase | null {
  const today = moonsOn(calendar, dayNumber)[0], tomorrow = moonsOn(calendar, dayNumber + 1)[0];
  if (!today || !tomorrow) return null;
  const end = tomorrow.fraction < today.fraction ? tomorrow.fraction + 1 : tomorrow.fraction;
  for (const [target, phase] of [[0, 'new'], [0.25, 'firstQuarter'], [0.5, 'full'], [0.75, 'lastQuarter'], [1, 'new']] as const) if (today.fraction <= target && target < end) return phase;
  return null;
}

export interface CalendarDay { day: number; dayNumber: number; weekday: string | null; holidays: string[]; moon: MoonPhase | null; leapDay: boolean; events: TimelineEvent[]; /** Each event's place in its run of days: where a banner starts and ends. */ bars: { event: TimelineEvent; start: boolean; end: boolean }[] }
export interface CalendarMonth { year: number; month: number; name: string; intercalary: boolean; leapYear: boolean; days: CalendarDay[]; /** Blank cells before the first day, in a week row. */ lead: number }

export function calendarMonth(calendar: WorldCalendar, kind: CalendarKind, year: number, month: number, events: readonly TimelineEvent[], lens?: CalendarLens | null): CalendarMonth {
  const length = daysInMonth(calendar, year, month);
  const first = toDayNumber(calendar, { year, month, day: 1 });
  const placed = events.flatMap(event => eventOccurrences(calendar, kind, event, first, first + length - 1, lens).map(range => ({ event, range })));
  const base = calendar.months[month - 1].days;
  const leapYear = isLeapYear(calendar, year);
  const days: CalendarDay[] = Array.from({ length }, (_, i) => {
    const date = { year, month, day: i + 1 }, dayNumber = first + i;
    return {
      day: i + 1, dayNumber,
      weekday: weekdayOf(calendar, date),
      holidays: holidaysOn(calendar, date),
      moon: moonMark(calendar, dayNumber),
      leapDay: leapYear && i >= base,
      events: placed.filter(item => item.range.from <= dayNumber && item.range.to >= dayNumber).map(item => item.event),
      bars: placed.filter(item => item.range.from <= dayNumber && item.range.to >= dayNumber).map(item => ({ event: item.event, start: item.range.from === dayNumber, end: item.range.to === dayNumber })),
    };
  });
  const intercalary = !!calendar.months[month - 1].intercalary;
  const firstWeekday = days[0]?.weekday;
  const lead = intercalary || !firstWeekday ? 0 : Math.max(0, calendar.weekdays.indexOf(firstWeekday));
  return { year, month, name: calendar.months[month - 1].name, intercalary, leapYear, days, lead };
}

/** Where to open the grid: the first dated event, else the given day. */
export function calendarStart(calendar: WorldCalendar, kind: CalendarKind, events: readonly TimelineEvent[], fallback: WorldDate): { year: number; month: number } {
  const first = events.map(event => eventDayRange(calendar, kind, event)?.from).filter((n): n is number => n !== undefined).sort((a, b) => a - b)[0];
  const date = first !== undefined ? fromDayNumber(calendar, first) : fallback;
  return { year: date.year, month: date.month ?? 1 };
}

/** One month on or back, across years. */
export function stepMonth(calendar: WorldCalendar, at: { year: number; month: number }, by: number): { year: number; month: number } {
  const count = calendar.months.length;
  let index = at.year * count + (at.month - 1) + by;
  const place = () => ({ year: Math.floor(index / count), month: (((index % count) + count) % count) + 1 });
  // A leap month is skipped in the years it does not exist.
  for (let guard = 0; guard < count && daysInMonth(calendar, place().year, place().month) === 0; guard++) index += by < 0 ? -1 : 1;
  return place();
}

/** Days between two dates (positive when the second is later). */
export function daysBetween(calendar: WorldCalendar, a: WorldDate, b: WorldDate): number {
  return toDayNumber(calendar, b) - toDayNumber(calendar, a);
}
