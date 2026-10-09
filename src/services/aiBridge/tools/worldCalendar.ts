// ============================================================================
// AI bridge tools — the project's world calendar
// ============================================================================

import { db } from '@/db';
import {
  absoluteYear, addDays, describeWorldDate, fromDayNumber, parseWorldDate, toDayNumber,
  validateWorldCalendar, WORLD_CALENDAR_SCHEMA, type WorldCalendar, type WorldDate,
} from '@/engines/timeline/worldCalendar';
import { resolveWorldCalendar, saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import {
  BridgeError, optBoolean, optNumber, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs,
} from './shared';

/** The calendar a project uses (its own or its saga's), or a clear error. */
export async function requireWorldCalendar(projectId: string): Promise<WorldCalendar> {
  const resolved = await resolveWorldCalendar(projectId);
  if (!resolved) {
    throw new BridgeError(
      'not-found',
      'This project has no world calendar yet. Define one with wh_world_calendar_set, or date the event with dateMode "text".',
    );
  }
  return resolved.calendar;
}

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
    const eraYear = int('eraYear') ?? int('year');
    if (eraYear === undefined || !Number.isInteger(eraYear)) throw new BridgeError('bad-args', `"${key}.eraYear" is required with an era.`);
    try { year = absoluteYear(calendar, raw.era, eraYear); } catch (error) { throw new BridgeError('bad-args', (error as Error).message); }
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

export async function whWorldCalendarGet(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', `No project with id "${projectId}".`);
  const resolved = await resolveWorldCalendar(projectId);
  if (!resolved) return { projectId, calendar: null, hint: 'No world calendar. wh_world_calendar_set defines one.' };
  return {
    projectId,
    calendar: resolved.calendar,
    inheritedFrom: resolved.inherited ? resolved.ownerProjectId : undefined,
    daysInCommonYear: resolved.calendar.months.reduce((sum, m) => sum + m.days, 0),
  };
}

export async function whWorldCalendarSet(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'timeline');
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', `No project with id "${projectId}".`);
  if (optBoolean(args, 'remove')) {
    if (!project.worldCalendar) throw new BridgeError('bad-args', 'This project has no calendar of its own to remove.');
    const dated = await db.timelineEvents.where('projectId').equals(projectId).filter((e) => e.dateMode === 'world').count();
    await saveWorldCalendar(projectId, null);
    return withAudit(
      { projectId, removed: true, worldDatedEventsKeepTheirLabel: dated },
      { projectId, entityId: projectId, summary: 'removed the world calendar', kind: 'update' },
    );
  }
  const input = args.calendar;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BridgeError('bad-args', '"calendar" is required: { name, months, weekdays, eras, moons, holidays, leap? }.');
  }
  const calendar = { schema: WORLD_CALENDAR_SCHEMA, moons: [], holidays: [], ...(input as object) } as unknown as WorldCalendar;
  const errors = validateWorldCalendar(calendar);
  if (errors.length) throw new BridgeError('bad-args', `The calendar is not valid: ${errors.join(' ')}`);
  // Refuse a change that would leave existing world dates pointing at days that no longer exist.
  const events = await db.timelineEvents.where('projectId').equals(projectId).filter((e) => e.dateMode === 'world').toArray();
  const broken = events.filter((event) => {
    try {
      if (event.worldDate) toDayNumber(calendar, event.worldDate);
      if (event.worldDateEnd) toDayNumber(calendar, event.worldDateEnd);
      return false;
    } catch {
      return true;
    }
  });
  if (broken.length && !optBoolean(args, 'force')) {
    throw new BridgeError(
      'conflict',
      `${broken.length} event(s) would fall on dates this calendar does not have: ${broken.slice(0, 5).map((e) => `"${e.title}"`).join(', ')}. Fix them first or pass force:true (they keep their label but leave the date axis).`,
    );
  }
  await saveWorldCalendar(projectId, calendar);
  return withAudit(
    { projectId, saved: true, months: calendar.months.length, eras: calendar.eras.length, moons: calendar.moons.length, eventsLeftWithoutAValidDate: broken.length },
    { projectId, entityId: projectId, summary: `set the world calendar "${calendar.name}"`, kind: 'update', before: project.worldCalendar ? { worldCalendar: project.worldCalendar } : undefined },
  );
}

export async function whWorldDate(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const calendar = await requireWorldCalendar(projectId);
  const dayNumber = optNumber(args, 'dayNumber');
  let date = dayNumber !== undefined
    ? (() => {
      if (!Number.isInteger(dayNumber)) throw new BridgeError('bad-args', '"dayNumber" must be an integer.');
      return fromDayNumber(calendar, dayNumber);
    })()
    : worldDateArg(calendar, args.date, 'date');
  if (!date) throw new BridgeError('bad-args', 'Pass "date" (text or { year, month, day }) or "dayNumber".');
  const plusDays = optNumber(args, 'plusDays');
  if (plusDays !== undefined) {
    if (!Number.isInteger(plusDays)) throw new BridgeError('bad-args', '"plusDays" must be an integer.');
    date = addDays(calendar, { ...date, month: date.month ?? 1, day: date.day ?? 1 }, plusDays);
  }
  const info = describeWorldDate(calendar, date);
  const to = worldDateArg(calendar, args.to, 'to');
  return {
    projectId,
    calendar: calendar.name,
    ...info,
    ...(to ? { to: describeWorldDate(calendar, to).label, daysBetween: toDayNumber(calendar, to) - info.dayNumber } : {}),
  };
}
