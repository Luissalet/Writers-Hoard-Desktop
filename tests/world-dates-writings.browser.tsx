// Chapters dated in the world calendar, in the real components: the chapter editor,
// the chapter list and the timeline's read-only manuscript lane.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/world-dates-writings.browser.tsx testWorldDatesWritings 250000 --no-sandbox
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { db } from '@/db';
import { t } from '@/i18n/useTranslation';
import type { Timeline, TimelineEvent, Writing } from '@/types';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { WORLD_CALENDAR_SCHEMA, parseWorldDate, type WorldCalendar } from '@/engines/timeline/worldCalendar';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** Type into a React-controlled input the way a browser does. */
function type(input: HTMLInputElement | null | undefined, value: string, label: string) {
  assert(input, `Missing ${label}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

export async function testWorldDatesWritings(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `world-dates-writings-${Date.now()}`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;
  const render = async (element: ReactNode) => {
    await act(async () => {
      root ??= createRoot(host);
      root.render(<StrictMode><MemoryRouter><LocationProbe />{element}</MemoryRouter></StrictMode>);
      await pause(60);
    });
    await act(async () => { await pause(150); });
  };
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const waitFor = async (what: string, test: () => boolean | Promise<boolean>, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await test()) return;
      await act(async () => { await pause(50); });
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const svgText = (content: string) => [...document.querySelectorAll<SVGTextElement>('svg text')].find(node => node.textContent?.trim() === content);
  const x = (node: SVGTextElement | undefined) => Number(node!.getAttribute('x'));
  const chapterRow = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(b => b.textContent?.includes(title) && b.className.includes('flex-1'));
  const openChapter = async (title: string) => {
    await waitFor('the chapter in the list', () => !!chapterRow(title));
    await act(async () => { chapterRow(title)!.click(); await pause(150); });
    await waitFor('the world date field', () => !!byTestId('chapter-world-date-start'));
  };
  const storedChapter = async () => (await db.writings.get(`${P}-w1`)) as Writing;

  const calendar: WorldCalendar = {
    schema: WORLD_CALENDAR_SCHEMA,
    name: 'Ashen Reckoning',
    months: [{ name: 'Frostfall', days: 30 }, { name: 'Thaw', days: 20 }],
    weekdays: ['Aa', 'Bb', 'Cc'],
    eras: [{ name: 'Third Era', abbr: 'TE', startYear: 1 }],
    moons: [],
    holidays: [],
  };

  try {
    const engines = ['writings', 'timeline'];
    await db.projects.add({
      id: P, title: 'Test saga', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft',
      enabledEngines: engines, engineOrder: engines, worldCalendar: calendar, createdAt: now, updatedAt: now,
    });
    const lane: Timeline = { id: `${P}-tl`, projectId: P, title: 'Main line', color: '#c4973b', createdAt: now, updatedAt: now };
    const world = (text: string) => parseWorldDate(calendar, text)!;
    const event = (id: string, title: string, text: string, order: number): TimelineEvent => ({
      id, projectId: P, timelineId: lane.id, title, description: '', date: text, dateMode: 'world', worldDate: world(text),
      eventType: 'point', order, lane: '', color: '#c4973b', createdAt: now, updatedAt: now,
    });
    await db.timelines.add(lane);
    await db.timelineEvents.bulkAdd([event(`${P}-e1`, 'First frost', '5 Frostfall 3 TE', 0), event(`${P}-e2`, 'Harvest feast', '10 Thaw 3 TE', 1)]);
    await db.writings.add({
      id: `${P}-w1`, projectId: P, title: 'Chapter one', status: 'draft', content: '<p>The frost came early.</p>',
      wordCount: 4, chapter: 1, tags: [], createdAt: now, updatedAt: now,
    });
    await db.writings.add({
      id: `${P}-w2`, projectId: P, title: 'Chapter two', status: 'draft', content: '<p>Nothing dated.</p>',
      wordCount: 2, chapter: 2, tags: [], createdAt: now, updatedAt: now,
    });

    // ---- The editor sets the date ----------------------------------------------------------------------
    await render(<WritingsEngine projectId={P} />);
    await openChapter('Chapter one');
    const start = () => byTestId('chapter-world-date-start') as HTMLInputElement;
    assert(start().placeholder === '12 Frostfall 3 TE', `the field is an example in the project calendar (got ${start().placeholder})`);
    type(start(), '25 Thaw 3 TE', 'chapter date');
    await act(async () => { await pause(900); });
    assert(!(await storedChapter()).worldDate, 'a day the calendar lacks is not stored');
    assert(start().getAttribute('aria-invalid') === 'true', 'a day the calendar lacks is flagged');
    type(start(), '12 Frostfall 3 TE', 'chapter date');
    await waitFor('the date to be stored', async () => !!(await storedChapter()).worldDate);
    const stored = await storedChapter();
    assert(stored.worldDate?.year === 3 && stored.worldDate.month === 1 && stored.worldDate.day === 12, `the date is stored structured (got ${JSON.stringify(stored.worldDate)})`);
    await unmount();
    passed.push('the chapter editor sets a world date, refuses a day the calendar lacks, and stores it structured');

    // ---- The list shows it ----------------------------------------------------------------------------------
    await render(<WritingsEngine projectId={P} />);
    await waitFor('the date badge in the chapter list', () => byTestId('chapter-world-date-badge')?.textContent === '12 Frostfall 3 TE');
    assert(document.querySelectorAll('[data-testid="chapter-world-date-badge"]').length === 1, 'only the dated chapter shows a date');
    await unmount();
    passed.push('the chapter list shows the formatted world date of the dated chapter only');

    // ---- The timeline places it between the two events and opens it ----------------------------------------
    await render(<TimelineEngine projectId={P} />);
    const laneTitle = t('timeline.manuscriptLane');
    await waitFor('the manuscript lane and its chapter', () => !!svgText(laneTitle) && !!svgText('1. Chapter one') && !!svgText('First frost') && !!svgText('Harvest feast'));
    // The swim lanes resolve the calendar on their own; before that they lay events out by order.
    await waitFor('the chapter between the two events by its world date', () => (
      x(svgText('First frost')) < x(svgText('1. Chapter one')) && x(svgText('1. Chapter one')) < x(svgText('Harvest feast'))
    ));
    assert(!svgText('2. Chapter two'), 'an undated chapter is not on the timeline');
    const node = svgText('1. Chapter one')!;
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await pause(100); });
    await waitFor('the chapter to open', () => (byTestId('location')?.textContent ?? '').includes(`/writings?writing=${encodeURIComponent(`${P}-w1`)}`));
    await unmount();
    passed.push('the timeline places the dated chapter in a manuscript lane in date order and a click opens the chapter');

    // ---- Clearing it ---------------------------------------------------------------------------------------
    await render(<WritingsEngine projectId={P} />);
    await openChapter('Chapter one');
    assert(start().value === '12 Frostfall 3 TE', `the editor shows the stored date (got "${start().value}")`);
    type(start(), '', 'chapter date');
    await waitFor('the date to be cleared', async () => !(await storedChapter()).worldDate);
    await unmount();
    await render(<WritingsEngine projectId={P} />);
    await waitFor('the list', () => !!chapterRow('Chapter one'));
    assert(!byTestId('chapter-world-date-badge'), 'the badge is gone once the date is cleared');
    await unmount();
    await render(<TimelineEngine projectId={P} />);
    await waitFor('the timeline', () => !!svgText('First frost'));
    assert(!svgText(laneTitle) && !svgText('1. Chapter one'), 'the manuscript lane disappears with the last dated chapter');
    await unmount();
    passed.push('clearing the date removes it from the list and the timeline');
    return passed;
  } finally {
    await unmount().catch(() => undefined);
    await Promise.all([
      db.writings.where('projectId').equals(P).delete(),
      db.timelineEvents.where('projectId').equals(P).delete(),
      db.timelines.where('projectId').equals(P).delete(),
      db.projects.delete(P),
    ]);
  }
}
