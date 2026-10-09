// A world date read from a tool argument. Pure: no database, no DOM.
import { absoluteYear, parseWorldDate, toDayNumber, type WorldCalendar, type WorldDate } from '@/engines/timeline/worldCalendar';
import { BridgeError } from './bridgeError';

/**
 * A world date from a tool argument: text in the calendar ("12 Frostfall 431 TE")
 * or an object { year, month?, day?, approx? } where `year` is absolute, or
 * { era, eraYear, month?, day? } counted in an era.
 */
export function worldDateArg(calendar: WorldCalendar, value: unknown, key: string): WorldDate | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') {
    const parsed = parseWorldDate(calendar, value);
    if (!parsed) {
      throw new BridgeError(
        'bad-args',
        `"${key}" ("${value}") is not a date in "${calendar.name}". Write it like "12 ${calendar.months[0].name} 3 ${calendar.eras[0].abbr}", "${calendar.months[0].name} 3", "3 ${calendar.eras[0].abbr}", or pass { year, month, day }.`,
      );
    }
    return parsed;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError('bad-args', `"${key}" must be text or an object { year, month, day }.`);
  }
  const raw = value as Record<string, unknown>;
  const int = (k: string) => (raw[k] === undefined ? undefined : Number(raw[k]));
  let year = int('year');
  if (typeof raw.era === 'string') {
    // `year` is always the absolute year; with an era the count inside it must be explicit,
    // so an absolute year sent next to an era is never reinterpreted silently.
    if (raw.year !== undefined && raw.eraYear === undefined) {
      throw new BridgeError('bad-args', `"${key}": with an era pass "eraYear" (the year counted in that era); "year" is the absolute year and cannot be combined with "era".`);
    }
    const eraYear = int('eraYear');
    if (eraYear === undefined || !Number.isInteger(eraYear)) throw new BridgeError('bad-args', `"${key}.eraYear" is required with an era.`);
    let absolute: number;
    try { absolute = absoluteYear(calendar, raw.era, eraYear); } catch (error) { throw new BridgeError('bad-args', (error as Error).message); }
    if (year !== undefined && year !== absolute) {
      throw new BridgeError('bad-args', `"${key}": year ${year} is not ${eraYear} ${raw.era} (absolute ${absolute}); send one of them.`);
    }
    year = absolute;
  }
  if (year === undefined || !Number.isInteger(year)) throw new BridgeError('bad-args', `"${key}.year" must be an integer.`);
  const date: WorldDate = { year };
  const month = int('month');
  const day = int('day');
  if (month !== undefined) date.month = month;
  if (day !== undefined) date.day = day;
  if (raw.approx === true) date.approx = true;
  try {
    toDayNumber(calendar, date);
  } catch (error) {
    throw new BridgeError('bad-args', `"${key}": ${(error as Error).message}`);
  }
  return date;
}
