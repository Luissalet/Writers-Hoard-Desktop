import '@/engines/timeline/index';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import EventDetailsFields from '@/engines/timeline/components/EventDetailsFields';
import { emptyEventDetails } from '@/engines/timeline/eventDetails';
import { useLocaleStore } from '@/stores/localeStore';
import CalendarView from '@/engines/timeline/components/CalendarView';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { readEraRow, saveWorldEra } from '@/services/worldEras/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import type { TimelineEvent } from '@/types';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const P = 'qa-calendar-banner-shapes', T = `${P}-timeline`;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const eventArgs = { projectId: P, timelineId: T, title: 'Arrival', dateMode: 'calendar', realDate: '1500-01-10', realDateEnd: '1500-01-12', eventType: 'range', repeat: { every: 'week' }, bannerPattern: 'stripes' };
async function seed() {
  await db.projects.put({ id: P, title: 'Banner QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 });
  await db.timelines.put({ id: T, projectId: P, title: 'Harbour', color: '#c4973b', createdAt: 1, updatedAt: 1 });
}
async function clean(projectId = P) {
  for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(projectId).delete();
  await db.projects.delete(projectId);
}

export async function testCalendarBannerShapeContract(): Promise<string[]> {
  const execute = createToolExecutor({ writesEnabled: async () => true, relay: runBridgeTool, audit: async () => 0 });
  const call = (tool: string, args: Record<string, unknown>) => execute({ tool, args }, { origin: 'bridge', projectId: P });
  try {
    await seed();
    const args = eventArgs;
    for (const tool of ['wh_create_event', 'wh_update_event']) assert(JSON.stringify(getBridgeTool(tool)?.schema.properties.bannerShape).includes('scallop'), `${tool} does not expose the shape schema`);
    const made = await call('wh_create_event', { ...args, bannerShape: 'ribbon' });
    assert(made.ok, `Registered create does not accept a shape independent of its pattern: ${JSON.stringify(made)}`);
    const event = (await db.timelineEvents.where('projectId').equals(P).toArray())[0];
    assert(event, 'Created event missing');
    assert((event as unknown as Record<string, unknown>).bannerShape === 'ribbon', 'Registered create silently ignored the requested Ribbon shape');
    for (const shape of ['ribbon', 'bunting', 'scallop', 'plain']) {
      const changed = await call('wh_update_event', { id: event.id, bannerShape: shape });
      assert(changed.ok, `${shape}: ${JSON.stringify(changed)}`);
      const listed = await call('wh_list_events', { projectId: P, timelineId: T });
      const reply = (listed.result as { events: Array<Record<string, unknown>> }).events[0];
      assert(reply.bannerShape === shape && reply.bannerPattern === 'stripes', `Shape and pattern not independent: ${JSON.stringify(reply)}`);
      const stored = (await db.timelineEvents.get(event.id))!;
      assert(stored.realDate === args.realDate && stored.realDateEnd === args.realDateEnd && stored.repeat?.every === 'week', 'Changing a shape altered the event range or repeat');
    }
    const before = JSON.stringify(await db.timelineEvents.get(event.id));
    for (const invalid of ['zigzag', ['ribbon'], null]) {
      const bad = await call('wh_update_event', { id: event.id, bannerShape: invalid });
      assert(!bad.ok && bad.code === 'bad-args' && JSON.stringify(await db.timelineEvents.get(event.id)) === before, 'Invalid shape wrote the event');
    }
    return ['Registered create/update/list preserve four banner shapes independently of stripes and weekly range; invalid shape does not write'];
  } finally {
    await clean();
  }
}

export async function testCalendarBannerShapeRendering(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  useLocaleStore.setState({ locale: 'en' });
  const event: TimelineEvent = { id: 'shape-render', projectId: P, timelineId: T, title: 'Arrival at the harbour', date: '', dateMode: 'calendar', realDate: '1500-01-10', realDateEnd: '1500-01-12', eventType: 'range', repeat: { every: 'week' }, color: '#4c6092', order: 0, lane: '', createdAt: 1, updatedAt: 1 };
  const render = async (key: string, row: TimelineEvent) => { await act(async () => { root.render(<CalendarView key={key} events={[row]} timelines={[]} worldCalendar={null} onAddEvent={() => {}} />); await pause(); }); };
  const band = (day: number) => document.querySelector<HTMLElement>(`[data-testid="calendar-day-${day}"] [data-testid="calendar-event"]`)!;
  try {
    await render('legacy', event);
    const legacyStyle = band(10).getAttribute('style');
    await render('plain', { ...event, bannerShape: 'plain' });
    assert(band(10).getAttribute('style') === legacyStyle && band(11).textContent === event.title, 'Explicit Plain changed legacy bands');
    for (const shape of ['ribbon', 'bunting', 'scallop'] as const) for (const pattern of [undefined, 'stripes', 'dots', 'checks'] as const) {
      await render(`${shape}-${pattern}`, { ...event, bannerShape: shape, bannerPattern: pattern });
      const coverage = [...document.querySelectorAll<HTMLElement>('[data-testid^="calendar-day-"]')].filter(day => day.querySelector('[data-testid="calendar-event"]')).map(day => day.dataset.testid?.replace('calendar-day-', '')).join(',');
      assert(coverage === '10,11,12,17,18,19,24,25,26,31', `${shape} altered weekly coverage: ${coverage}`);
      assert(band(10).dataset.banner === 'start' && band(11).dataset.banner === 'middle' && band(12).dataset.banner === 'end', 'Shape lost true range ends');
      assert(band(10).firstChild?.nodeType === Node.TEXT_NODE && band(11).querySelector('.sr-only')?.textContent === event.title, 'Decorative shape repeats the middle title or loses accessible text');
      const computed = getComputedStyle(band(10));
      if (shape === 'ribbon') assert(computed.clipPath.includes('6px') && !getComputedStyle(band(11)).clipPath.includes('6px'), 'Ribbon notches repeat at interior joins');
      else assert(computed.maskImage.includes(shape === 'bunting' ? 'data:image/svg+xml' : 'radial-gradient') && computed.paddingBottom === '4px', `${shape} lower edge not painted by Chromium`);
      if (pattern) assert(band(10).dataset.pattern === pattern && computed.backgroundImage !== 'none', 'Shape removed patterned fill');
    }
    await render('carry', { ...event, bannerShape: 'ribbon' });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="calendar-next"]')!.click(); await pause(); });
    assert(band(1).dataset.banner === 'middle' && band(1).firstChild?.nodeType === Node.TEXT_NODE && band(2).dataset.banner === 'end', 'Month carry lost end or first visible title');
    await render('week', { ...event, bannerShape: 'ribbon', realDate: '1500-01-06', realDateEnd: '1500-01-09', repeat: undefined });
    assert(band(8).dataset.banner === 'middle' && band(8).firstChild?.nodeType === Node.TEXT_NODE && band(7).querySelector('.sr-only'), 'New week did not repeat the visible title once');
    await render('single', { ...event, bannerShape: 'ribbon', realDateEnd: undefined, repeat: undefined, eventType: 'point' });
    assert(band(10).dataset.banner === 'single' && band(10).style.clipPath.includes('6px'), 'Single-day Ribbon has no ends');
    return ['Real CalendarView keeps Plain exact, paints three distinct decorative edges with every fill, preserves weekly/month carry, and labels occurrence/week starts without middle duplicates'];
  } finally { await act(async () => { root.unmount(); await pause(); }); }
}

export async function testCalendarBannerShapeEditor(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const root = createRoot(document.getElementById('root')!);
  const passed: string[] = [];
  const click = async (node: HTMLElement | null) => { assert(node, 'Missing UI action'); await act(async () => { node.click(); await pause(); }); };
  const select = async (testId: string, value: string) => { const node = document.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`); assert(node, `Missing ${testId}`); await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); await pause(); }); };
  try {
    await seed();
    assert((await runBridgeTool('wh_create_event', { ...eventArgs, bannerShape: 'ribbon' })).ok, 'Seed event');
    const event = (await db.timelineEvents.where('projectId').equals(P).toArray())[0];
    const render = async (key: string, eraId?: string) => {
      await act(async () => { root.render(<MemoryRouter key={key} initialEntries={[`/project/${P}/timeline?view=calendar`]}><EnginePaneContext.Provider value={{ instanceId: 'banner-shape', projectId: P, eraId, visible: true }}><TimelineEngine projectId={P} /></EnginePaneContext.Provider></MemoryRouter>); await pause(); });
      for (let i = 0; i < 35 && !document.querySelector('[data-testid="calendar-day-10"]'); i++) await act(async () => { await pause(); });
    };
    const open = async () => {
      await click(document.querySelector('[data-testid="calendar-day-10"]'));
      await click(document.querySelector(`[data-testid="calendar-open-event-${event.id}"]`));
      for (let i = 0; i < 35 && !document.querySelector('[data-testid="event-banner-shape"]'); i++) await act(async () => { await pause(); });
    };
    const save = async () => { await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Save') ?? null); await act(async () => { await pause(); }); };
    await render('base'); await open();
    assert(document.querySelector<HTMLSelectElement>('[data-testid="event-banner-shape"]')?.value === 'ribbon', 'Real editor did not load Ribbon');
    await select('event-banner-shape', 'scallop'); await select('event-banner-pattern', 'checks'); await save();
    const stored = (await db.timelineEvents.get(event.id))!;
    assert(stored.bannerShape === 'scallop' && stored.bannerPattern === 'checks' && stored.repeat?.every === 'week' && stored.realDateEnd === '1500-01-12', 'Actual editor lost shape/pattern/range/repeat');
    await open();
    assert(document.querySelector<HTMLSelectElement>('[data-testid="event-banner-shape"]')?.value === 'scallop', 'Reopened actual editor lost Scallop');
    await select('event-banner-shape', 'plain'); await save();
    assert((await db.timelineEvents.get(event.id))?.bannerShape === undefined && (await db.timelineEvents.get(event.id))?.bannerPattern === 'checks', 'Plain did not clear only the decorative shape');
    passed.push('Normal Calendar-to-editor changes Ribbon to Scallop with Checks, saves/reopens it and clears only the shape with Plain');
    await act(async () => { await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null); await pause(); });
    const base = JSON.stringify(await db.timelineEvents.get(event.id));
    await render('era', 'past'); await open(); await select('event-banner-shape', 'bunting'); await save();
    const effective = await readEraRow<TimelineEvent>({ projectId: P, eraId: 'past' }, 'timelineEvents', event.id);
    assert(effective?.bannerShape === 'bunting' && effective.bannerPattern === 'checks' && JSON.stringify(await db.timelineEvents.get(event.id)) === base, 'Era form changed Base or lost fill');
    const listed = await runBridgeTool('wh_list_events', { projectId: P, timelineId: T, eraId: 'past' });
    assert((listed.result as { events: Array<{ bannerShape: string }> }).events[0].bannerShape === 'bunting', 'MCP era disagrees with normal editor');
    passed.push('Actual era editor changes only the inherited variant to Bunting and native MCP agrees while Base stays exact');
    return passed;
  } finally { await act(async () => { root.unmount(); await pause(); }); await clean(); }
}

export async function testCalendarBannerShapeUndoPortable(): Promise<string[]> {
  let clone = '';
  try {
    await seed();
    const created = await runBridgeTool('wh_create_event', eventArgs); assert(created.ok, 'Legacy seed');
    const legacy = (await db.timelineEvents.where('projectId').equals(P).toArray())[0];
    const beforeRead = JSON.stringify(legacy);
    const listed = await runBridgeTool('wh_list_events', { projectId: P, timelineId: T });
    assert((listed.result as { events: Array<{ bannerShape: string }> }).events[0].bannerShape === 'plain' && JSON.stringify(await db.timelineEvents.get(legacy.id)) === beforeRead, 'Reading default shape migrated legacy row');
    const changed = await runBridgeTool('wh_update_event', { id: legacy.id, bannerShape: 'scallop' }); assert(changed.ok, 'Shape update');
    const undone = await runBridgeTool('__undo', { entry: { ...(changed.result as { __audit: object }).__audit, tool: 'wh_update_event', kind: 'update' } });
    assert(undone.ok && !Object.hasOwn((await db.timelineEvents.get(legacy.id))!, 'bannerShape'), `Undo did not restore absent legacy shape: ${JSON.stringify(undone)}`);
    const shaped = await runBridgeTool('wh_create_event', { ...eventArgs, title: 'Ribbon portable', bannerShape: 'ribbon', bannerPattern: 'dots' }); assert(shaped.ok, 'Portable event');
    const shapedRow = (await db.timelineEvents.where('projectId').equals(P).toArray()).find(row => row.title === 'Ribbon portable')!;
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const base = JSON.stringify(await db.timelineEvents.get(shapedRow.id));
    const receipts: AuditLine[] = [];
    const execute = createToolExecutor({ writesEnabled: async () => true, relay: runBridgeTool, audit: async line => { receipts.push(line); return receipts.length - 1; } });
    const eraChange = await execute({ tool: 'wh_update_event', args: { projectId: P, eraId: 'past', id: shapedRow.id, bannerShape: 'bunting' } }, { origin: 'bridge', projectId: P }); assert(eraChange.ok, `Era MCP shape: ${JSON.stringify(eraChange)}`);
    const receipt = receipts[0];
    assert(receipt.eraId === 'past', 'Normal update receipt lost the era');
    const eraUndo = await runBridgeTool('__undo', { entry: { ...receipt, tool: 'wh_update_event', kind: 'update' } });
    assert(eraUndo.ok && (await readEraRow<TimelineEvent>({ projectId: P, eraId: 'past' }, 'timelineEvents', shapedRow.id))?.bannerShape === 'ribbon' && JSON.stringify(await db.timelineEvents.get(shapedRow.id)) === base, `Era Undo escaped scope: ${JSON.stringify(eraUndo)}`);
    clone = await importProjectData(await exportProjectData(P));
    const cloned = await db.timelineEvents.where('projectId').equals(clone).toArray();
    const clonedShape = cloned.find(row => row.title === shapedRow.title), clonedLegacy = cloned.find(row => row.title === legacy.title);
    assert(clonedShape?.bannerShape === 'ribbon' && clonedShape.bannerPattern === 'dots' && clonedLegacy && !Object.hasOwn(clonedLegacy, 'bannerShape'), 'JSON clone lost a shape/pattern or filled legacy shape');
    const zip = await createProjectZipArchive(P);
    await db.timelineEvents.update(shapedRow.id, { bannerShape: undefined });
    await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert((await db.timelineEvents.get(shapedRow.id))?.bannerShape === 'ribbon' && (await db.timelineEvents.get(shapedRow.id))?.bannerPattern === 'dots' && !Object.hasOwn((await db.timelineEvents.get(legacy.id))!, 'bannerShape'), 'Real ZIP restore lost shape/pattern or migrated legacy');
    return ['Normal Undo restores an absent shape, era Undo restores Ribbon without Base writes, JSON clone and ZIP preserve new shape plus fill and keep legacy shape absent'];
  } finally { if (clone) await clean(clone); await clean(); }
}

export async function testCalendarBannerShapeFields(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const root = createRoot(document.getElementById('root')!);
  function Fields() {
    const [value, setValue] = useState(emptyEventDetails());
    return <EventDetailsFields value={value} onChange={next => setValue(current => ({ ...current, ...next }))} entries={[]} mode="calendar" />;
  }
  try {
    await act(async () => { root.render(<MemoryRouter><Fields /></MemoryRouter>); await pause(); });
    const shape = document.querySelector<HTMLSelectElement>('[data-testid="event-banner-shape"]');
    assert(shape, 'Existing event editor has no distinct banner-shape selector');
    assert([...shape.options].map(option => option.value).join(',') === 'plain,ribbon,bunting,scallop', 'Four observed shapes missing');
    assert(shape.labels?.length && shape.labels[0].textContent?.includes('shape'), 'Shape selector has no accessible label');
    const pattern = document.querySelector<HTMLSelectElement>('[data-testid="event-banner-pattern"]')!;
    assert([...pattern.options].map(option => option.value).join(',') === ',stripes,dots,checks', 'Shape replaced an existing fill pattern');
    await act(async () => { shape.value = 'ribbon'; shape.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { pattern.value = 'dots'; pattern.dispatchEvent(new Event('change', { bubbles: true })); });
    assert(shape.value === 'ribbon' && pattern.value === 'dots', 'Changing the fill lost the selected shape');
    return ['Existing editor exposes labelled shape and pattern separately and retains Ribbon while selecting Dots'];
  } finally {
    await act(async () => { root.unmount(); await pause(); });
  }
}
