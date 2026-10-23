// Recurring events (every year, month or week, until a year) and the band a
// run of days draws on the Calendar view (one banner, plain or patterned).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import CalendarView from '@/engines/timeline/components/CalendarView';
import { calendarMonth, eventOccurrences } from '@/engines/timeline/calendarGrid';
import { earthCalendar } from '@/engines/timeline/calendarPresets';
import { toDayNumber } from '@/engines/timeline/worldCalendar';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project, Timeline, TimelineEvent } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testTimelineRepeatBanners(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const cal = earthCalendar('es');
  const base = { projectId: 'tr', timelineId: 'tr-t', description: '', dateMode: 'calendar', eventType: 'point', order: 0, lane: '', color: '#c0504d', createdAt: 1, updatedAt: 1 } as const;
  const fair = { ...base, id: 'fair', title: 'Feria de la Sal', date: '', realDate: '2024-10-12', realDateEnd: '2024-10-14', eventType: 'range', repeat: { every: 'year', untilYear: 2027 }, bannerPattern: 'stripes' } as TimelineEvent;
  const market = { ...base, id: 'market', title: 'Mercado', date: '', realDate: '2026-10-05', repeat: { every: 'week' } } as TimelineEvent;
  const rent = { ...base, id: 'rent', title: 'Alquiler', date: '', realDate: '2026-01-31', repeat: { every: 'month' } } as TimelineEvent;
  const day = (y: number, m: number, d: number) => toDayNumber(cal, { year: y, month: m, day: d });
  const october = (year: number) => [day(year, 10, 1), day(year, 10, 31)] as const;
  assert(eventOccurrences(cal, 'earth', fair, ...october(2026)).length === 1 && eventOccurrences(cal, 'earth', fair, ...october(2028)).length === 0 && eventOccurrences(cal, 'earth', fair, ...october(2023)).length === 0, 'Yearly until 2027, not before it began');
  assert(eventOccurrences(cal, 'earth', market, ...october(2026)).length === 4, `Weekly: ${eventOccurrences(cal, 'earth', market, ...october(2026)).length}`);
  const rentDays = (m: number) => eventOccurrences(cal, 'earth', rent, day(2026, m, 1), day(2026, m, new Date(Date.UTC(2026, m, 0)).getUTCDate())).length;
  assert(rentDays(3) === 1 && rentDays(2) === 0, 'Monthly on the 31st skips a month without one');
  const month = calendarMonth(cal, 'earth', 2026, 10, [fair]);
  const bars = month.days.filter(d => d.bars.length).map(d => `${d.day}:${d.bars[0].start ? 's' : ''}${d.bars[0].end ? 'e' : ''}`);
  assert(bars.join() === '12:s,13:,14:e', `Banner run: ${bars.join()}`);
  passed.push('Calendar: "Feria de la Sal" (12–14 October 2024, every year until 2027) is back in October 2026 as one run 12→14 and gone in 2028; a weekly market falls 4 times in October 2026; a monthly rent on the 31st skips February');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<CalendarView events={[fair, market]} timelines={[{ id: 'tr-t', projectId: 'tr', title: 'Puerto', description: '', color: '#888888', createdAt: 1, updatedAt: 1 } as Timeline]} worldCalendar={null} onAddEvent={() => {}} />); await pause(300); });
    const goTo = document.querySelector('[data-testid="calendar-goto"]') as HTMLInputElement | null;
    void goTo;
    const shown = () => [...document.querySelectorAll('[data-testid="calendar-day-13"] [data-testid="calendar-event"]')].map(e => `${e.textContent}|${(e as HTMLElement).dataset.banner}|${(e as HTMLElement).dataset.pattern}`);
    for (let i = 0; i < 40 && !/octubre · 2026/i.test(document.querySelector('[data-testid="calendar-title"]')?.textContent ?? ''); i++) {
      const title = document.querySelector('[data-testid="calendar-title"]')?.textContent ?? '';
      const later = /2027|2028|noviembre · 2026|diciembre · 2026/i.test(title);
      await act(async () => { (document.querySelector(`[data-testid="calendar-${later ? 'prev' : 'next'}"]`) as HTMLButtonElement).click(); await pause(30); });
    }
    assert(shown().includes('Feria de la Sal|middle|stripes'), `October 2026, the 13th: ${shown().join(' / ')} (${document.querySelector('[data-testid="calendar-title"]')?.textContent})`);
    passed.push('Calendar view: in October 2026 the fair is drawn as one striped band across the 12th to the 14th (the 13th is its middle)');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'tr-project';
  try {
    await db.projects.put({ id: P, title: 'Puerto', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 } as Project);
    const timeline = await runBridgeTool('wh_create_timeline', { projectId: P, title: 'Puerto' });
    const timelineId = (timeline.result as { id: string }).id;
    const made = await runBridgeTool('wh_create_event', { projectId: P, timelineId, title: 'Feria de la Sal', dateMode: 'calendar', realDate: '2024-10-12', realDateEnd: '2024-10-14', eventType: 'range', repeat: { every: 'year', untilYear: 2027 }, bannerPattern: 'dots' });
    assert(made.ok, JSON.stringify(made));
    const listed = await runBridgeTool('wh_list_events', { projectId: P, timelineId });
    const event = (listed.result as { events: Array<{ title: string; repeat: unknown; bannerPattern: string }> }).events[0];
    assert(JSON.stringify(event.repeat) === '{"every":"year","untilYear":2027}' && event.bannerPattern === 'dots', `Bridge: ${JSON.stringify(event)}`);
    const bad = await runBridgeTool('wh_create_event', { projectId: P, timelineId, title: 'X', dateMode: 'calendar', realDate: '2024-10-12', repeat: { every: 'decade' } });
    assert(!bad.ok, 'Unknown repeat refused');
    passed.push('Bridge: wh_create_event takes repeat {every: year, untilYear: 2027} and bannerPattern dots; wh_list_events gives them back; an unknown repeat is refused');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
