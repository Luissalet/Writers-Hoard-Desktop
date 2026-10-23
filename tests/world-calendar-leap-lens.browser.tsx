// A leap MONTH (a month that exists only in leap years) and the calendar lens
// (a world calendar's correlation with the Gregorian one): the arithmetic,
// the calendar view (both calendars' events on either, each day's
// equivalent), the calendar editor and the bridge.
import { act, StrictMode, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Timeline, TimelineEvent } from '@/types';
import CalendarView from '@/engines/timeline/components/CalendarView';
import WorldCalendarEditor from '@/engines/timeline/components/WorldCalendarEditor';
import { useWorldCalendar } from '@/engines/timeline/useWorldCalendar';
import { resolveWorldCalendar, saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { stepMonth, eventDayRange } from '@/engines/timeline/calendarGrid';
import { calendarLens, earthToWorld, worldToEarth } from '@/engines/timeline/calendarLens';
import { earthCalendar } from '@/engines/timeline/calendarPresets';
import { assertValidDate, daysInYear, defaultWorldCalendar, formatWorldDate, fromDayNumber, monthsInYear, toDayNumber, validateWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function ardania(): WorldCalendar {
  const calendar = defaultWorldCalendar('Ardania');
  calendar.months = Array.from({ length: 12 }, (_, i) => ({ name: `Luna ${i + 1}`, days: 30 }));
  calendar.months.push({ name: 'Mes bisiesto', days: 0 });
  calendar.leap = { every: 4, offset: 0, month: 13, extraDays: 30 };
  calendar.holidays = [{ name: 'Noche larga', month: 13, day: 15 }];
  return calendar;
}

export async function testWorldCalendarLeapLens(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const cal = ardania();
  assert(validateWorldCalendar(cal).length === 0, `Valid: ${validateWorldCalendar(cal).join('; ')}`);
  assert(validateWorldCalendar({ ...cal, leap: undefined }).some(problem => /Month 13 needs between 1 and 1000 days/.test(problem)), 'A month with no days needs the leap rule');
  assert(daysInYear(cal, 4) === 390 && daysInYear(cal, 5) === 360 && monthsInYear(cal, 4).length === 13 && monthsInYear(cal, 5).length === 12, 'Leap and common years');
  let refused = ''; try { assertValidDate(cal, { year: 5, month: 13, day: 1 }); } catch (error) { refused = String(error); }
  assert(/Mes bisiesto exists only in leap years; 5 is not one/.test(refused), refused);
  assert(toDayNumber(cal, { year: 5, month: 1, day: 1 }) - toDayNumber(cal, { year: 4, month: 1, day: 1 }) === 390, 'A leap year is 390 days');
  const inLeap = fromDayNumber(cal, toDayNumber(cal, { year: 4, month: 12, day: 30 }) + 1);
  assert(inLeap.month === 13 && inLeap.day === 1, `Day after Luna 12 in year 4: ${JSON.stringify(inLeap)}`);
  const common = fromDayNumber(cal, toDayNumber(cal, { year: 5, month: 12, day: 30 }) + 1);
  assert(common.year === 6 && common.month === 1, 'Year 5 goes straight on to year 6');
  assert(JSON.stringify(stepMonth(cal, { year: 4, month: 12 }, 1)) === '{"year":4,"month":13}' && JSON.stringify(stepMonth(cal, { year: 5, month: 12 }, 1)) === '{"year":6,"month":1}' && JSON.stringify(stepMonth(cal, { year: 6, month: 1 }, -1)) === '{"year":5,"month":12}', 'Stepping skips the leap month in common years');
  passed.push('Leap month: "Mes bisiesto" has no days of its own and 30 in leap years; year 4 has 390 days and 13 months, year 5 has 360 and 12; a date in it in year 5 is refused ("exists only in leap years"); stepping through months skips it in common years; a holiday can fall in it');

  cal.correlation = { date: { year: 1, month: 1, day: 1 }, earth: '2000-01-01' };
  assert(validateWorldCalendar(cal).length === 0 && validateWorldCalendar({ ...cal, correlation: { date: { year: 1 }, earth: '2000' } }).some(problem => /correlation needs/.test(problem)), 'Correlation validated');
  const lens = calendarLens(cal)!;
  assert(lens && worldToEarth(lens, { year: 1, month: 1, day: 1 }) === '2000-01-01' && worldToEarth(lens, { year: 1, month: 2, day: 1 }) === '2000-01-31', 'World → Earth');
  const back = earthToWorld(lens, '2000-03-01');
  assert(back.year === 1 && back.month === 3 && back.day === 1, `Earth → World: ${JSON.stringify(back)}`);
  const base = { projectId: 'lens', timelineId: 'tl', description: '', color: '#3d85c6', tags: [], createdAt: 1, updatedAt: 1 } as unknown as TimelineEvent;
  const worldEvent = { ...base, id: 'ev-world', title: 'Coronación de Ilse', dateMode: 'world', worldDate: { year: 1, month: 2, day: 1 } } as TimelineEvent;
  const realEvent = { ...base, id: 'ev-real', title: 'Eclipse real', dateMode: 'calendar', realDate: '2000-03-01' } as TimelineEvent;
  const earth = earthCalendar('es');
  assert(eventDayRange(earth, 'earth', worldEvent, lens)?.from === toDayNumber(earth, { year: 2000, month: 1, day: 31 }) && eventDayRange(cal, 'world', realEvent, lens)?.from === toDayNumber(cal, { year: 1, month: 3, day: 1 }), 'Events through the lens');
  assert(eventDayRange(earth, 'earth', worldEvent) === null, 'Without a lens a world event is not on the Earth calendar');
  passed.push('Lens: with "Luna 1, día 1 del año 1 = 2000-01-01", Luna 2 día 1 is 2000-01-31 and 2000-03-01 is Luna 3 día 1; a world-dated event lands on the Gregorian calendar and a real-dated one on the world calendar');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const render = async (element: ReactNode) => { await act(async () => { root ??= createRoot(host); root.render(<StrictMode><MemoryRouter>{element}</MemoryRouter></StrictMode>); await pause(150); }); };
  const waitFor = async (what: string, test: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return; await act(async () => { await pause(40); }); } throw new Error(`Timed out waiting for ${what}`); };
  const goTo = async (text: string) => {
    const input = byTestId('calendar-goto') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(40); });
    await act(async () => { input.form!.requestSubmit(); await pause(120); });
  };
  const P = 'leap-lens-ui';
  try {
    const timelines = [{ id: 'tl', projectId: P, name: 'Crónica', color: '#3d85c6', order: 0, createdAt: 1, updatedAt: 1 }] as unknown as Timeline[];
    await render(<CalendarView events={[worldEvent, realEvent]} timelines={timelines} worldCalendar={cal} onAddEvent={() => {}} />);
    await waitFor('calendar', () => !!byTestId('timeline-calendar'));
    assert(/Correlación: Ardania ↔ gregoriano/.test(byTestId('calendar-lens-note')?.textContent ?? ''), 'Lens note');
    await goTo(formatWorldDate(cal, { year: 1, month: 3, day: 1 }));
    await waitFor('Luna 3', () => /Luna 3/.test(byTestId('calendar-title')?.textContent ?? ''));
    assert(/Eclipse real/.test(byTestId('calendar-day-1')?.textContent ?? '') || /Eclipse real/.test(byTestId('calendar-day-1')?.getAttribute('title') ?? ''), `Real event on the world calendar: ${byTestId('calendar-day-1')?.outerHTML.slice(0, 300)}`);
    await act(async () => { byTestId('calendar-day-1')!.click(); await pause(80); });
    assert(/En el otro calendario: .*2000/.test(byTestId('calendar-equivalent')?.textContent ?? '') && /marzo/i.test(byTestId('calendar-equivalent')?.textContent ?? ''), `Equivalent: ${byTestId('calendar-equivalent')?.textContent}`);
    // Year 4 shows the leap month; year 5 does not.
    await act(async () => { byTestId('calendar-scale-year')!.click(); await pause(80); });
    await goTo(formatWorldDate(cal, { year: 4 }));
    await waitFor('year 4', () => document.body.textContent!.includes('Mes bisiesto'));
    await act(async () => { byTestId('calendar-next')!.click(); await pause(120); });
    assert(!document.body.textContent!.includes('Mes bisiesto'), 'Year 5 has no leap month');
    await act(async () => { byTestId('calendar-scale-month')!.click(); await pause(60); });
    const kind = byTestId('calendar-kind') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(kind, 'earth'); kind.dispatchEvent(new Event('change', { bubbles: true })); await pause(120); });
    await goTo(formatWorldDate(earth, { year: 2000, month: 1, day: 31 }));
    await waitFor('enero 2000', () => /enero/i.test(byTestId('calendar-title')?.textContent ?? ''));
    assert(/Coronación de Ilse/.test(byTestId('calendar-day-31')?.textContent ?? '') || /Coronación de Ilse/.test(byTestId('calendar-day-31')?.getAttribute('title') ?? ''), 'World event on the Gregorian calendar');
    passed.push('Calendar view: "Correlación: Ardania ↔ gregoriano" over the grid; Luna 3 día 1 shows the real "Eclipse real" and says its Gregorian equivalent (marzo de 2000); the year view shows "Mes bisiesto" in year 4 and not in year 5; on the Gregorian calendar, 31 de enero de 2000 shows the world event "Coronación de Ilse"');
  } finally {
    await act(async () => { root?.unmount(); root = null; await pause(); });
  }

  // The editor: add a leap month and a correlation; saved and read back.
  const E = `leap-lens-editor-${Date.now()}`;
  try {
    await db.projects.add({ id: E, title: 'Ardania', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['timeline'], engineOrder: ['timeline'], createdAt: 1, updatedAt: 1 } as never);
    function EditorHost() { const resolved = useWorldCalendar(E); const [open] = useState(true); return <WorldCalendarEditor projectId={E} open={open} resolved={resolved} onClose={() => {}} />; }
    await render(<EditorHost />);
    await waitFor('editor', () => !!byTestId('world-calendar-add-leap-month'));
    // Let the editor load the (absent) stored calendar before editing, or the load replaces the draft.
    await act(async () => { await pause(500); });
    await act(async () => { byTestId('world-calendar-add-leap-month')!.click(); await pause(80); });
    assert(/Mes bisiesto.*solo existe en los años bisiestos \(30 días\)/.test(byTestId('world-calendar-leap-month-note')?.textContent ?? ''), 'Leap month note');
    const type = async (id: string, value: string) => { const input = byTestId(id) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(40); }); };
    const draftCalendar = defaultWorldCalendar('x');
    await type('world-calendar-correlation-world', formatWorldDate({ ...draftCalendar, months: [...draftCalendar.months] }, { year: 1, month: 1, day: 1 }));
    await type('world-calendar-correlation-earth', '2000-01-01');
    await act(async () => { byTestId('world-calendar-save')!.click(); await pause(300); });
    let saved = (await resolveWorldCalendar(E))?.calendar;
    for (let i = 0; i < 30 && !saved; i++) { await act(async () => { await pause(100); }); saved = (await resolveWorldCalendar(E))?.calendar; }
    assert(saved && saved.months.length === 13 && saved.months[12].days === 0 && saved.leap?.month === 13 && saved.leap.extraDays === 30 && saved.correlation?.earth === '2000-01-01' && saved.correlation.date.day === 1, `Saved: ${JSON.stringify(saved && { months: saved.months.length, leap: saved.leap, correlation: saved.correlation })} ${document.querySelector('[role="alert"]')?.textContent ?? ''}`);
    passed.push('Calendar editor: "Añadir un mes bisiesto" adds "Mes bisiesto" with no days and points the leap rule at it (30 days, note under the rule); "Correlación con el calendario gregoriano" takes a day of each; both saved');
  } finally {
    await act(async () => { root?.unmount(); root = null; await pause(); });
  }

  // The bridge.
  try {
    await saveWorldCalendar(E, cal);
    const there = await runBridgeTool('wh_world_date', { projectId: E, date: { year: 1, month: 2, day: 1 } });
    const fromEarth = await runBridgeTool('wh_world_date', { projectId: E, earthDate: '2000-03-01' });
    const leapDay = await runBridgeTool('wh_world_date', { projectId: E, date: { year: 4, month: 13, day: 15 } });
    const notLeap = await runBridgeTool('wh_world_date', { projectId: E, date: { year: 5, month: 13, day: 15 } });
    assert(there.ok && (there.result as { earth: string }).earth === '2000-01-31', `Bridge earth: ${JSON.stringify(there).slice(0, 300)}`);
    assert(fromEarth.ok && (fromEarth.result as { label: string }).label === formatWorldDate(cal, { year: 1, month: 3, day: 1 }), `Bridge from earth: ${JSON.stringify(fromEarth).slice(0, 300)}`);
    assert(leapDay.ok && /Noche larga/.test(JSON.stringify(leapDay.result)) && !notLeap.ok && /only in leap years/.test(JSON.stringify(notLeap)), `Bridge leap: ${JSON.stringify(notLeap).slice(0, 300)}`);
    passed.push('Bridge: wh_world_date gives each date its Gregorian day ("earth": 2000-01-31) and takes earthDate 2000-03-01 → Luna 3 día 1; the 15th of the leap month is "Noche larga" in year 4 and refused in year 5');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(E).delete();
    await db.projects.delete(E);
  }
  return passed;
}
