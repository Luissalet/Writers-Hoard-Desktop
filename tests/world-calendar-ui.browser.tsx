// The world calendar in the real components: the editor, the date field and the swim lanes.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/world-calendar-ui.browser.tsx testWorldCalendarUi 250000 --no-sandbox
import { act, StrictMode, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { t } from '@/i18n/useTranslation';
import type { Timeline, TimelineEvent } from '@/types';
import WorldCalendarEditor from '@/engines/timeline/components/WorldCalendarEditor';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import { useWorldCalendar } from '@/engines/timeline/useWorldCalendar';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { formatWorldDate, parseWorldDate, validateWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byLabel = (label: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const monthName = (n: number) => t('timeline.world.monthName').replace('{n}', String(n));
const monthDays = (n: number) => t('timeline.world.monthDays').replace('{n}', String(n));

/** Type into a React-controlled input the way a browser does. */
function type(input: HTMLInputElement | HTMLSelectElement | null | undefined, value: string, label: string) {
  assert(input, `Missing ${label}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function testWorldCalendarUi(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `world-calendar-ui-${Date.now()}`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;
  const render = async (element: ReactNode) => {
    await act(async () => { root ??= createRoot(host); root.render(<StrictMode><MemoryRouter>{element}</MemoryRouter></StrictMode>); await pause(60); });
    await act(async () => { await pause(150); });
  };
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const act1 = async (work: () => void, ms = 80) => { await act(async () => { work(); await pause(ms); }); };
  const waitFor = async (what: string, test: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await act(async () => { await pause(40); });
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const buttonWithText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text));

  function EditorHost({ onClosed }: { onClosed: () => void }) {
    const resolved = useWorldCalendar(P);
    const [open, setOpen] = useState(true);
    return <WorldCalendarEditor projectId={P} open={open} resolved={resolved} onClose={() => { setOpen(false); onClosed(); }} />;
  }

  try {
    const engines = ['timeline'];
    await db.projects.add({ id: P, title: 'Test saga', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });

    // ---- Editor: edit ---------------------------------------------------------------------------------
    let closed = 0;
    await render(<EditorHost onClosed={() => { closed++; }} />);
    await waitFor('the editor', () => !!byTestId('world-calendar-editor') && !!byLabel(monthName(1)));
    assert((await resolveWorldCalendar(P)) === null, 'the project starts without a calendar');

    type(document.getElementById('wc-name') as HTMLInputElement, 'Ashen Reckoning', 'name field');
    type(byLabel(monthName(1)), 'Frostfall', 'first month name');
    type(byLabel(monthName(2)), 'Thaw', 'second month name');
    type(document.getElementById('wc-weekdays') as HTMLInputElement, 'Aa, Bb, Cc', 'weekdays field');
    type(byLabel(t('timeline.world.eraName')), 'Third Era', 'era name');
    type(byLabel(t('timeline.world.eraAbbr')), 'TE', 'era abbreviation');
    await act1(() => { buttonWithText(t('timeline.world.addMonth'))?.click(); });
    await waitFor('the added month', () => !!byLabel(monthName(13)));
    type(byLabel(monthName(13)), 'Emberwane', 'added month name');
    await act(async () => { await pause(60); });
    passed.push('the editor lets a calendar be edited: name, months, weekdays, era, an added month');

    // ---- Validation: an impossible month is shown, nothing is stored ------------------------------------
    type(byLabel(monthDays(2)), '0', 'second month length');
    await act(async () => { await pause(60); });
    await act1(() => { byTestId('world-calendar-save')?.click(); }, 150);
    const errorsBox = byTestId('world-calendar-errors');
    assert(errorsBox && errorsBox.querySelectorAll('li').length > 0, 'a month of 0 days shows an error');
    assert((await resolveWorldCalendar(P)) === null, 'an invalid calendar is not stored');
    assert(closed === 0, 'the editor stays open on an error');
    passed.push('invalid input shows the validation errors and stores nothing');

    // ---- Save and reload ---------------------------------------------------------------------------------
    type(byLabel(monthDays(2)), '20', 'second month length');
    await act(async () => { await pause(60); });
    await act1(() => { byTestId('world-calendar-save')?.click(); }, 200);
    await waitFor('the editor to close after saving', () => closed === 1 && !byTestId('world-calendar-editor'));
    const stored = await db.projects.get(P);
    assert(stored?.worldCalendar, 'the calendar was written on the project');
    const saved: WorldCalendar = stored.worldCalendar;
    assert(validateWorldCalendar(saved).length === 0, 'the stored calendar is valid');
    assert(saved.name === 'Ashen Reckoning' && saved.months.length === 13, 'name and month count persisted');
    assert(saved.months[0].name === 'Frostfall' && saved.months[1].name === 'Thaw' && saved.months[1].days === 20 && saved.months[12].name === 'Emberwane', 'month edits persisted');
    assert(saved.weekdays.join(',') === 'Aa,Bb,Cc' && saved.eras[0].abbr === 'TE' && saved.eras[0].name === 'Third Era', 'weekdays and era persisted');
    await unmount();
    closed = 0;
    await render(<EditorHost onClosed={() => { closed++; }} />);
    await waitFor('the reopened editor', () => !!byLabel(monthName(13)));
    assert((document.getElementById('wc-name') as HTMLInputElement).value === 'Ashen Reckoning', 'the reopened editor shows the saved name');
    assert(byLabel(monthName(2))!.value === 'Thaw' && byLabel(monthName(13))!.value === 'Emberwane', 'the reopened editor shows the saved months');
    assert((document.getElementById('wc-weekdays') as HTMLInputElement).value === 'Aa, Bb, Cc', 'the reopened editor shows the saved weekdays');
    await unmount();
    passed.push('a saved calendar persists in the store and the editor reloads it');

    // ---- WorldDateField -------------------------------------------------------------------------------------
    const calendar = (await resolveWorldCalendar(P))!.calendar;
    function Field() {
      const [value, setValue] = useState('');
      return <WorldDateField calendar={calendar} label="When" value={value} onChange={setValue} testId="wd" />;
    }
    await render(<Field />);
    const field = () => byTestId('wd') as HTMLInputElement;
    assert(field() && field().placeholder === '12 Frostfall 3 TE', `the placeholder is an example in this calendar (got ${field()?.placeholder})`);
    assert(!byTestId('wd-reading'), 'nothing is read from an empty field');
    await act1(() => type(field(), '12 Frostfall 3 TE', 'date field'));
    await waitFor('the reading', () => !!byTestId('wd-reading'));
    const reading = byTestId('wd-reading')!.textContent ?? '';
    assert(reading.includes('12 Frostfall 3 TE'), `the reading shows the formatted date (got "${reading}")`);
    assert(/Aa|Bb|Cc/.test(reading), `the reading shows the weekday (got "${reading}")`);
    assert(field().getAttribute('aria-invalid') === 'false', 'a good date is not flagged invalid');
    const parsed = parseWorldDate(calendar, '12 Frostfall 3 TE');
    assert(parsed && formatWorldDate(calendar, parsed) === '12 Frostfall 3 TE', 'the date round-trips through parse and format');
    await act1(() => type(field(), '25 Thaw 3 TE', 'date field'));
    await waitFor('the unreadable reading', () => field().getAttribute('aria-invalid') === 'true');
    assert(byTestId('wd-reading')!.className.includes('text-danger'), 'a day the month lacks is shown as an error');
    await act1(() => type(field(), '4 Emberwane 9 TE', 'date field'));
    await waitFor('the added month to parse', () => field().getAttribute('aria-invalid') === 'false' && (byTestId('wd-reading')?.textContent ?? '').includes('4 Emberwane 9 TE'));
    await unmount();
    passed.push('WorldDateField reads, formats and rejects dates in the saved calendar');

    // ---- Swim lanes: two world-dated events, in order, with labels -------------------------------------------
    const lane = (id: string, title: string): Timeline => ({ id, projectId: P, title, color: '#c4973b', createdAt: now, updatedAt: now });
    const laneA = lane(`${P}-a`, 'Lane A');
    const laneB = lane(`${P}-b`, 'Lane B');
    const world = (text: string) => parseWorldDate(calendar, text)!;
    const event = (id: string, timelineId: string, title: string, text: string, order: number): TimelineEvent => ({
      id, projectId: P, timelineId, title, description: '', date: text, dateMode: 'world', worldDate: world(text),
      eventType: 'point', order, lane: '', color: '#c4973b', createdAt: now, updatedAt: now,
    });
    // The later event is in the first lane: only the world dates can put the two in the right order.
    const later = event(`${P}-later`, laneA.id, 'Harvest feast', '10 Thaw 3 TE', 0);
    const sooner = event(`${P}-sooner`, laneB.id, 'First frost', '2 Frostfall 3 TE', 0);
    await db.timelines.bulkAdd([laneA, laneB]);
    await db.timelineEvents.bulkAdd([later, sooner]);
    const noop = () => {};
    await render(
      <SwimLaneView projectId={P} timelines={[laneA, laneB]} events={[later, sooner]} connections={[]}
        onAddEvent={noop} onEditEvent={noop} onDeleteEvent={noop} onAddConnection={noop} onEditConnection={noop}
        onDeleteConnection={noop} onEditTimeline={noop} />,
    );
    const svgText = (content: string) => [...document.querySelectorAll<SVGTextElement>('svg text')].find(node => node.textContent?.trim() === content);
    await waitFor('both events and their world-date labels', () => !!svgText('Harvest feast') && !!svgText('First frost') && !!svgText('10 Thaw 3 TE') && !!svgText('2 Frostfall 3 TE'));
    const x = (node: SVGTextElement | undefined) => Number(node!.getAttribute('x'));
    assert(x(svgText('First frost')) < x(svgText('Harvest feast')), 'the earlier world date is placed left of the later one, across lanes');
    assert(x(svgText('2 Frostfall 3 TE')) === x(svgText('First frost')) && x(svgText('10 Thaw 3 TE')) === x(svgText('Harvest feast')), 'each event carries its own world-date label');
    await unmount();
    passed.push('swim lanes place world-dated events by their dates and show the world-date labels');
    return passed;
  } finally {
    await unmount().catch(() => undefined);
    await Promise.all([db.timelineEvents.where('projectId').equals(P).delete(), db.timelines.where('projectId').equals(P).delete(), db.projects.delete(P)]);
  }
}
