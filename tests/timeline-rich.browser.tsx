import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { db } from '@/db';
import { deleteCodexEntry, exportProjectData, importProjectData } from '@/db/operations';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Timeline, TimelineEvent } from '@/types';
import TimelineView from '@/engines/timeline/components/TimelineView';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import WorldCalendarEditor from '@/engines/timeline/components/WorldCalendarEditor';
import CharacterConnections from '@/components/codex/CharacterConnections';
import { useWorldCalendar } from '@/engines/timeline/useWorldCalendar';
import { defaultWorldCalendar, fromDayNumber, isLeapYear, toDayNumber, validateWorldCalendar } from '@/engines/timeline/worldCalendar';
import { resolveWorldCalendar, worldEventEndKey, worldEventKey, worldEventLabel } from '@/engines/timeline/worldCalendarStore';
import { chronologicalCompare } from '@/engines/timeline/worldEventForm';
import { eventEntryIds, safeEventImage } from '@/engines/timeline/eventDetails';
import { realEventTimeKey, validateEventClock } from '@/engines/timeline/eventClock';
import { validateTimelineDates } from '@/engines/timeline/dateValidation';
import { CALENDAR_PRESETS_KEY, deleteCalendarPreset, earthCalendar, loadCalendarPresets, saveCalendarPreset } from '@/engines/timeline/calendarPresets';
import { buildTimelineEvidenceFromParts } from '@/services/narrativeXray/coverageEvidence';
import { buildWorldBible, loadBibleData } from '@/services/worldBible';
import { eventContent } from '@/services/familyBridge/worldMap';
import { whCreateEvent, whUpdateEvent } from '@/services/aiBridge/tools/timeline';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let lastSaved: TimelineEvent | undefined;
function Harness({ mode, projectId, lane, initial }: { mode: 'list' | 'swim'; projectId: string; lane: Timeline; initial: TimelineEvent[] }) {
  const [events, setEvents] = useState(initial);
  const location = useLocation();
  const add = async (event: TimelineEvent) => { await db.timelineEvents.add(event); lastSaved = event; setEvents(current => [...current, event]); };
  const edit = async (id: string, changes: Partial<TimelineEvent>) => { await db.timelineEvents.update(id, changes); lastSaved = { ...events.find(event => event.id === id)!, ...changes }; setEvents(current => current.map(event => event.id === id ? { ...event, ...changes } : event)); };
  return <><output data-testid="location">{location.pathname}{location.search}</output>{mode === 'list' ? <TimelineView projectId={projectId} timelineId={lane.id} events={events} onAddEvent={add} onEditEvent={edit} onDeleteEvent={() => {}} /> : <SwimLaneView projectId={projectId} timelines={[lane]} events={events} connections={[]} onAddEvent={add} onEditEvent={edit} onDeleteEvent={() => {}} onAddConnection={() => {}} onEditConnection={() => {}} onDeleteConnection={() => {}} onEditTimeline={() => {}} />}</>;
}
function EditorHarness({ projectId }: { projectId: string }) {
  const resolved = useWorldCalendar(projectId);
  return <WorldCalendarEditor projectId={projectId} open resolved={resolved} onClose={() => {}} />;
}

export async function testTimelineRich(): Promise<string[]> {
  const passed: string[] = [];
  const gregorian = earthCalendar('en');
  assert(!isLeapYear(gregorian, 1900) && isLeapYear(gregorian, 2000) && !isLeapYear(gregorian, 2100), 'Gregorian century exceptions are wrong');
  for (const year of [-400, 0, 1, 1600, 1900, 2000, 2026, 2400]) for (const month of [1, 2, 3, 12]) {
    const date = { year, month, day: 1 }; const result = fromDayNumber(gregorian, toDayNumber(gregorian, date));
    assert(JSON.stringify(result) === JSON.stringify(date), 'Gregorian date roundtrip failed');
  }
  assert(toDayNumber(gregorian, { year: 2000, month: 3, day: 1 }) - toDayNumber(gregorian, { year: 2000, month: 2, day: 28 }) === 2, 'Gregorian leap day missing');
  assert(validateWorldCalendar({ ...gregorian, hoursPerDay: 0 }).length > 0 && validateWorldCalendar({ ...gregorian, hoursPerDay: 1001 }).length > 0, 'Invalid world hours accepted');
  assert(validateTimelineDates('2026-02-31', '') === 'timeline.dateInvalid', 'Impossible real date accepted');
  const world = { ...defaultWorldCalendar('Archipelago'), hoursPerDay: 30 };
  const base = { dateMode: 'world' as const, worldDate: { year: 1, month: 1, day: 1 }, time: '25:30', endTime: '26:15' };
  assert(validateEventClock(base, world) === null && validateEventClock({ ...base, time: '30:00' }, world) === 'timeline.details.badClock', 'World clock bounds are wrong');
  assert(validateEventClock({ ...base, endTime: '24:00' }, world) === 'timeline.dateEndBeforeStart', 'Backward same-day clock range accepted');
  assert(validateEventClock({ ...base, worldDate: { year: 1 } }, world) === 'timeline.details.exactDay', 'Time accepted on a partial date');
  assert(worldEventKey(base, world) === 25.5 / 30 && worldEventEndKey(base, world) === 26.25 / 30, 'World clock keys changed integer day arithmetic');
  assert(realEventTimeKey({ dateMode: 'calendar', realDate: '2026-10-20', time: '09:30' }) === Date.parse('2026-10-20T09:30:00Z'), 'Real clock depends on timezone');
  passed.push('timeline: Gregorian century math/BCE roundtrips, strict dates, 30-hour clocks, partial-date and backward-range validation');

  const stamp = Date.now(); const pid = `rich-timeline-${stamp}`, saga = `${pid}-saga`;
  const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, title: 'Timeline fixture', mode: 'novelist', type: 'standalone', color: '#000', status: 'draft', description: '', enabledEngines: ['timeline', 'codex'], engineOrder: ['timeline', 'codex'], createdAt: stamp, updatedAt: stamp, ...extra });
  const entry = (id: string, title: string): CodexEntry => ({ id, projectId: pid, type: 'character', title, content: '', fields: {}, tags: [], relations: [], createdAt: stamp, updatedAt: stamp });
  const ana = entry(`${pid}-ana`, 'Ana'), port = entry(`${pid}-port`, 'Port');
  const lane: Timeline = { id: `${pid}-lane`, projectId: pid, title: 'Voyage', color: '#c4973b', createdAt: stamp, updatedAt: stamp };
  const legacy: TimelineEvent = { id: `${pid}-event`, projectId: pid, timelineId: lane.id, title: 'Departure', description: 'The ship leaves the harbour.', date: '1 Month 1 1 CE', dateMode: 'world', worldDate: { year: 1, month: 1, day: 1 }, eventType: 'point', order: 0, lane: 'Voyage', color: '#c4973b', linkedEntryId: ana.id, createdAt: stamp, updatedAt: stamp };
  const host = document.getElementById('root')!;
  let root: Root | null = null;
  const render = async (element: React.ReactNode, path = `/project/${pid}/timeline`) => {
    if (root) await act(async () => { root!.unmount(); root = null; });
    await act(async () => { root = createRoot(host); root.render(<StrictMode><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></StrictMode>); await pause(100); });
    await act(async () => { await pause(120); });
  };
  const wait = async (message: string, test: () => boolean) => { for (let i = 0; i < 80; i++) { if (test()) return; await act(async () => { await pause(30); }); } throw new Error(message); };
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!;
  const type = async (input: HTMLInputElement | HTMLSelectElement | null, value: string) => {
    assert(input, `Missing input ${value}`); await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
  };
  const click = async (element: HTMLElement | undefined) => { assert(element, 'Missing click target'); await act(async () => { element.click(); await pause(80); }); };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const field = (id: string) => document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  try {
    await db.projects.bulkAdd([project(saga, { type: 'saga', worldCalendar: world }), project(pid, { parentId: saga })]);
    await db.codexEntries.bulkAdd([ana, port]); await db.timelines.add(lane); await db.timelineEvents.add(legacy);
    useLocaleStore.setState({ locale: 'en' });
    for (const mode of ['list', 'swim'] as const) {
      await render(<Harness mode={mode} projectId={pid} lane={lane} initial={[legacy]} />, `/project/${pid}/timeline?entity=${legacy.id}`);
      await wait('Deep-linked event did not open with inherited date', () => !!dialog() && field('world-date-start')?.value.includes('Month 1') === true);
      const checkboxes = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      assert(checkboxes.some(box => box.checked && box.closest('label')?.textContent?.includes('Ana')), 'Legacy primary card not loaded');
      await click(checkboxes.find(box => box.closest('label')?.textContent?.includes('Port')));
      await type(field('event-time'), '25:30'); await type(field('event-end-time'), '26:15');
      await type(field('event-icon') as unknown as HTMLSelectElement, 'ship');
      const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(PNG.split(',')[1]), char => char.charCodeAt(0))], 'ship.png', { type: 'image/png' }));
      const image = field('event-image')!; image.files = transfer.files; await act(async () => { image.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); });
      await click(button(t('timeline.save')));
      await wait('Rich event was not saved', () => !dialog() && !!lastSaved?.time);
      assert(lastSaved?.time === '25:30' && lastSaved.endTime === '26:15' && lastSaved.icon === 'ship' && safeEventImage(lastSaved.image), `${mode}: clock/image/icon lost`);
      assert(eventEntryIds(lastSaved!).join(',') === [ana.id, port.id].join(',') && lastSaved?.linkedEntryId === ana.id, `${mode}: multiple links/primary lost`);
      assert(lastSaved?.worldDate?.day === 1 && lastSaved.eventType === 'range', `${mode}: world date or timed range lost`);
      if (mode === 'list') assert(host.textContent?.includes('Port') && host.querySelector('img'), 'List read view missing linked cards/image');
      else {
        assert(host.querySelector('svg image'), 'Timeline node does not display its image');
        const node = host.querySelector<SVGGElement>('g[role="button"][aria-label^="Departure"]')!;
        assert(node && node.getAttribute('aria-label')?.includes('25:30'), 'Timeline keyboard label omits the event clock');
        await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await pause(50); });
        assert(host.querySelector('aside')?.textContent?.includes('Port'), 'Clicking an event does not expose its linked cards');
        await click([...host.querySelectorAll<HTMLButtonElement>('aside button')].find(button => button.textContent === 'Port'));
        assert(host.querySelector('[data-testid="location"]')?.textContent?.includes(`codex?entry=${port.id}`), 'Selected-event card does not navigate directly');
        await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(50); });
        assert(dialog() && field('event-time')?.value === '25:30', 'Keyboard Enter does not open the event editor');
        await click(button(t('timeline.cancel')));
      }
      passed.push(`timeline ${mode}: inherited-calendar deep link opens exact event, edits/persists multiple cards, image/icon and 30-hour range`);
    }
    // Create, rather than edit: worldDate used to be dropped by the list form.
    await render(<Harness mode="list" projectId={pid} lane={lane} initial={[]} />);
    await click(button(t('timeline.addEvent')));
    await type(dialog().querySelector<HTMLInputElement>(`input[placeholder="${t('timeline.placeholderEventName')}"]`), 'Arrival');
    await click(field('date-mode-world')!); await type(field('world-date-start'), '2 Month 1 1 CE'); await type(field('event-time'), '29:45');
    await click(button(t('timeline.create'))); await wait('New world event not saved', () => !dialog() && lastSaved?.title === 'Arrival');
    assert(lastSaved?.worldDate?.day === 2 && lastSaved.time === '29:45', 'New world event dropped canonical fields');
    const first = { ...legacy, time: '04:00' }, second = { ...legacy, id: `${legacy.id}-late`, time: '21:00', order: -1 };
    assert([second, first].sort(chronologicalCompare(world))[0] === first, 'Chronological list ignores clock');
    assert(worldEventLabel({ ...legacy, time: '25:30', endTime: '26:15' }, world).includes('25:30 – 26:15'), 'Clock omitted from live world label');
    passed.push('timeline: creating world-dated events preserves canonical date/time; chronological sorting includes clock');

    const existingPreset = await loadCalendarPresets();
    const one = await saveCalendarPreset('Thirty-hour world', world); const two = await saveCalendarPreset('Earth', gregorian);
    assert((await loadCalendarPresets()).some(preset => preset.id === one.id && preset.calendar.hoursPerDay === 30), 'Reusable preset not stored');
    await deleteCalendarPreset(two.id);
    await render(<EditorHarness projectId={pid} />);
    await wait('Calendar editor not ready', () => !!document.getElementById('wc-hours'));
    assert((document.getElementById('wc-hours') as HTMLInputElement).value === '30', 'Inherited hours did not load');
    (document.querySelector('details') as HTMLDetailsElement).open = true;
    const presets = document.querySelector<HTMLSelectElement>(`select[aria-label="${t('timeline.details.choosePreset')}"]`)!;
    await type(presets, 'earth'); await click(button(t('timeline.details.applyPreset')));
    assert((document.getElementById('wc-hours') as HTMLInputElement).value === '24' && (document.getElementById('wc-name') as HTMLInputElement).value === 'Gregorian', 'Earth preset did not populate calendar draft');
    assert((await resolveWorldCalendar(pid))?.inherited === true && (await db.projects.get(pid))?.worldCalendar === undefined, 'Loading a preset silently replaced inherited calendar');
    await type(document.querySelector(`input[aria-label="${t('timeline.details.presetName')}"]`), 'UI saved Gregorian');
    await click(button(t('timeline.details.savePreset')));
    assert((await loadCalendarPresets()).some(preset => preset.name === 'UI saved Gregorian' && preset.calendar.hoursPerDay === 24), 'Calendar preset UI did not save the actual draft');
    await click(button(t('timeline.details.deletePreset'))); await click(button(t('common.delete')));
    assert(!(await loadCalendarPresets()).some(preset => preset.name === 'UI saved Gregorian'), 'Preset delete confirmation did not delete the selected preset');
    await type(presets, one.id); await click(button(t('timeline.details.applyPreset'))); await click(document.querySelector('[data-testid="world-calendar-save"]') as HTMLElement);
    await wait('Own calendar was not saved', () => document.querySelector('[data-testid="world-calendar-errors"]') === null);
    assert((await db.projects.get(pid))?.worldCalendar?.hoursPerDay === 30 && (await db.projects.get(saga))?.worldCalendar?.hoursPerDay === 30, 'Saving inherited preset changed saga');
    await act(async () => { await db.settings.where('key').equals(CALENDAR_PRESETS_KEY).modify(row => { row.value = JSON.stringify(existingPreset); }); await pause(50); });
    passed.push('calendar: reusable presets store/load/delete; Earth/custom drafts and explicit own save preserve saga inheritance');

    const rich = { ...legacy, linkedEntryIds: [ana.id, port.id], image: PNG, icon: 'ship' as const, time: '25:30' };
    await db.timelineEvents.put(rich);
    const bible = buildWorldBible(await loadBibleData(pid), { sections: ['timeline', 'codex'] });
    assert(bible.html.includes('Port') && new DOMParser().parseFromString(bible.html, 'text/html').querySelector('section#timeline img'), 'World bible lost event links/image');
    assert(eventContent(rich).entities.length === 2, 'Family export loses secondary event links');
    const evidence = buildTimelineEvidenceFromParts({ projectId: pid, events: [rich], mentionedEntryIds: new Set([port.id]), writings: [], writingHashes: new Map(), overrides: { version: 1, rows: {} } });
    assert(evidence.rows[0].inferred === 'not_narrated', 'Narrative evidence ignores second linked character');
    const clonedId = await importProjectData(await exportProjectData(pid));
    const clonedEvent = (await db.timelineEvents.where('projectId').equals(clonedId).toArray()).find(event => event.title === rich.title)!;
    const clonedEntries = await db.codexEntries.where('projectId').equals(clonedId).toArray();
    assert(eventEntryIds(clonedEvent).length === 2 && eventEntryIds(clonedEvent).every(id => clonedEntries.some(entry => entry.id === id)), 'JSON import did not remap all event-card ids');
    await render(<CharacterConnections projectId={pid} entry={port} />);
    await wait('Secondary character has no timeline backlink', () => !!button('Departure'));
    await click(button('Departure')); // Actual URL points to the exact event.
    await deleteCodexEntry(port.id);
    assert(eventEntryIds((await db.timelineEvents.get(rich.id))!).join(',') === ana.id, 'Deleting secondary Codex card leaves event link dangling');
    await deleteCodexEntry(ana.id);
    assert(eventEntryIds((await db.timelineEvents.get(rich.id))!).length === 0, 'Deleting primary Codex card leaves event links dangling');
    passed.push('timeline: secondary-card backlinks, world-bible/family exports and evidence; JSON re-ID and deletion clean every link');

    // MCP reaches the same offline capabilities, with project scope and validation.
    const mcpCard = entry(`${pid}-mcp`, 'Bridge card'); await db.codexEntries.add(mcpCard);
    const created = await whCreateEvent({ projectId: pid, timelineId: lane.id, title: 'Bridge departure', dateMode: 'world', worldDate: '3 Month 1 1 CE', time: '27:20', linkedEntryIds: [mcpCard.id], icon: 'flag', image: PNG }) as { id: string };
    await whUpdateEvent({ projectId: pid, id: created.id, endTime: '28:00', linkedEntryIds: [] });
    const mcpEvent = (await db.timelineEvents.get(created.id))!;
    assert(mcpEvent.time === '27:20' && mcpEvent.endTime === '28:00' && eventEntryIds(mcpEvent).length === 0 && safeEventImage(mcpEvent.image), 'MCP create/update dropped details');
    let invalid = false; try { await whUpdateEvent({ projectId: pid, id: created.id, time: '30:00' }); } catch { invalid = true; }
    assert(invalid && (await db.timelineEvents.get(created.id))?.time === '27:20', 'Invalid MCP clock mutated the event');
    const foreign = { ...mcpCard, id: `${pid}-foreign`, projectId: saga }; await db.codexEntries.add(foreign);
    let foreignRejected = false; try { await whUpdateEvent({ projectId: pid, id: created.id, linkedEntryIds: [foreign.id] }); } catch { foreignRejected = true; }
    assert(foreignRejected && eventEntryIds((await db.timelineEvents.get(created.id))!).length === 0, 'MCP linked a foreign project card'); await db.codexEntries.delete(foreign.id);
    passed.push('timeline MCP: create/update new details, clearing all cards, clock validation and atomic rejection');
    await db.timelineEvents.where('projectId').equals(clonedId).delete(); await db.timelines.where('projectId').equals(clonedId).delete(); await db.codexEntries.where('projectId').equals(clonedId).delete(); await db.projects.delete(clonedId);
    return passed;
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    await db.timelineEvents.where('projectId').equals(pid).delete(); await db.timelines.where('projectId').equals(pid).delete(); await db.codexEntries.where('projectId').equals(pid).delete(); await db.projects.bulkDelete([pid, saga]);
  }
}

/** Stable visual fixture for the real timeline, with current app CSS. */
export async function previewTimelineRich(): Promise<string[]> {
  const now = Date.now(); const pid = `timeline-preview-${now}`;
  const calendar = { ...defaultWorldCalendar('Calendario de la Costa'), hoursPerDay: 30, months: [{ name: 'Escarcha', days: 30 }, { name: 'Deshielo', days: 28 }], eras: [{ name: 'Era del Faro', abbr: 'EF', startYear: 1 }] };
  await db.projects.add({ id: pid, title: 'Crónicas de la Costa', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#d5b575', enabledEngines: ['timeline', 'codex'], engineOrder: ['timeline', 'codex'], worldCalendar: calendar, createdAt: now, updatedAt: now });
  const entries: CodexEntry[] = ['Ana de la Costa', 'Bahía del Faro'].map((title, i) => ({ id: `${pid}-card-${i}`, projectId: pid, title, type: i ? 'location' : 'character', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now }));
  await db.codexEntries.bulkAdd(entries);
  const lane: Timeline = { id: `${pid}-lane`, projectId: pid, title: 'Viaje de Ana', color: '#d5b575', createdAt: now, updatedAt: now };
  await db.timelines.add(lane);
  const events: TimelineEvent[] = ['Salida de Puerto Ámbar', 'Regreso al faro'].map((title, i) => ({ id: `${pid}-event-${i}`, projectId: pid, timelineId: lane.id, title, description: i ? 'Ana vuelve a la bahía con el tratado. Las dos fichas mantienen el contexto a un clic.' : 'La expedición zarpa antes del primer relevo de guardia.', date: '', dateMode: 'world', worldDate: { year: 431, month: 2, day: i ? 21 : 4 }, time: i ? '25:30' : '06:00', endTime: i ? '26:15' : undefined, icon: 'ship', eventType: i ? 'range' : 'point', order: i, lane: 'Trama principal', color: '#d5b575', linkedEntryId: entries[0].id, linkedEntryIds: entries.map(entry => entry.id), createdAt: now, updatedAt: now }));
  await db.timelineEvents.bulkAdd(events);
  useLocaleStore.setState({ locale: 'es' });
  const host = document.getElementById('root')!; host.style.cssText = 'max-width:1200px;margin:32px auto;padding:0 24px';
  const root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><Harness mode="swim" projectId={pid} lane={lane} initial={events} /></MemoryRouter>); await pause(100); });
  await act(async () => { await pause(200); });
  await act(async () => { host.querySelectorAll('g[role="button"]')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); await pause(100); });
  return ['timeline visual fixture: direct event inspector, readable clock and Codex links'];
}
