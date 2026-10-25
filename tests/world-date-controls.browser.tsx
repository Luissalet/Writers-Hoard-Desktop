// Date controls exercise the real field under the normal product CSS runner.
// The exact-date editor is a draft: navigation and Cancel never publish it.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { defaultWorldCalendar, formatWorldDate, parseWorldDate, validateWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { registerLocaleStrings, t } from '@/i18n/useTranslation';
import en from '@/engines/timeline/locales/en';
import es from '@/engines/timeline/locales/es';
import { useLocaleStore } from '@/stores/localeStore';

registerLocaleStrings({ en, es });
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 35) => new Promise(resolve => setTimeout(resolve, ms));
const node = <T extends HTMLElement = HTMLElement>(id: string) => {
  const found = document.querySelector<T>(`[data-testid="${id}"]`);
  assert(found, `Missing ${id}`);
  return found;
};
async function click(id: string) { await act(async () => { node<HTMLButtonElement>(id).click(); await pause(); }); }
async function input(id: string, value: string) {
  await act(async () => {
    const field = node<HTMLInputElement | HTMLSelectElement>(id);
    Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await pause();
  });
}
function calendar(): WorldCalendar {
  return {
    ...defaultWorldCalendar('Coast'),
    months: [{ name: 'Frostfall', days: 30 }, { name: 'Thaw', days: 28 }, { name: 'Festival', days: 2, intercalary: true }, { name: 'Leap tide', days: 0 }],
    eras: [{ name: 'Before the beacon', abbr: 'BB', startYear: -100, countdown: true }, { name: 'Beacon', abbr: 'BE', startYear: 1, yearZero: true }],
    weekdays: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'],
    leap: { every: 4, month: 4, extraDays: 3 },
    holidays: [{ name: 'Night of lanterns', month: 2, day: 5 }],
    moons: [],
  };
}

type Mounted = { text: () => string; writes: () => number; close: () => Promise<void> };
async function mount(cal: WorldCalendar, initial: string, optional = false): Promise<Mounted> {
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null, latest = initial, changes = 0;
  function Harness() {
    const [value, setValue] = useState(initial);
    latest = value;
    return <main style={{ maxWidth: 560, padding: 16 }}><WorldDateField calendar={cal} label="Event date" value={value} onChange={text => { changes++; setValue(text); }} optional={optional} testId="wdc" /></main>;
  }
  await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(); });
  return { text: () => latest, writes: () => changes, close: async () => { await act(async () => { root?.unmount(); await pause(); }); } };
}

async function navigation() {
  const cal = calendar(), original = formatWorldDate(cal, { year: 0, month: 3, day: 2 });
  const field = await mount(cal, original);
  try {
    await click('wdc-picker');
    await click('wdc-picker-next');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '0' && node('wdc-picker-month-4').getAttribute('aria-pressed') === 'true', 'Leap year 0 includes the leap month');
    await click('wdc-picker-next');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '1' && node('wdc-picker-month-1').getAttribute('aria-pressed') === 'true', 'Navigation crosses countdown→zero-based era in absolute years');
    assert(node('wdc-picker-panel').textContent?.includes('0 BE'), 'Era count is formatted as zero without changing the absolute year');
    await click('wdc-picker-prev');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '0' && node('wdc-picker-month-4').getAttribute('aria-pressed') === 'true', 'Reverse navigation restores the leap month');
    await input('wdc-picker-year', '5');
    assert(!!node('wdc-picker-nodays') && node<HTMLButtonElement>('wdc-picker-whole-month').disabled, 'Missing leap month remains visible as unavailable; whole-month selection cannot emit an invalid date');
    await click('wdc-picker-next');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '6' && node('wdc-picker-month-1').getAttribute('aria-pressed') === 'true', 'Next skips the absent final leap month');
    await click('wdc-picker-prev');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '5' && node('wdc-picker-month-3').getAttribute('aria-pressed') === 'true', 'Previous keeps the nonempty intercalary month');
    assert(field.text() === original && field.writes() === 0, 'Cursor navigation published a date');
    await click('wdc-picker-day-2');
    const picked = parseWorldDate(cal, field.text());
    assert(picked?.year === 5 && picked.month === 3 && picked.day === 2 && field.writes() === 1, 'A day selection publishes exactly its own existing date');
  } finally { await field.close(); }
  return 'Cursor navigation preserves the date, crosses countdown/year-zero eras and years, skips absent leap months and retains intercalary months';
}

async function boundary() {
  const cal = { ...calendar(), allowNegativeYears: false, eras: [{ name: 'Harbour', abbr: 'HA', startYear: 100 }] };
  // A first month that only exists in leap years is a valid calendar.
  cal.months = [{ name: 'Leap dawn', days: 0 }, { name: 'Harbour', days: 28 }];
  cal.leap = { every: 4, offset: 1, month: 1, extraDays: 2 };
  cal.holidays = [];
  const field = await mount(cal, '');
  try {
    await click('wdc-picker');
    assert(node('wdc-picker-month-2').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('[data-testid^="wdc-picker-day-"]').length === 28, 'An empty value opens the first existing month, even if month 1 is absent');
    assert(node<HTMLButtonElement>('wdc-picker-prev').disabled, 'Previous cannot cross the first absolute year');
    await click('wdc-picker-prev');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '100' && field.writes() === 0, 'Disabled boundary mutated cursor or content');
    await click('wdc-picker-next');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '101' && node('wdc-picker-month-1').getAttribute('aria-pressed') === 'true', 'A leap first month becomes available in the next year');
  } finally { await field.close(); }
  return 'The first-era boundary uses absolute years and opens an existing month when a first leap month is absent';
}

async function exactDraft() {
  const cal = calendar(), original = formatWorldDate(cal, { year: 4, month: 2, day: 5, approx: true });
  const field = await mount(cal, original);
  try {
    await click('wdc-picker'); await click('wdc-picker-exact');
    assert(!document.querySelector('[data-testid="wdc-picker-year"]'), 'The year control is duplicated while exact editing');
    assert(node<HTMLInputElement>('wdc-exact-year').value === '4' && node<HTMLSelectElement>('wdc-exact-month').value === '2' && node<HTMLInputElement>('wdc-exact-day').value === '5', 'Exact fields must seed absolute year, month and day from the parsed value');
    await input('wdc-exact-year', '5'); await input('wdc-exact-month', '1'); await input('wdc-exact-day', '12');
    assert(field.writes() === 0 && field.text() === original, 'Exact editing published an unconfirmed draft');
    await click('wdc-exact-cancel');
    assert(!!node('wdc-picker-year') && field.text() === original && field.writes() === 0, 'Cancel failed to restore the grid without changing text');
    await click('wdc-picker-exact');
    assert(node<HTMLInputElement>('wdc-exact-year').value === '4', 'Cancel retained the abandoned exact year');
    await input('wdc-exact-year', '5'); await input('wdc-exact-month', '1'); await input('wdc-exact-day', '12');
    await click('wdc-exact-apply');
    const date = parseWorldDate(cal, field.text());
    assert(date?.year === 5 && date.month === 1 && date.day === 12 && date.approx && field.writes() === 1, 'Apply must publish one exact draft retaining the prior approximation flag');
    assert(!document.querySelector('[data-testid="wdc-picker-panel"]') && document.activeElement === node('wdc'), 'Apply closes and focuses the input');
  } finally { await field.close(); }
  return 'Separate absolute-year/month/day fields stage a local draft; Cancel is inert and Apply preserves approximation';
}

async function exactValidityAndPrecision() {
  const cal = calendar(), field = await mount(cal, formatWorldDate(cal, { year: 5, month: 1, day: 3 }));
  try {
    await click('wdc-picker'); await click('wdc-picker-exact');
    for (const [year, month, day, reason] of [
      ['', '1', '3', 'blank year'], ['5', '', '3', 'day without month'], ['5', '2', '29', 'day beyond short month'], ['5', '4', '1', 'absent leap month'], ['5.5', '1', '3', 'fractional year'],
    ]) {
      await input('wdc-exact-year', year); await input('wdc-exact-month', month); await input('wdc-exact-day', day);
      assert(node<HTMLButtonElement>('wdc-exact-apply').disabled && !!node('wdc-exact-error').textContent?.trim(), `Invalid ${reason} allowed Apply or gave no explanation`);
      await click('wdc-exact-apply'); assert(field.writes() === 0, `Invalid ${reason} published a draft`);
    }
    await input('wdc-exact-year', '5'); await input('wdc-exact-day', ''); await input('wdc-exact-month', '');
    assert(!node<HTMLButtonElement>('wdc-exact-apply').disabled, 'A year-only date is valid');
    await click('wdc-exact-apply');
    let parsed = parseWorldDate(cal, field.text());
    assert(parsed?.year === 5 && parsed.month === undefined && parsed.day === undefined, 'Year-only precision was expanded');
    await click('wdc-picker'); await click('wdc-picker-exact');
    assert(node<HTMLSelectElement>('wdc-exact-month').value === '' && node<HTMLInputElement>('wdc-exact-day').value === '', 'Year-only precision was lost on reopen');
    await input('wdc-exact-month', '2'); await click('wdc-exact-apply');
    parsed = parseWorldDate(cal, field.text());
    assert(parsed?.year === 5 && parsed.month === 2 && parsed.day === undefined && field.writes() === 2, 'Month-only precision was expanded');
  } finally { await field.close(); }
  return 'Exact fields reject invalid drafts and preserve year-only and month-only precision through Apply and reopen';
}

async function clear() {
  for (const optional of [false, true]) {
    const cal = calendar(), field = await mount(cal, formatWorldDate(cal, { year: 4, month: 2, day: 5 }), optional);
    try {
      await click('wdc-picker'); await click('wdc-picker-exact'); await input('wdc-exact-year', '5');
      await click('wdc-clear');
      assert(field.text() === '' && field.writes() === 1 && document.activeElement === node('wdc'), 'Clear must publish one empty value and focus the input');
      assert(!document.querySelector('[data-testid="wdc-picker-panel"]') && !document.querySelector('[data-testid="wdc-clear"]'), 'Clear must close the panel and disappear for an empty input');
    } finally { await field.close(); }
  }
  return 'Clear uses the same empty-value contract on start and optional-end fields, cancels an exact draft and restores focus';
}

// The UTC clock is Jan 2, while the local civil day is Jan 1. A toISOString
// shortcut would choose the wrong world day. Restore Date after every case.
async function withLocalMidnight<T>(run: () => Promise<T>): Promise<T> {
  const OriginalDate = globalThis.Date;
  class MidnightDate extends OriginalDate {
    constructor(value?: string | number) { super(value ?? '2030-01-02T00:30:00.000Z'); }
    getFullYear() { return 2030; }
    getMonth() { return 0; }
    getDate() { return 1; }
  }
  globalThis.Date = MidnightDate;
  try { return await run(); } finally { globalThis.Date = OriginalDate; }
}

async function today() {
  await withLocalMidnight(async () => {
    const cal = calendar();
    cal.correlation = { date: { year: 4, month: 2, day: 5 }, earth: '2030-01-01' };
    const field = await mount(cal, formatWorldDate(cal, { year: 5, month: 1, day: 1, approx: true }));
    try {
      await click('wdc-picker'); await click('wdc-picker-today');
      const date = parseWorldDate(cal, field.text());
      assert(date?.year === 4 && date.month === 2 && date.day === 5 && !date.approx && field.writes() === 1, 'Today must choose the correlated LOCAL civil date as a full exact day');
      assert(!document.querySelector('[data-testid="wdc-picker-panel"]') && document.activeElement === node('wdc'), 'Today closes and focuses the input');
    } finally { await field.close(); }
  });
  return 'Today converts the current local civil day through the explicit correlation, including a local/UTC midnight difference';
}

async function unavailableToday() {
  const cal = calendar();
  for (const correlation of [undefined, { date: { year: 4 }, earth: '2030-01-01' }, { date: { year: 5, month: 4, day: 1 }, earth: '2030-01-01' }, { date: { year: 4, month: 1, day: 1 }, earth: '2030-02-31' }]) {
    const field = await mount({ ...cal, correlation }, '');
    try {
      await click('wdc-picker');
      assert(!document.querySelector('[data-testid="wdc-picker-today"]') && field.writes() === 0, 'No complete valid correlation must not invent a Today action');
    } finally { await field.close(); }
  }
  await withLocalMidnight(async () => {
    const restricted = { ...cal, allowNegativeYears: false, eras: [{ name: 'Harbour', abbr: 'HA', startYear: 100 }], correlation: { date: { year: 100, month: 1, day: 1 }, earth: '2030-01-02' } };
    const original = formatWorldDate(restricted, { year: 100, month: 2, day: 3 }), field = await mount(restricted, original);
    try {
      await click('wdc-picker'); await click('wdc-picker-today');
      assert(field.text() === original && field.writes() === 0 && !!node('wdc-picker-error').textContent?.trim(), 'A correlated day before the first era must retain the draft and explain the failure');
      assert(!!node('wdc-picker-panel'), 'An unavailable Today must leave the picker usable');
    } finally { await field.close(); }
  });
  return 'Today is absent without a complete usable correlation and reports an out-of-domain conversion without changing content';
}

export async function testWorldDateControlsPlaceholder(): Promise<string[]> {
  const cal: WorldCalendar = { ...calendar(), months: [{ name: 'Leap dawn', days: 0 }, { name: 'Harbour', days: 28 }], leap: { every: 4, month: 1, extraDays: 2 }, holidays: [] };
  const field = await mount(cal, '');
  try {
    const example = node<HTMLInputElement>('wdc').placeholder;
    const parsed = parseWorldDate(cal, example);
    assert(parsed?.month === 2 && parsed.day === 12, `The placeholder must name an existing month and day, not a missing leap-month day 0: ${example}`);
    return ['An empty field whose first calendar month is absent shows a valid parseable example from an existing month'];
  } finally { await field.close(); }
}

export async function testWorldDateControlsEmptyYear(): Promise<string[]> {
  const cal: WorldCalendar = { ...defaultWorldCalendar('Tide'), months: [{ name: 'Leap tide', days: 0 }], leap: { every: 4, month: 1, extraDays: 2 }, moons: [], holidays: [] };
  assert(validateWorldCalendar(cal).length === 0, 'A sole zero-day leap month is already a valid calendar; the field must not reject its schema');
  const field = await mount(cal, '');
  try {
    const example = parseWorldDate(cal, node<HTMLInputElement>('wdc').placeholder);
    assert(example?.year === 3 && example.month === undefined && example.day === undefined, 'A year with no months needs a valid year-only example');
    await click('wdc-picker');
    assert(!!node('wdc-picker-nodays') && node<HTMLInputElement>('wdc-picker-year').value === '1' && field.writes() === 0, 'Opening an empty year must remain usable without inventing a date');
    for (const year of [2, 3, 4]) {
      await click('wdc-picker-next');
      assert(node<HTMLInputElement>('wdc-picker-year').value === String(year), `The arrow must reach the next year without an unbounded search: expected ${year}`);
    }
    assert(document.querySelectorAll('[data-testid^="wdc-picker-day-"]').length === 2 && !node<HTMLButtonElement>('wdc-picker-whole-month').disabled, 'The leap year must show its two real days');
    await click('wdc-picker-prev');
    assert(node<HTMLInputElement>('wdc-picker-year').value === '3' && !!node('wdc-picker-nodays') && field.writes() === 0, 'Reverse navigation into an empty year must not crash or publish');
    await click('wdc-picker-exact');
    assert(node<HTMLButtonElement>('wdc-exact-apply').disabled, 'The empty month must not become an applicable date');
    await input('wdc-exact-month', '');
    assert(!node<HTMLButtonElement>('wdc-exact-apply').disabled, 'The same empty year remains a valid partial year');
    await click('wdc-exact-apply');
    assert(parseWorldDate(cal, field.text())?.year === 3 && parseWorldDate(cal, field.text())?.month === undefined && field.writes() === 1, 'Applying a partial empty year must preserve year-only precision');
    await click('wdc-picker'); await input('wdc-picker-year', '4'); await click('wdc-picker-day-2');
    const picked = parseWorldDate(cal, field.text());
    assert(picked?.year === 4 && picked.month === 1 && picked.day === 2 && field.writes() === 2, 'Manual year navigation must reach and select a real leap day');
    return ['A valid calendar containing only one zero-day leap month mounts in empty years, gives a partial-year example, navigates boundedly into and out of leap year 4, applies a partial year and selects a real leap day'];
  } finally { await field.close(); }
}

export async function testWorldDateControls(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const passed: string[] = [], failures: string[] = [];
  for (const run of [navigation, boundary, exactDraft, exactValidityAndPrecision, clear, today, unavailableToday]) {
    try { passed.push(await run()); } catch (error) { failures.push(`${run.name}: ${error instanceof Error ? error.stack : String(error)}`); }
  }
  if (failures.length) throw new Error(`${failures.length} date-control cases failed; ${passed.length} passed.\n${failures.join('\n\n')}`);
  return [...passed, ...await testWorldDateControlsPlaceholder(), ...await testWorldDateControlsEmptyYear()];
}

export async function testWorldDateControlsVisual(): Promise<string[]> {
  const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string };
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null, sequence = 0;
  async function wait(check: () => boolean) {
    for (let index = 0; index < 250 && !check(); index++) await pause(40);
    assert(check(), 'CSS capture handshake timed out');
  }
  function Harness() {
    const [start, setStart] = useState(formatWorldDate(calendar(), { year: 4, month: 2, day: 5 }));
    const [end, setEnd] = useState(formatWorldDate(calendar(), { year: 4, month: 2, day: 10 }));
    return <main style={{ maxWidth: 640, padding: 16, margin: '0 auto' }}><h1 style={{ marginBottom: 20, fontSize: 24 }}>{useLocaleStore.getState().locale === 'es' ? 'Fechas del suceso' : 'Event dates'}</h1><div style={{ display: 'grid', gap: 24 }}><WorldDateField calendar={calendar()} label={useLocaleStore.getState().locale === 'es' ? 'Fecha de inicio' : 'Start date'} value={start} onChange={setStart} testId="visual-start" /><WorldDateField calendar={calendar()} label={useLocaleStore.getState().locale === 'es' ? 'Fecha de fin' : 'End date'} value={end} onChange={setEnd} testId="visual-end" optional /></div></main>;
  }
  try {
    for (const locale of ['en', 'es'] as const) for (const width of [1280, 390]) {
      useLocaleStore.setState({ locale });
      const n = ++sequence;
      channel.__want = { w: width, h: 1100, n }; await wait(() => channel.__sizeAck === n);
      await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(); });
      await click('visual-start-picker'); await click('visual-start-picker-exact'); await click('visual-end-picker');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, `${locale}/${width}: horizontal overflow`);
      for (const id of ['visual-start-exact-apply', 'visual-start-exact-cancel', 'visual-end-picker-prev', 'visual-end-picker-next', 'visual-start-clear']) {
        const box = node(id).getBoundingClientRect();
        assert(box.height >= 36 && box.left >= 0 && box.right <= innerWidth, `${locale}/${width}: unreachable or small ${id}: ${JSON.stringify(box.toJSON())}`);
      }
      assert(node('visual-start-exact-year').closest('label')?.textContent?.includes(t('timeline.picker.year')), 'Exact year must have a visible localized label');
      const name = `world-date-controls-${locale}-${width}`;
      channel.__shot = { name }; await wait(() => channel.__shotDone === name);
      await act(async () => { root?.unmount(); root = null; await pause(); });
    }
    return ['Actual product CSS: EN/ES at 1280 and 390, exact fields and calendar grid together, no horizontal overflow, 36px actions and accessible labels (four captures)'];
  } finally { if (root) await act(async () => { root?.unmount(); }); }
}
