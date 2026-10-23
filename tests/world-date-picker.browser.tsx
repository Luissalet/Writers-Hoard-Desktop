// The world date picker: a year, a month from the calendar's months and a day
// from that month's grid (weekdays, holidays) fill the date field.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { WORLD_CALENDAR_SCHEMA, parseWorldDate, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testWorldDatePicker(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const calendar = { schema: WORLD_CALENDAR_SCHEMA, name: 'Sal', months: [{ name: 'Brumal', days: 30 }, { name: 'Escarcha', days: 28 }], weekdays: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete'], eras: [{ name: 'Era de la Sal', abbr: 'ES', startYear: 1 }], moons: [], holidays: [{ name: 'Noche de Faros', month: 2, day: 5 }] } as WorldCalendar;
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let latest = '';
  function Harness() { const [value, setValue] = useState(''); latest = value; return <WorldDateField calendar={calendar} label="Fecha" value={value} onChange={setValue} testId="wd" />; }
  const click = async (id: string) => { await act(async () => { (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click(); await pause(); }); };
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(200); });
    await click('wd-picker');
    const year = document.querySelector('[data-testid="wd-picker-year"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(year, '431'); year.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    await click('wd-picker-month-2');
    const days = document.querySelectorAll('[data-testid^="wd-picker-day-"]');
    const festival = document.querySelector('[data-testid="wd-picker-day-5"]') as HTMLElement;
    assert(days.length === 28 && /Noche de Faros/.test(festival.title), `Escarcha grid: ${days.length} days, ${festival?.title}`);
    await click('wd-picker-day-5');
    const parsed = parseWorldDate(calendar, latest);
    assert(parsed?.year === 431 && parsed.month === 2 && parsed.day === 5 && !document.querySelector('[data-testid="wd-picker-panel"]'), `Picked: ${latest}`);
    return [`World date field: the calendar button opens a picker; year 431, "Escarcha" (a 28-day grid with "Noche de Faros" on the 5th), and the 5th fill the field with "${latest}" and close it`];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
}
