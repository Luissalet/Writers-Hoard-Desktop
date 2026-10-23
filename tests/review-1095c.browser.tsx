// Fixes from the independent review of wave C (task 1095): sheet references
// follow inserted and removed rows and columns; table queries take numbers;
// re-dating never lands in a missing leap month; a preset named in a book style
// object is the starting point; a list of pieces selects them; a block to
// extract can be listed and checked first; the eraser follows a turned
// stroke; small pictures stay small in Word; the calendar and the date picker
// stay usable before a calendar's first era and in a missing leap month.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { insertColumn, insertRow, removeRows } from '@/engines/tables/tableEdits';
import { sheetValues } from '@/engines/tables/formulas';
import { cellKey, type WorldTable } from '@/engines/tables/types';
import { redatePlan } from '@/engines/timeline/redate';
import { defaultWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { eraseInk } from '@/engines/writings/coverDesign/model';
import type { CoverStroke } from '@/engines/writings/coverDesign/types';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import CalendarView from '@/engines/timeline/components/CalendarView';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, TimelineEvent, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
// A 1×1 PNG.
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function testReview1095c(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];

  // Sheet references.
  const sheet: WorldTable = { id: 's', title: 'Cuentas', mode: 'sheet', columns: [{ id: 'a', name: 'A', kind: 'text' }, { id: 'b', name: 'B', kind: 'text' }], rows: [{ id: 'r1', cells: { a: '1', b: '' } }, { id: 'r2', cells: { a: '2', b: '' } }, { id: 'r3', cells: { a: '=A1+A2', b: '=SUM(A1:A2)*2' } }], createdAt: 1, updatedAt: 1 } as unknown as WorldTable;
  const value = (column: number, row: number) => sheetValues(sheet).get(cellKey(column, row));
  assert(value(0, 2) === 3 && value(1, 2) === 6, 'Baseline');
  insertRow(sheet, 0);
  assert(sheet.rows[3].cells.a === '=A2+A3' && sheet.rows[3].cells.b === '=SUM(A2:A3)*2' && value(0, 3) === 3, `Row inserted above: ${JSON.stringify(sheet.rows[3].cells)}`);
  insertColumn(sheet, 0, { name: 'Nueva', kind: 'text' });
  assert(sheet.rows[3].cells.a === '=B2+B3' && value(1, 3) === 3 && value(2, 3) === 6, `Column inserted left: ${JSON.stringify(sheet.rows[3].cells)}`);
  removeRows(sheet, [sheet.rows[0].id]);
  assert(sheet.rows[2].cells.a === '=B1+B2' && value(1, 2) === 3, `Row removed above: ${JSON.stringify(sheet.rows[2].cells)}`);
  removeRows(sheet, ['r1']);
  assert(/^=B9999999\+B1$/.test(sheet.rows[1].cells.a) && String(value(1, 1)) === '#REF!', `A removed cell reads #REF!: ${sheet.rows[1].cells.a} → ${value(1, 1)}`);
  passed.push('Sheets: inserting a row above or a column to the left moves every reference after it (=A1+A2 → =A2+A3 → =B2+B3), removing a row moves them back, and a reference to a removed row reads #REF! instead of pointing at another cell');

  // Re-dating into a missing leap month.
  const leap: WorldCalendar = { ...defaultWorldCalendar('L'), months: [{ name: 'Uno', days: 30 }, { name: 'Dos', days: 30 }, { name: 'Bisiesto', days: 0 }], leap: { every: 4, offset: 0, month: 3, extraDays: 10 } };
  const event = { id: 'e', projectId: 'p', timelineId: 't', title: 'Fiesta', description: '', date: 'x', dateMode: 'world', worldDate: { year: 5, month: 5, day: 3 }, eventType: 'point', order: 0, lane: '', color: '#888888', createdAt: 1, updatedAt: 1 } as unknown as TimelineEvent;
  const plan = redatePlan([event], leap);
  assert(plan.length === 1 && plan[0].changes.worldDate?.month === 2 && plan[0].changes.worldDate.day === 3, `Clamped past the missing leap month: ${JSON.stringify(plan[0]?.changes.worldDate)}`);
  passed.push('Re-dating: a date in a removed month of a common year moves to the last month that has days (not into the missing leap month with day 0)');

  // The eraser on a turned stroke.
  const turned: CoverStroke = { id: 'ink', kind: 'ink', x: 0, y: 0, width: 100, height: 1, rotation: 90, color: '#ffffff', weight: 2, points: Array.from({ length: 11 }, (_, i) => ({ x: i / 10, y: 0 })) };
  assert(eraseInk([turned], { x: 90, y: 0.5 }, 5)[0] === turned, 'Where the unturned stroke would be, nothing is erased');
  const cut = eraseInk([turned], { x: 50.5, y: 0.5 }, 5).filter(e => e.kind === 'ink');
  assert(cut.length === 2 && cut.every(e => e.rotation === 0), `The turned stroke is cut where it is drawn: ${JSON.stringify(cut.map(e => [e.x, e.y, e.width, e.height]))}`);
  passed.push('Eraser: on a stroke turned 90°, the eraser cuts where the stroke is drawn, and the pieces keep their places');

  // Word keeps a small picture small.
  const doc = composePublishingDocument([{ id: 'w', projectId: 'p', title: 'Uno', status: 'draft', content: `<p>Texto.</p><img src="${DOT}" alt="punto">`, wordCount: 1, tags: [], createdAt: 1, updatedAt: 1 }], { projectTitle: 'Libro', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Capítulo', includeInlineImages: true } as never);
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(await (await buildPublishingDocx(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
  const extent = /<wp:extent cx="(\d+)"/.exec(xml);
  assert(extent && Number(extent[1]) <= 9525 * 2, `A 1-pixel picture stays tiny in Word: ${extent?.[1]}`);
  passed.push('Word: a picture without a chosen width keeps its own size instead of being blown up to the text width');

  // Bridge: table query with numbers; book style object with a preset; selected pieces; block list and check.
  const P = 'review-1095c';
  try {
    await db.projects.put({ id: P, title: 'Revisión', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'codex', 'tables'], createdAt: 1, updatedAt: 1 } as Project);
    const made = await runBridgeTool('wh_table_create', { projectId: P, title: 'Tesoro', columns: [{ name: 'Objeto', kind: 'text' }, { name: 'Valor', kind: 'number' }], rows: [['Anillo', '50'], ['Copa', '5'], ['Corona', '500']] });
    assert(made.ok, `Table made: ${JSON.stringify(made).slice(0, 300)}`);
    const table = (made.result as { table: WorldTable }).table;
    const valueColumn = table.columns[1].id;
    const query = await runBridgeTool('wh_table_query', { projectId: P, tableId: table.id, conditions: [{ columnId: valueColumn, op: 'gt', value: 10 }], sorts: [{ id: valueColumn, descending: true }] });
    const names = (query.result as { rows: { cells: Record<string, string> }[] }).rows.map(row => row.cells.Objeto);
    assert(query.ok && names.join() === 'Corona,Anillo', `Numbers compare: ${JSON.stringify(query).slice(0, 400)}`);
    const badSort = await runBridgeTool('wh_table_query', { projectId: P, tableId: table.id, sorts: [null] });
    assert(!badSort.ok, 'A null sort is refused, not a crash');
    const epic = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Tomo', bookStyle: { preset: 'epic' } });
    const style = (await db.publishingProfiles.get((epic.result as { profile: { id: string } }).profile.id))?.bookStyle;
    assert(epic.ok && style?.preset === 'epic' && style.trim === '6x9' && style.titleSize === 26, `Preset object: ${JSON.stringify(style)}`);
    await db.writings.bulkPut([{ id: 'rv-1', projectId: P, title: 'Uno', status: 'draft', content: '<p>Uno.</p><p>Las tres llaves del faro.</p>', wordCount: 5, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 }, { id: 'rv-2', projectId: P, title: 'Dos', status: 'draft', content: '<p>Dos.</p>', wordCount: 1, chapter: 2, tags: [], createdAt: 1, updatedAt: 1 }] as Writing[]);
    const picked = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Solo dos', selectedWritingIds: ['rv-2'] });
    assert(picked.ok && (await db.publishingProfiles.get((picked.result as { profile: { id: string } }).profile.id))?.selectionMode === 'selected', 'A list of pieces selects them');
    const listed = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: 'rv-1', list: true });
    const blocks = (listed.result as { blocks: { index: number; text: string }[] }).blocks;
    assert(listed.ok && blocks.length === 2 && blocks[1].text === 'Las tres llaves del faro.', `List: ${JSON.stringify(listed).slice(0, 300)}`);
    const wrong = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: 'rv-1', blockIndex: 0, expectText: 'Las tres llaves' });
    assert(!wrong.ok && /begins \\?"Uno\.\\?"/.test(JSON.stringify(wrong)) && (await db.writings.get('rv-1'))!.content.includes('<p>Uno.</p>'), 'A changed block is refused');
    const badType = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: 'rv-1', blockIndex: 1, type: 'dragon' });
    assert(!badType.ok && /type is one of/.test(JSON.stringify(badType)), 'Unknown card type refused');
    passed.push('Bridge: wh_table_query takes {op:"gt", value:10} as a number (Corona, Anillo) and refuses a null sort; bookStyle {preset:"epic"} is the epic style; selectedWritingIds alone selects those pieces; wh_extract_block_to_card lists the blocks, refuses a block whose text is not the expected one, and refuses an unknown card type');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }

  // The calendar view and the picker before the first era and in a missing leap month.
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const strict: WorldCalendar = { ...leap, allowNegativeYears: false, eras: [{ name: 'Era del Faro', abbr: 'EF', startYear: 100 }] };
  try {
    await act(async () => { root = createRoot(host); root.render(<CalendarView events={[]} timelines={[]} worldCalendar={strict} onAddEvent={() => {}} />); await pause(200); });
    for (let i = 0; i < 3; i++) await act(async () => { (document.querySelector('[data-testid="calendar-prev"]') as HTMLButtonElement).click(); await pause(60); });
    assert(document.querySelector('[data-testid="timeline-calendar"]') && /\b1 EF\b/.test(document.querySelector('[data-testid="calendar-title"]')?.textContent ?? ''), `Stays at the first era: ${document.querySelector('[data-testid="calendar-title"]')?.textContent}`);
    let typed = '';
    await act(async () => { root!.render(<WorldDateField calendar={leap} label="Fecha" value={typed} onChange={value => { typed = value; }} testId="rv" />); await pause(150); });
    await act(async () => { (document.querySelector('[data-testid="rv-picker"]') as HTMLButtonElement).click(); await pause(80); });
    const year = document.querySelector('[data-testid="rv-picker-year"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(year, '4'); year.dispatchEvent(new Event('input', { bubbles: true })); await pause(60); });
    await act(async () => { (document.querySelector('[data-testid="rv-picker-month-3"]') as HTMLButtonElement).click(); await pause(60); });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(year, '5'); year.dispatchEvent(new Event('input', { bubbles: true })); await pause(80); });
    assert(document.querySelector('[data-testid="rv-picker-panel"]') && document.querySelector('[data-testid="rv-picker-nodays"]') && document.querySelector('[data-testid="rv-picker-year"]'), 'The picker stays open and says the month has no days that year');
    passed.push('Calendar view: on a calendar that starts in year 100, "previous" stops at its first era instead of breaking; date picker: choosing the leap month in year 4 and then typing year 5 keeps the panel open and says that month has no days that year');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
  return passed;
}
