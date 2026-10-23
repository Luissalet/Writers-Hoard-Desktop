// ============================================
// Calendar lens — the same instant on the world calendar and the Earth one
// ============================================
// A world calendar may say which of its days falls on which Gregorian day
// (its correlation). From that one pair every date converts both ways, so a
// timeline can be read through either calendar: events dated on the world
// calendar show on the Earth one and events with real dates on the world one.

import { defaultWorldCalendar, fromDayNumber, toDayNumber, type WorldCalendar, type WorldDate } from './worldCalendar';

/** The Gregorian calendar for day counting (names do not matter here; the views use their own). */
function gregorian(): WorldCalendar {
  const calendar = defaultWorldCalendar('Gregorian');
  calendar.months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, index) => ({ name: `M${index + 1}`, days }));
  calendar.leap = { every: 4, month: 2, extraDays: 1, exceptEvery: 100, restoreEvery: 400 };
  calendar.eras = [{ name: 'Common Era', abbr: 'CE', startYear: 1 }];
  return calendar;
}

export interface CalendarLens {
  world: WorldCalendar;
  earth: WorldCalendar;
  /** Earth day number = world day number + offset. */
  offset: number;
}

const ISO = /^(-?\d{1,6})-(\d{2})-(\d{2})$/;

export function isoDate(value: string): WorldDate | null {
  const match = ISO.exec(value.trim());
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

export function toIso(date: WorldDate): string {
  const year = date.year < 0 ? `-${String(-date.year).padStart(4, '0')}` : String(date.year).padStart(4, '0');
  return `${year}-${String(date.month ?? 1).padStart(2, '0')}-${String(date.day ?? 1).padStart(2, '0')}`;
}

/** The lens of a world calendar with a correlation, or null without one (or with one that no longer fits). */
export function calendarLens(world: WorldCalendar | null | undefined): CalendarLens | null {
  const correlation = world?.correlation;
  if (!world || !correlation) return null;
  try {
    const earth = gregorian();
    const day = isoDate(correlation.earth);
    if (!day) return null;
    return { world, earth, offset: toDayNumber(earth, day) - toDayNumber(world, correlation.date) };
  } catch {
    return null;
  }
}

/** The Gregorian day (YYYY-MM-DD) of a world date's first day. */
export function worldToEarth(lens: CalendarLens, date: WorldDate): string {
  return toIso(fromDayNumber(lens.earth, toDayNumber(lens.world, date) + lens.offset));
}

/** The world date of a Gregorian day. */
export function earthToWorld(lens: CalendarLens, iso: string): WorldDate {
  const day = isoDate(iso);
  if (!day) throw new RangeError('An Earth date is YYYY-MM-DD.');
  return fromDayNumber(lens.world, toDayNumber(lens.earth, day) - lens.offset);
}
