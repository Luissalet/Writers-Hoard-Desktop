// ============================================================================
// World calendars — invented calendars for a story world
// ============================================================================
//
// A project may define its own calendar: named months of any length, its own
// week, eras, moons with their own periods, fixed holidays and a leap rule.
// Timeline events can then be dated in that calendar ("12 Frostfall 431 TE")
// instead of free text or a real ISO date.
//
// Everything here is pure and deterministic. Dates are kept as an absolute
// year (any integer, year 1 is the first year of the calendar's count) plus an
// optional month and day, so a date can be partial ("Frostfall 431", "431").
// The day number is the count of days since the first day of year 1 (which is
// day 0); it orders dates, measures distances and drives weekdays and moons.

export const WORLD_CALENDAR_SCHEMA = 'writers.world-calendar/1';

export interface WorldMonth {
  name: string;
  days: number;
  /**
   * Days outside the week cycle (festival days between months): they have no
   * weekday and do not advance it.
   */
  intercalary?: boolean;
}

export interface WorldEra {
  name: string;
  abbr: string;
  /** Absolute year the era begins. */
  startYear: number;
  /**
   * Counts backwards towards the next era (like "before the founding"): the
   * year just before the next era is 1. Only valid on an era that has a next one.
   */
  countdown?: boolean;
}

export interface WorldMoon {
  name: string;
  /** Days from new moon to new moon; may be fractional (29.53). */
  periodDays: number;
  /** Day number of a new moon. Default 0. */
  newMoonDay?: number;
}

export interface WorldHoliday {
  name: string;
  /** 1-based month index. */
  month: number;
  day: number;
}

export interface WorldLeapRule {
  /** A year is leap when (year - offset) is a multiple of `every`. */
  every: number;
  offset?: number;
  /** 1-based month that gains the extra days. */
  month: number;
  extraDays: number;
}

export interface WorldCalendar {
  schema: typeof WORLD_CALENDAR_SCHEMA;
  name: string;
  months: WorldMonth[];
  weekdays: string[];
  /** Weekday index (0-based) of day 0. Default 0. */
  weekdayOffset?: number;
  eras: WorldEra[];
  moons: WorldMoon[];
  holidays: WorldHoliday[];
  leap?: WorldLeapRule;
}

export interface WorldDate {
  /** Absolute year. */
  year: number;
  /** 1-based; absent for a year-only date. */
  month?: number;
  /** 1-based; absent for a month-only or year-only date. */
  day?: number;
  /** "Around" this date. */
  approx?: boolean;
}

export type MoonPhase =
  | 'new' | 'waxingCrescent' | 'firstQuarter' | 'waxingGibbous'
  | 'full' | 'waningGibbous' | 'lastQuarter' | 'waningCrescent';

export interface MoonState {
  name: string;
  phase: MoonPhase;
  /** 0 = new, 0.5 = full. */
  fraction: number;
  /** Lit portion, 0..1. */
  illumination: number;
}

export interface WorldDateInfo {
  date: WorldDate;
  dayNumber: number;
  label: string;
  era: { name: string; abbr: string; year: number } | null;
  weekday: string | null;
  moons: MoonState[];
  holidays: string[];
  monthName: string | null;
  daysInMonth: number | null;
  daysInYear: number;
  leapYear: boolean;
}

// ── defaults ───────────────────────────────────────────────────────────────

/** A plain starting point: twelve months of 30 days, a seven-day week, one era and one moon. */
export function defaultWorldCalendar(name = 'Calendar'): WorldCalendar {
  return {
    schema: WORLD_CALENDAR_SCHEMA,
    name,
    months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
    weekdays: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
    weekdayOffset: 0,
    eras: [{ name: 'Common Era', abbr: 'CE', startYear: 1 }],
    moons: [{ name: 'Moon', periodDays: 29.5, newMoonDay: 0 }],
    holidays: [],
  };
}

// ── validation ─────────────────────────────────────────────────────────────

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Problems with a calendar, in plain English; empty means usable. */
export function validateWorldCalendar(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return ['The calendar must be an object.'];
  const cal = input as Partial<WorldCalendar>;
  if (cal.schema !== WORLD_CALENDAR_SCHEMA) errors.push(`schema must be "${WORLD_CALENDAR_SCHEMA}".`);
  if (!nonEmpty(cal.name)) errors.push('name is required.');
  if (!Array.isArray(cal.months) || cal.months.length === 0) errors.push('At least one month is required.');
  else {
    if (cal.months.length > 100) errors.push('At most 100 months.');
    cal.months.forEach((m, i) => {
      if (!m || !nonEmpty(m.name)) errors.push(`Month ${i + 1} needs a name.`);
      if (!m || !isInt(m.days) || m.days < 1 || m.days > 1000) errors.push(`Month ${i + 1} needs between 1 and 1000 days.`);
    });
    if (cal.months.every((m) => m?.intercalary)) errors.push('At least one month must be part of the week cycle.');
    const names = cal.months.map((m) => m?.name?.trim().toLowerCase());
    if (new Set(names).size !== names.length) errors.push('Month names must be different.');
  }
  if (!Array.isArray(cal.weekdays) || cal.weekdays.length === 0 || !cal.weekdays.every(nonEmpty)) {
    errors.push('At least one weekday name is required.');
  } else if (cal.weekdayOffset !== undefined && (!isInt(cal.weekdayOffset) || cal.weekdayOffset < 0 || cal.weekdayOffset >= cal.weekdays.length)) {
    errors.push('weekdayOffset must be a weekday index.');
  }
  if (!Array.isArray(cal.eras) || cal.eras.length === 0) errors.push('At least one era is required.');
  else {
    const sorted = [...cal.eras].sort((a, b) => a.startYear - b.startYear);
    sorted.forEach((e, i) => {
      if (!nonEmpty(e?.name) || !nonEmpty(e?.abbr)) errors.push('Every era needs a name and an abbreviation.');
      if (!isInt(e?.startYear)) errors.push(`Era "${e?.name ?? '?'}" needs an integer startYear.`);
      if (e?.countdown && i === sorted.length - 1) errors.push(`Era "${e.name}" counts down, so another era must follow it.`);
      if (i > 0 && sorted[i - 1].startYear === e.startYear) errors.push('Two eras cannot start the same year.');
    });
    const abbrs = cal.eras.map((e) => e?.abbr?.trim().toLowerCase());
    if (new Set(abbrs).size !== abbrs.length) errors.push('Era abbreviations must be different.');
  }
  if (!Array.isArray(cal.moons)) errors.push('moons must be a list (it may be empty).');
  else cal.moons.forEach((m) => {
    if (!nonEmpty(m?.name) || typeof m?.periodDays !== 'number' || !(m.periodDays > 1) || m.periodDays > 100000) {
      errors.push(`Moon "${m?.name ?? '?'}" needs a name and a period above 1 day.`);
    }
  });
  if (!Array.isArray(cal.holidays)) errors.push('holidays must be a list (it may be empty).');
  else if (Array.isArray(cal.months)) cal.holidays.forEach((h) => {
    const month = cal.months![h?.month - 1];
    if (!nonEmpty(h?.name) || !month || !isInt(h.day) || h.day < 1 || h.day > month.days) {
      errors.push(`Holiday "${h?.name ?? '?'}" must fall on an existing month and day.`);
    }
  });
  if (cal.leap !== undefined && cal.leap !== null) {
    const l = cal.leap;
    if (!isInt(l.every) || l.every < 1) errors.push('leap.every must be a positive integer.');
    if (!isInt(l.extraDays) || l.extraDays < 1 || l.extraDays > 1000) errors.push('leap.extraDays must be between 1 and 1000.');
    if (!Array.isArray(cal.months) || !cal.months[l.month - 1]) errors.push('leap.month must be an existing month.');
    if (l.offset !== undefined && !isInt(l.offset)) errors.push('leap.offset must be an integer.');
  }
  return errors;
}

// ── year arithmetic ────────────────────────────────────────────────────────

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Leap years in (-inf, n], counted relative so differences are exact. */
function leapIndex(cal: WorldCalendar, n: number): number {
  return cal.leap ? floorDiv(n - (cal.leap.offset ?? 0), cal.leap.every) : 0;
}

export function isLeapYear(cal: WorldCalendar, year: number): boolean {
  return !!cal.leap && mod(year - (cal.leap.offset ?? 0), cal.leap.every) === 0;
}

const baseYearDays = (cal: WorldCalendar) => cal.months.reduce((s, m) => s + m.days, 0);

export function daysInYear(cal: WorldCalendar, year: number): number {
  return baseYearDays(cal) + (isLeapYear(cal, year) ? cal.leap!.extraDays : 0);
}

export function daysInMonth(cal: WorldCalendar, year: number, month: number): number {
  const m = cal.months[month - 1];
  if (!m) throw new RangeError(`No month ${month}.`);
  return m.days + (cal.leap && cal.leap.month === month && isLeapYear(cal, year) ? cal.leap.extraDays : 0);
}

/** Day number of the first day of `year`. */
function yearStart(cal: WorldCalendar, year: number): number {
  const extra = cal.leap ? cal.leap.extraDays * (leapIndex(cal, year - 1) - leapIndex(cal, 0)) : 0;
  return (year - 1) * baseYearDays(cal) + extra;
}

/** Throws when the date does not exist in the calendar. */
export function assertValidDate(cal: WorldCalendar, date: WorldDate): void {
  if (!isInt(date.year)) throw new RangeError('The year must be an integer.');
  if (date.month === undefined) {
    if (date.day !== undefined) throw new RangeError('A day needs a month.');
    return;
  }
  if (!isInt(date.month) || date.month < 1 || date.month > cal.months.length) {
    throw new RangeError(`There is no month ${date.month}; the calendar has ${cal.months.length}.`);
  }
  if (date.day === undefined) return;
  const max = daysInMonth(cal, date.year, date.month);
  if (!isInt(date.day) || date.day < 1 || date.day > max) {
    throw new RangeError(`${cal.months[date.month - 1].name} ${date.year} has ${max} days, not ${date.day}.`);
  }
}

/** First day of the (possibly partial) date. */
export function toDayNumber(cal: WorldCalendar, date: WorldDate): number {
  assertValidDate(cal, date);
  let n = yearStart(cal, date.year);
  const month = date.month ?? 1;
  for (let m = 1; m < month; m++) n += daysInMonth(cal, date.year, m);
  return n + (date.day ?? 1) - 1;
}

/** Last day covered by the (possibly partial) date. */
export function toLastDayNumber(cal: WorldCalendar, date: WorldDate): number {
  if (date.month === undefined) return yearStart(cal, date.year + 1) - 1;
  if (date.day === undefined) return toDayNumber(cal, { year: date.year, month: date.month, day: 1 }) + daysInMonth(cal, date.year, date.month) - 1;
  return toDayNumber(cal, date);
}

export function fromDayNumber(cal: WorldCalendar, n: number): WorldDate {
  if (!isInt(n)) throw new RangeError('A day number must be an integer.');
  const base = baseYearDays(cal);
  let year = floorDiv(n, base) + 1;
  while (yearStart(cal, year) > n) year--;
  while (yearStart(cal, year + 1) <= n) year++;
  let rest = n - yearStart(cal, year);
  for (let m = 1; m <= cal.months.length; m++) {
    const len = daysInMonth(cal, year, m);
    if (rest < len) return { year, month: m, day: rest + 1 };
    rest -= len;
  }
  throw new Error('Day number out of the year (calendar inconsistent).');
}

export function addDays(cal: WorldCalendar, date: WorldDate, days: number): WorldDate {
  return fromDayNumber(cal, toDayNumber(cal, date) + days);
}

export function compareWorldDates(cal: WorldCalendar, a: WorldDate, b: WorldDate): number {
  return toDayNumber(cal, a) - toDayNumber(cal, b) || toLastDayNumber(cal, a) - toLastDayNumber(cal, b);
}

// ── weekdays, moons, holidays, eras ────────────────────────────────────────

/** Intercalary days in years [1, year-1] relative to year 1 (negative before it). */
function intercalaryBefore(cal: WorldCalendar, year: number): number {
  const fixed = cal.months.reduce((s, m) => s + (m.intercalary ? m.days : 0), 0);
  const leapMonthIntercalary = cal.leap && cal.months[cal.leap.month - 1]?.intercalary;
  const leaps = leapMonthIntercalary ? cal.leap!.extraDays * (leapIndex(cal, year - 1) - leapIndex(cal, 0)) : 0;
  return (year - 1) * fixed + leaps;
}

/** Weekday name, or null on an intercalary day. */
export function weekdayOf(cal: WorldCalendar, date: WorldDate): string | null {
  if (date.month === undefined || date.day === undefined) return null;
  if (cal.months[date.month - 1].intercalary) return null;
  const n = toDayNumber(cal, date);
  let skipped = intercalaryBefore(cal, date.year);
  for (let m = 1; m < date.month; m++) if (cal.months[m - 1].intercalary) skipped += daysInMonth(cal, date.year, m);
  const counted = n - skipped;
  return cal.weekdays[mod(counted + (cal.weekdayOffset ?? 0), cal.weekdays.length)];
}

const PHASES: MoonPhase[] = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'];

export function moonsOn(cal: WorldCalendar, dayNumber: number): MoonState[] {
  return cal.moons.map((moon) => {
    const fraction = mod(dayNumber - (moon.newMoonDay ?? 0), moon.periodDays) / moon.periodDays;
    return {
      name: moon.name,
      fraction: Math.round(fraction * 1000) / 1000,
      illumination: Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 1000) / 1000,
      phase: PHASES[mod(Math.round(fraction * 8), 8)],
    };
  });
}

export function holidaysOn(cal: WorldCalendar, date: WorldDate): string[] {
  if (date.month === undefined || date.day === undefined) return [];
  return cal.holidays.filter((h) => h.month === date.month && h.day === date.day).map((h) => h.name);
}

const erasAscending = (cal: WorldCalendar) => [...cal.eras].sort((a, b) => a.startYear - b.startYear);

/** Era and year within it; years before the first era count in the first era as 0, -1… */
export function eraOf(cal: WorldCalendar, year: number): { era: WorldEra; year: number } {
  const eras = erasAscending(cal);
  let index = 0;
  for (let i = 0; i < eras.length; i++) if (eras[i].startYear <= year) index = i;
  const era = eras[index];
  if (era.countdown && eras[index + 1]) return { era, year: eras[index + 1].startYear - year };
  return { era, year: year - era.startYear + 1 };
}

/** Absolute year from a year counted in an era (by name or abbreviation). */
export function absoluteYear(cal: WorldCalendar, eraRef: string, yearInEra: number): number {
  const eras = erasAscending(cal);
  const ref = eraRef.trim().toLowerCase();
  const index = eras.findIndex((e) => e.abbr.toLowerCase() === ref || e.name.toLowerCase() === ref);
  if (index < 0) throw new RangeError(`No era "${eraRef}". Eras: ${eras.map((e) => e.abbr).join(', ')}.`);
  const era = eras[index];
  if (era.countdown && eras[index + 1]) return eras[index + 1].startYear - yearInEra;
  return era.startYear + yearInEra - 1;
}

// ── text ───────────────────────────────────────────────────────────────────

export function formatWorldDate(cal: WorldCalendar, date: WorldDate): string {
  const { era, year } = eraOf(cal, date.year);
  const parts: string[] = [];
  if (date.day !== undefined) parts.push(String(date.day));
  if (date.month !== undefined) parts.push(cal.months[date.month - 1]?.name ?? `#${date.month}`);
  parts.push(`${year} ${era.abbr}`);
  return `${date.approx ? 'c. ' : ''}${parts.join(' ')}`;
}

export function formatWorldRange(cal: WorldCalendar, start: WorldDate, end?: WorldDate): string {
  return end ? `${formatWorldDate(cal, start)} – ${formatWorldDate(cal, end)}` : formatWorldDate(cal, start);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Read a date written for this calendar. Accepted shapes (era optional when
 * the calendar has a single era, otherwise the absolute year is assumed):
 * "12 Frostfall 431 TE", "Frostfall 431 TE", "431 TE", "12/3/431 TE",
 * "c. 431 TE" or "~431" (approximate), and a bare absolute year "-20".
 */
export function parseWorldDate(cal: WorldCalendar, text: string): WorldDate | null {
  let s = text.trim();
  if (!s) return null;
  let approx = false;
  const approxMatch = s.match(/^(c\.|ca\.|circa|~|h\.|hacia)\s*/i);
  if (approxMatch) { approx = true; s = s.slice(approxMatch[0].length); }
  s = s.replace(/\s+de\s+/gi, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  let eraRef: string | null = null;
  for (const era of cal.eras) {
    for (const ref of [era.abbr, era.name]) {
      const re = new RegExp(`\\s${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (re.test(` ${s}`) && (!eraRef || ref.length > eraRef.length)) eraRef = ref;
    }
  }
  if (eraRef) s = s.slice(0, s.length - eraRef.length).trim();

  let day: number | undefined;
  let month: number | undefined;
  let yearText: string;
  const numeric = s.match(/^(\d{1,4})\/(\d{1,3})\/(-?\d+)$/);
  if (numeric) {
    day = Number(numeric[1]); month = Number(numeric[2]); yearText = numeric[3];
  } else {
    const yearMatch = s.match(/(-?\d+)$/);
    if (!yearMatch) return null;
    yearText = yearMatch[1];
    let head = s.slice(0, s.length - yearMatch[0].length).trim();
    const dayMatch = head.match(/^(\d{1,4})\s+/);
    if (dayMatch) { day = Number(dayMatch[1]); head = head.slice(dayMatch[0].length).trim(); }
    if (head) {
      const index = cal.months.findIndex((m) => fold(m.name) === fold(head));
      if (index < 0) return null;
      month = index + 1;
    } else if (day !== undefined) return null;
  }
  const yearNumber = Number(yearText);
  if (!Number.isInteger(yearNumber)) return null;
  let year: number;
  if (eraRef) year = absoluteYear(cal, eraRef, yearNumber);
  else if (cal.eras.length === 1) year = absoluteYear(cal, cal.eras[0].abbr, yearNumber);
  else year = yearNumber;
  const date: WorldDate = { year, ...(month !== undefined ? { month } : {}), ...(day !== undefined ? { day } : {}), ...(approx ? { approx } : {}) };
  try { assertValidDate(cal, date); } catch { return null; }
  return date;
}

export function describeWorldDate(cal: WorldCalendar, date: WorldDate): WorldDateInfo {
  const dayNumber = toDayNumber(cal, date);
  const { era, year } = eraOf(cal, date.year);
  const exact = date.month !== undefined && date.day !== undefined;
  return {
    date,
    dayNumber,
    label: formatWorldDate(cal, date),
    era: { name: era.name, abbr: era.abbr, year },
    weekday: weekdayOf(cal, date),
    moons: exact ? moonsOn(cal, dayNumber) : [],
    holidays: holidaysOn(cal, date),
    monthName: date.month !== undefined ? cal.months[date.month - 1].name : null,
    daysInMonth: date.month !== undefined ? daysInMonth(cal, date.year, date.month) : null,
    daysInYear: daysInYear(cal, date.year),
    leapYear: isLeapYear(cal, date.year),
  };
}

/** Validate a range: the end may not start before the start. Returns an error or null. */
export function validateWorldRange(cal: WorldCalendar, start: WorldDate, end?: WorldDate): string | null {
  try {
    assertValidDate(cal, start);
    if (end) {
      assertValidDate(cal, end);
      if (toLastDayNumber(cal, end) < toDayNumber(cal, start)) return 'The end comes before the start.';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
