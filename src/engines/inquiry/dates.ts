// ============================================
// Partial dates as comparable day ranges (pure)
// ============================================
//
// Sources rarely give an exact day, so every bound is kept the way it was
// written (`2019`, `2019-05`, `2019-05-12`) and compared through the earliest
// and latest day it can mean. That keeps "valid until 2019" meaning "through
// the end of 2019", and lets two fuzzy intervals be compared honestly.
//
// Days are whole numbers since 1970-01-01 (UTC arithmetic, no time of day), so
// nothing in here depends on the machine's timezone except `dayOfTimestamp`,
// which reads the local calendar on purpose: "today" is the writer's today.

import type { PartialDate } from './types';

export class PartialDateError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`Invalid date "${value}": use YYYY, YYYY-MM or YYYY-MM-DD.`);
    this.name = 'PartialDateError';
    this.value = value;
  }
}

export interface DayRange {
  start: number;
  end: number;
}

const PATTERN = /^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[T ].*)?$/;
const MS_PER_DAY = 86_400_000;

/** Day number of a calendar date, or null when it does not exist (Feb 30). */
function dayNumber(year: number, month: number, day: number): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / MS_PER_DAY);
}

function lastDayOfMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** Earliest and latest day a partial date can mean; null for an empty value. Throws PartialDateError. */
export function parsePartial(value: PartialDate | null | undefined): DayRange | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = PATTERN.exec(text);
  if (!match) throw new PartialDateError(text);
  const year = Number(match[1]);
  if (year < 1 || year > 9999) throw new PartialDateError(text);
  const month = match[2] === undefined ? undefined : Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  if (month === undefined) {
    return { start: dayNumber(year, 1, 1)!, end: dayNumber(year, 12, 31)! };
  }
  if (month < 1 || month > 12) throw new PartialDateError(text);
  if (day === undefined) {
    return { start: dayNumber(year, month, 1)!, end: dayNumber(year, month, lastDayOfMonth(year, month))! };
  }
  const exact = dayNumber(year, month, day);
  if (exact === null) throw new PartialDateError(text);
  return { start: exact, end: exact };
}

/** Canonical zero-padded text of a partial date, or undefined for an empty one. Throws PartialDateError. */
export function normalizePartial(value: PartialDate | null | undefined): PartialDate | undefined {
  if (value === null || value === undefined || !String(value).trim()) return undefined;
  const text = String(value).trim();
  parsePartial(text);
  const match = PATTERN.exec(text)!;
  let out = String(Number(match[1])).padStart(4, '0');
  if (match[2] !== undefined) {
    out += `-${String(Number(match[2])).padStart(2, '0')}`;
    if (match[3] !== undefined) out += `-${String(Number(match[3])).padStart(2, '0')}`;
  }
  return out;
}

/** True when the text is a valid partial date (empty counts as valid: "no date"). */
export function isPartialDate(value: string | null | undefined): boolean {
  try {
    parsePartial(value);
    return true;
  } catch {
    return false;
  }
}

export function startDay(value: PartialDate | null | undefined): number | null {
  return parsePartial(value)?.start ?? null;
}

export function endDay(value: PartialDate | null | undefined): number | null {
  return parsePartial(value)?.end ?? null;
}

/** Was something valid over [from, to] true on `asOf`? Open bounds are open; no `asOf` means yes. */
export function containsDate(
  validFrom: PartialDate | null | undefined,
  validTo: PartialDate | null | undefined,
  asOf: PartialDate | null | undefined,
): boolean {
  const point = parsePartial(asOf);
  if (!point) return true;
  const lo = startDay(validFrom);
  const hi = endDay(validTo);
  if (lo !== null && lo > point.end) return false;
  if (hi !== null && hi < point.start) return false;
  return true;
}

/** Do two validity intervals share a day? Unknown bounds are open, so they may overlap. */
export function intervalsOverlap(
  aFrom: PartialDate | null | undefined,
  aTo: PartialDate | null | undefined,
  bFrom: PartialDate | null | undefined,
  bTo: PartialDate | null | undefined,
): boolean {
  const aLo = startDay(aFrom);
  const aHi = endDay(aTo);
  const bLo = startDay(bFrom);
  const bHi = endDay(bTo);
  if (aHi !== null && bLo !== null && aHi < bLo) return false;
  if (bHi !== null && aLo !== null && bHi < aLo) return false;
  return true;
}

/** Timeline order: dated things by earliest day, undated last. */
export function sortKey(value: PartialDate | null | undefined): number {
  return startDay(value) ?? Number.POSITIVE_INFINITY;
}

/** The writer's calendar day for a timestamp, as a day number. */
export function dayOfTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate())!;
}

/** `YYYY-MM-DD` for a day number. */
export function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The first day a free-text bibliographic date can mean, or null. Citations
 * carry `publishedAt` as typed, so anything that is not a partial ISO date
 * falls back to the first four-digit year in the text ("March 2019" → 2019).
 */
export function looseStartDay(value: string | null | undefined): number | null {
  if (!value) return null;
  try {
    const strict = startDay(value);
    if (strict !== null) return strict;
  } catch {
    /* fall through to the year scan */
  }
  const year = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(value);
  return year ? startDay(year[1]) : null;
}
