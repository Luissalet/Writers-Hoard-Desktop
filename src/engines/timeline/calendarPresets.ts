import { getSetting, updateSetting } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { defaultWorldCalendar, validateWorldCalendar, type WorldCalendar } from './worldCalendar';

export interface CalendarPreset { id: string; name: string; calendar: WorldCalendar; createdAt: number }
export const CALENDAR_PRESETS_KEY = 'world_calendar_presets_v1';
const clone = (calendar: WorldCalendar): WorldCalendar => JSON.parse(JSON.stringify(calendar)) as WorldCalendar;
export function parseCalendarPresets(value?: string): CalendarPreset[] {
  try {
    const values: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(values) ? values.filter((value): value is CalendarPreset => !!value && typeof value === 'object' && typeof value.id === 'string' && typeof value.name === 'string' && value.name.trim().length > 0 && typeof value.createdAt === 'number' && validateWorldCalendar(value.calendar).length === 0) : [];
  } catch { return []; }
}
export async function loadCalendarPresets(): Promise<CalendarPreset[]> { return parseCalendarPresets(await getSetting(CALENDAR_PRESETS_KEY)); }
export async function saveCalendarPreset(name: string, calendar: WorldCalendar): Promise<CalendarPreset> {
  if (!name.trim() || name.length > 100 || validateWorldCalendar(calendar).length) throw new Error('Invalid calendar preset');
  const preset = { id: generateId('calpreset'), name: name.trim(), calendar: clone(calendar), createdAt: Date.now() };
  await updateSetting(CALENDAR_PRESETS_KEY, raw => {
    const current = parseCalendarPresets(raw);
    if (current.length >= 100) throw new Error('At most 100 local calendar presets');
    return JSON.stringify([...current, preset]);
  });
  return preset;
}
export async function deleteCalendarPreset(id: string): Promise<void> {
  await updateSetting(CALENDAR_PRESETS_KEY, raw => JSON.stringify(parseCalendarPresets(raw).filter(preset => preset.id !== id)));
}
export function earthCalendar(locale: 'es' | 'en'): WorldCalendar {
  const calendar = defaultWorldCalendar(locale === 'es' ? 'Gregoriano' : 'Gregorian');
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  calendar.hoursPerDay = 24;
  calendar.months = days.map((length, month) => ({ name: new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month, 1))), days: length }));
  calendar.weekdays = Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, day + 3))));
  calendar.leap = { every: 4, month: 2, extraDays: 1, exceptEvery: 100, restoreEvery: 400 };
  calendar.eras = [{ name: locale === 'es' ? 'Era común' : 'Common Era', abbr: locale === 'es' ? 'EC' : 'CE', startYear: 1 }];
  return calendar;
}
