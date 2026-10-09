// Pure logic of world calendars: day numbers, partial dates, leap rule,
// intercalary days, weekdays, moons, eras, parsing and formatting.
import {
  WORLD_CALENDAR_SCHEMA, absoluteYear, addDays, compareWorldDates, daysInMonth, daysInYear,
  defaultWorldCalendar, describeWorldDate, eraOf, formatWorldDate, formatWorldRange, fromDayNumber,
  isLeapYear, moonsOn, parseWorldDate, toDayNumber, toLastDayNumber, validateWorldCalendar,
  validateWorldRange, weekdayOf, type WorldCalendar, type WorldDate,
} from '../src/engines/timeline/worldCalendar';
import { worldDateArg } from '../src/services/aiBridge/tools/worldDateArg';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function same(actual: unknown, expected: unknown, message: string): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

/** A fantasy calendar with everything switched on. */
export function fantasyCalendar(): WorldCalendar {
  return {
    schema: WORLD_CALENDAR_SCHEMA,
    name: 'Reckoning of the Vale',
    months: [
      { name: 'Frostfall', days: 30 },
      { name: 'Thaw', days: 30 },
      { name: 'Midsummer', days: 3, intercalary: true },
      { name: 'Highsun', days: 31 },
      { name: 'Harvest', days: 30 },
    ],
    weekdays: ['Moonday', 'Ironday', 'Wellday', 'Restday', 'Fireday'],
    weekdayOffset: 2,
    eras: [
      { name: 'Before the Crown', abbr: 'BC', startYear: -1000, countdown: true },
      { name: 'Age of the Crown', abbr: 'AC', startYear: 1 },
      { name: 'Twilight Era', abbr: 'TE', startYear: 501 },
    ],
    moons: [
      { name: 'Selis', periodDays: 28, newMoonDay: 3 },
      { name: 'Oru', periodDays: 41.5, newMoonDay: 0 },
    ],
    holidays: [
      { name: 'First Frost', month: 1, day: 1 },
      { name: 'Longest Day', month: 3, day: 2 },
    ],
    leap: { every: 4, offset: 0, month: 3, extraDays: 1 },
  };
}

function testValidation() {
  same(validateWorldCalendar(defaultWorldCalendar()), [], 'the default calendar is valid');
  same(validateWorldCalendar(fantasyCalendar()), [], 'the fantasy calendar is valid');
  const broken = { ...fantasyCalendar(), months: [{ name: 'A', days: 0 }, { name: 'a', days: 10 }], eras: [{ name: 'X', abbr: 'X', startYear: 1, countdown: true }] };
  const errors = validateWorldCalendar(broken);
  assert(errors.some((e) => e.includes('Month 1')), 'a month with 0 days is rejected');
  assert(errors.some((e) => e.includes('different')), 'duplicate month names are rejected');
  assert(errors.some((e) => e.includes('counts down')), 'a countdown era needs a following era');
  assert(errors.some((e) => e.includes('Holiday')), 'holidays on missing months are rejected');
  assert(validateWorldCalendar({ ...fantasyCalendar(), schema: 'x' }).length === 1, 'a wrong schema is reported');
}

function testYearArithmetic() {
  const cal = fantasyCalendar();
  equal(daysInYear(cal, 1), 124, 'a common year has 124 days');
  assert(isLeapYear(cal, 4) && isLeapYear(cal, 0) && isLeapYear(cal, -4), 'every fourth year is leap, before year 1 too');
  equal(daysInYear(cal, 4), 125, 'a leap year has one more day');
  equal(daysInMonth(cal, 4, 3), 4, 'the leap day goes to Midsummer');
  equal(toDayNumber(cal, { year: 1, month: 1, day: 1 }), 0, 'day 0 is the first day of year 1');
  equal(toDayNumber(cal, { year: 2 }), 124, 'year 2 starts after one common year');
  equal(toDayNumber(cal, { year: 5 }), 124 * 4 + 1, 'year 5 starts after a leap year');
  equal(toDayNumber(cal, { year: 0 }), -125, 'year 0 is leap and precedes year 1');
  equal(toLastDayNumber(cal, { year: 4, month: 3 }), toDayNumber(cal, { year: 4, month: 4, day: 1 }) - 1, 'a month-only date covers the whole month');
  for (const n of [-100000, -125, -1, 0, 1, 123, 124, 495, 496, 497, 62000, 999999]) {
    equal(toDayNumber(cal, fromDayNumber(cal, n)), n, `day ${n} round-trips`);
  }
  same(addDays(cal, { year: 3, month: 5, day: 30 }, 1), { year: 4, month: 1, day: 1 }, 'adding a day crosses the year');
  same(addDays(cal, { year: 4, month: 2, day: 30 }, 4), { year: 4, month: 3, day: 4 }, 'the leap day exists in year 4');
  let threw = false;
  try { toDayNumber(cal, { year: 3, month: 3, day: 4 }); } catch { threw = true; }
  assert(threw, 'Midsummer 4 does not exist in a common year');
}

function testWeekdays() {
  const cal = fantasyCalendar();
  equal(weekdayOf(cal, { year: 1, month: 1, day: 1 }), 'Wellday', 'day 0 takes the weekday offset');
  equal(weekdayOf(cal, { year: 1, month: 3, day: 1 }), null, 'intercalary days have no weekday');
  // Thaw 30 and Highsun 1 are consecutive in the week: Midsummer is skipped.
  const before = cal.weekdays.indexOf(weekdayOf(cal, { year: 7, month: 2, day: 30 })!);
  const after = cal.weekdays.indexOf(weekdayOf(cal, { year: 7, month: 4, day: 1 })!);
  equal((before + 1) % cal.weekdays.length, after, 'the week continues across Midsummer');
  // Across a leap year the cycle still advances one weekday per counted day.
  const last = cal.weekdays.indexOf(weekdayOf(cal, { year: 4, month: 5, day: 30 })!);
  const first = cal.weekdays.indexOf(weekdayOf(cal, { year: 5, month: 1, day: 1 })!);
  equal((last + 1) % cal.weekdays.length, first, 'the week continues across the new year');
  const negative = weekdayOf(cal, { year: -3, month: 1, day: 1 });
  assert(negative !== null && cal.weekdays.includes(negative), 'weekdays exist before year 1');
}

function testMoons() {
  const cal = fantasyCalendar();
  const [selis, oru] = moonsOn(cal, 3);
  equal(selis.phase, 'new', 'Selis is new on its new-moon day');
  equal(selis.illumination, 0, 'a new moon is dark');
  equal(moonsOn(cal, 17)[0].phase, 'full', 'half a period later Selis is full');
  equal(moonsOn(cal, 17)[0].illumination, 1, 'a full moon is lit');
  equal(moonsOn(cal, 10)[0].phase, 'firstQuarter', 'a quarter period later it is the first quarter');
  equal(oru.name, 'Oru', 'the second moon is reported');
  equal(moonsOn(cal, 3 - 28 * 100)[0].phase, 'new', 'phases repeat in the past');
  equal(moonsOn(cal, 83)[1].phase, 'new', 'fractional periods: Oru is new again after two periods');
}

function testEras() {
  const cal = fantasyCalendar();
  same(eraOf(cal, 1), { era: cal.eras[1], year: 1 }, 'year 1 is 1 AC');
  equal(eraOf(cal, 501).era.abbr, 'TE', 'year 501 opens the Twilight Era');
  equal(eraOf(cal, 501).year, 1, 'and is its year 1');
  equal(eraOf(cal, 0).era.abbr, 'BC', 'year 0 is in the countdown era');
  equal(eraOf(cal, 0).year, 1, 'the year just before the Crown is 1 BC');
  equal(eraOf(cal, -9).year, 10, 'counting down further back');
  equal(absoluteYear(cal, 'BC', 10), -9, 'the countdown era converts back');
  equal(absoluteYear(cal, 'twilight era', 3), 503, 'eras are found by name too');
  equal(eraOf(cal, -5000).era.abbr, 'BC', 'years before the first era fall in it');
}

function testText() {
  const cal = fantasyCalendar();
  const date: WorldDate = { year: 503, month: 4, day: 12 };
  equal(formatWorldDate(cal, date), '12 Highsun 3 TE', 'a full date is formatted with its era');
  equal(formatWorldDate(cal, { year: 0, approx: true }), 'c. 1 BC', 'approximate year-only dates');
  equal(formatWorldRange(cal, { year: 10, month: 1 }, { year: 11 }), 'Frostfall 10 AC – 11 AC', 'ranges');
  same(parseWorldDate(cal, '12 Highsun 3 TE'), date, 'a formatted date parses back');
  same(parseWorldDate(cal, '12 de highsun de 3 Twilight Era'), date, 'Spanish "de", case and era name');
  same(parseWorldDate(cal, 'Frostfall 10 AC'), { year: 10, month: 1 }, 'month and year');
  same(parseWorldDate(cal, 'c. 5 BC'), { year: -4, approx: true }, 'approximate countdown year');
  same(parseWorldDate(cal, '2/4/7 AC'), { year: 7, month: 4, day: 2 }, 'numeric day/month/year');
  same(parseWorldDate(cal, '-20'), { year: -20 }, 'a bare absolute year with several eras');
  equal(parseWorldDate(cal, '31 Thaw 7 AC'), null, 'a day beyond the month is refused');
  equal(parseWorldDate(cal, '3 Nowhere 7 AC'), null, 'an unknown month is refused');
  equal(parseWorldDate(cal, ''), null, 'empty text is no date');
  const single = { ...defaultWorldCalendar('Plain'), months: [{ name: 'Único', days: 365 }] };
  same(parseWorldDate(single, '4 unico 12'), { year: 12, month: 1, day: 4 }, 'a single era is implied; accents are folded');
  for (const n of [-4000, -1, 0, 777, 62011]) {
    const d = fromDayNumber(cal, n);
    same(parseWorldDate(cal, formatWorldDate(cal, d)), d, `day ${n} survives format and parse`);
  }
}

function testOrderingAndRanges() {
  const cal = fantasyCalendar();
  const dates: WorldDate[] = [{ year: 503 }, { year: 503, month: 1 }, { year: 2, month: 5, day: 3 }, { year: -40 }, { year: 503, month: 1, day: 2 }];
  const sorted = [...dates].sort((a, b) => compareWorldDates(cal, a, b)).map((d) => formatWorldDate(cal, d));
  same(sorted, ['41 BC', '3 Harvest 2 AC', 'Frostfall 3 TE', '3 TE', '2 Frostfall 3 TE'], 'partial dates sort by their first day, the narrower first');
  equal(validateWorldRange(cal, { year: 10 }, { year: 10, month: 2 }), null, 'an end inside the start year is fine');
  equal(validateWorldRange(cal, { year: 10, month: 2 }, { year: 9 }), 'The end comes before the start.', 'an end before the start is refused');
  assert(validateWorldRange(cal, { year: 1, month: 9 })?.includes('no month 9'), 'a missing month is explained');
  const info = describeWorldDate(cal, { year: 4, month: 1, day: 1 });
  equal(info.label, '1 Frostfall 4 AC', 'describe gives the label');
  same(info.holidays, ['First Frost'], 'and the holidays');
  equal(info.moons.length, 2, 'and every moon');
  equal(info.leapYear, true, 'and whether the year is leap');
  equal(describeWorldDate(cal, { year: 4 }).moons.length, 0, 'a partial date has no moon phase');
}

function throwsWith(fn: () => unknown, fragment: string, message: string): void {
  try {
    fn();
  } catch (error) {
    assert(String((error as Error).message).includes(fragment), `${message}: got ${(error as Error).message}`);
    return;
  }
  throw new Error(`${message}: did not throw`);
}

function testBridgeDates() {
  const cal = fantasyCalendar();
  same(worldDateArg(cal, { year: 503, month: 2, day: 4 }, 'date'), { year: 503, month: 2, day: 4 }, 'an absolute year passes through');
  equal(worldDateArg(cal, { era: 'TE', eraYear: 3 }, 'date')?.year, 503, 'an era year converts to absolute');
  equal(worldDateArg(cal, { era: 'TE', eraYear: 3, year: 503 }, 'date')?.year, 503, 'both, when they agree, are accepted');
  throwsWith(() => worldDateArg(cal, { era: 'TE', year: 503 }, 'date'), 'eraYear', 'an absolute year next to an era is never reinterpreted');
  throwsWith(() => worldDateArg(cal, { era: 'TE', eraYear: 3, year: 3 }, 'date'), 'absolute 503', 'a contradiction between year and eraYear is refused');
  throwsWith(() => worldDateArg(cal, { era: 'TE' }, 'date'), 'eraYear', 'an era needs its year');
  equal(worldDateArg(cal, '', 'date'), undefined, 'an empty value is no date');
}

export function runWorldCalendarLogicTests(): string[] {
  testValidation();
  testYearArithmetic();
  testWeekdays();
  testMoons();
  testEras();
  testText();
  testOrderingAndRanges();
  testBridgeDates();
  return ['validation', 'year arithmetic and round trips', 'weekdays across intercalary days and years', 'moons', 'eras', 'parse and format', 'ordering, ranges and describe', 'bridge date arguments'];
}
