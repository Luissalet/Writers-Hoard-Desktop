// World calendar: weeks that restart every month, the moon's colour and which
// phases the calendar marks — in the model, the Calendar view and the bridge.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import CalendarView from '@/engines/timeline/components/CalendarView';
import { calendarMonth } from '@/engines/timeline/calendarGrid';
import { WORLD_CALENDAR_SCHEMA, validateWorldCalendar, weekdayOf, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testWorldCalendarWeeksMoons(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const calendar: WorldCalendar = { schema: WORLD_CALENDAR_SCHEMA, name: 'Calendario de la Sal', months: [{ name: 'Brumal', days: 30 }, { name: 'Escarcha', days: 30 }], weekdays: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete'], eras: [{ name: 'Era de la Sal', abbr: 'ES', startYear: 1 }], moons: [{ name: 'Selene', periodDays: 28, newMoonDay: 0, color: '#c0504d' }], holidays: [] } as WorldCalendar;
  assert(validateWorldCalendar(calendar).length === 0, validateWorldCalendar(calendar).join());
  assert(validateWorldCalendar({ ...calendar, weekMode: 'odd' }).length === 1 && validateWorldCalendar({ ...calendar, moons: [{ name: 'X', periodDays: 20, color: 'red' }] }).length === 1, 'Bad values refused');
  const continuous = weekdayOf(calendar, { year: 1, month: 2, day: 1 }), restart = weekdayOf({ ...calendar, weekMode: 'monthStart' }, { year: 1, month: 2, day: 1 });
  const firstOfYear = calendar.weekdays.indexOf(weekdayOf(calendar, { year: 1, month: 1, day: 1 })!);
  assert(continuous === calendar.weekdays[(firstOfYear + 30) % 7] && restart === 'Uno', `Weeks: ${continuous} / ${restart}`);
  assert(calendarMonth({ ...calendar, weekMode: 'monthStart' }, 'world', 1, 2, []).lead === 0 && calendarMonth(calendar, 'world', 1, 2, []).lead === (firstOfYear + 30) % 7, 'The month grid starts where the week does');
  const marks = (display: WorldCalendar['moonDisplay']) => calendarMonth({ ...calendar, moonDisplay: display }, 'world', 1, 1, []).days.filter(day => day.moon).length;
  assert(marks('every') === 30 && marks(undefined) >= 4 && marks(undefined) <= 6 && marks('full') === 1 && marks('none') === 0, `Moon marks: ${marks('every')}/${marks(undefined)}/${marks('full')}/${marks('none')}`);
  passed.push('Model: with 30-day months and a 7-day week, Escarcha 1 falls two weekdays on from Brumal 1 when weeks run on and a "Uno" when each month starts a week (and its grid starts in the first column); the moon is marked every night (30), at its quarters (4–6), only when full (1) or never');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(CalendarView, { events: [], timelines: [], worldCalendar: { ...calendar, moonDisplay: 'full' }, onAddEvent: () => {} })); await pause(300); });
    const moons = [...document.querySelectorAll('[data-testid="calendar-moon"]')] as HTMLElement[];
    assert(moons.length === 1 && moons[0].dataset.phase === 'full' && /192, 80, 77|#c0504d/i.test(moons[0].style.borderBottom), `Calendar view: ${moons.map(m => m.outerHTML).join()}`);
    passed.push('Calendar view: "Solo la luna llena" marks one day 🌕, underlined in Selene\'s red');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'wcwm-project';
  try {
    await db.projects.put({ id: P, title: 'Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 } as Project);
    const set = await runBridgeTool('wh_world_calendar_set', { projectId: P, calendar: { ...calendar, weekMode: 'monthStart', moonDisplay: 'every' } });
    assert(set.ok, JSON.stringify(set));
    const got = await runBridgeTool('wh_world_calendar_get', { projectId: P });
    const stored = (got.result as { calendar: WorldCalendar }).calendar;
    assert(stored.weekMode === 'monthStart' && stored.moonDisplay === 'every' && stored.moons[0].color === '#c0504d', `Bridge: ${JSON.stringify(stored).slice(0, 300)}`);
    const bad = await runBridgeTool('wh_world_calendar_set', { projectId: P, calendar: { ...calendar, moonDisplay: 'sometimes' } });
    assert(!bad.ok, 'Bad moonDisplay refused');
    passed.push('Bridge: wh_world_calendar_set keeps weekMode monthStart, moonDisplay every and the moon colour, and refuses an unknown display');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
