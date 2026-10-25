// Real consumers and registered bridge handlers keep the existing date schema.
// This is a renderer dispatch/IndexedDB/ZIP test, not a new HTTP or stdio host.
import '@/engines/timeline';
import '@/engines/writings';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLiveQuery } from 'dexie-react-hooks';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';
import TimelineView from '@/engines/timeline/components/TimelineView';
import ChapterWorldDate from '@/engines/writings/components/ChapterWorldDate';
import { updateTimelineEvent } from '@/engines/timeline/operations';
import { updateWriting } from '@/engines/writings/operations';
import { defaultWorldCalendar, formatWorldDate, parseWorldDate, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import type { Project, Timeline, TimelineEvent, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 35) => new Promise(resolve => setTimeout(resolve, ms));
const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const result = document.querySelector<T>(`[data-testid="${id}"]`); assert(result, `Missing ${id}`); return result;
};
async function wait(check: () => boolean | Promise<boolean>, message: string) {
  const until = performance.now() + 12000;
  while (performance.now() < until) {
    let ready = false;
    await act(async () => { ready = await check(); if (!ready) await pause(); });
    if (ready) return;
  }
  throw new Error(message + ': ' + document.body.textContent?.slice(-1000));
}
async function click(node: HTMLElement) { await act(async () => { node.click(); await pause(); }); }
async function input(id: string, value: string) {
  await act(async () => {
    const node = byId<HTMLInputElement | HTMLSelectElement>(id);
    Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
  });
}
const button = (label: string) => {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label); assert(result, `Missing button ${label}`); return result;
};

export async function testWorldDateControlsPersistence(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const P = `date-controls-${crypto.randomUUID()}`, T = `${P}-timeline`, E = `${P}-event`, W = `${P}-writing`, passed: string[] = [];
  const projectCalendar: WorldCalendar = { ...defaultWorldCalendar('Manuscript calendar'), months: [{ name: 'Frost', days: 30 }, { name: 'Thaw', days: 28 }], moons: [] };
  const timelineCalendar: WorldCalendar = { ...projectCalendar, name: 'Harbour calendar', months: [{ name: 'Harbour', days: 30 }, { name: 'Escarcha', days: 28 }], correlation: { date: { year: 4, month: 2, day: 5 }, earth: '2030-01-01' } };
  const start = { year: 4, month: 2, day: 5 }, end = { year: 4, month: 2, day: 10 };
  const project: Project = { id: P, title: 'Date controls fixture', type: 'standalone', mode: 'custom', description: '', status: 'draft', color: '#888888', enabledEngines: ['timeline', 'writings'], worldCalendar: projectCalendar, createdAt: 1, updatedAt: 1 };
  const timeline: Timeline = { id: T, projectId: P, title: 'Harbour events', color: '#888888', worldCalendar: timelineCalendar, createdAt: 1, updatedAt: 1 };
  const event: TimelineEvent = { id: E, projectId: P, timelineId: T, title: 'Arrival', description: 'Preserved detail', dateMode: 'world', worldDate: start, worldDateEnd: end, date: `${formatWorldDate(timelineCalendar, start)} – ${formatWorldDate(timelineCalendar, end)}`, eventType: 'range', order: 0, lane: 'Ships', color: '#888888', createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: W, projectId: P, title: 'Chapter', content: '<p>The ship keeps its course.</p>', wordCount: 6, status: 'draft', tags: [], worldDate: { year: 4, month: 1, day: 2 }, worldDateEnd: { year: 4, month: 2, day: 3 }, createdAt: 1, updatedAt: 1 };
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null, eventSaves = 0;
  const unmount = async () => { if (root) await act(async () => { root?.unmount(); root = null; await pause(); }); };
  async function render(content: ReactNode) { await unmount(); await act(async () => { root = createRoot(host!); root.render(<MemoryRouter>{content}</MemoryRouter>); await pause(); }); }
  async function renderEvent() {
    const stored = (await db.timelineEvents.get(E))!;
    await render(<TimelineView projectId={P} timelineId={T} events={[stored]} requestedEventId={E} onAddEvent={() => { throw new Error('Unexpected creation'); }} onDeleteEvent={() => { throw new Error('Unexpected deletion'); }} onEditEvent={async (id, changes) => { eventSaves++; await updateTimelineEvent(id, changes); }} />);
    await wait(() => !!document.querySelector('[data-testid="world-date-start"]'), 'Event date form did not open');
  }
  function Chapter() {
    const row = useLiveQuery(() => db.writings.get(W), []);
    return row ? <ChapterWorldDate projectId={P} writing={row} onUpdate={updateWriting} /> : null;
  }
  try {
    await db.projects.add(project); await db.timelines.add(timeline); await db.timelineEvents.add(event); await db.writings.add(writing);
    const originalEvent = JSON.stringify(await db.timelineEvents.get(E));
    await renderEvent();
    assert(byId<HTMLInputElement>('world-date-start').value.includes('Escarcha'), 'The form used the project calendar instead of the independent timeline calendar');
    await click(byId('world-date-start-picker')); await click(byId('world-date-start-picker-next')); await click(byId('world-date-start-picker-prev'));
    await click(byId('world-date-start-picker-exact')); await input('world-date-start-exact-day', '6');
    await click(byId('world-date-start-exact-cancel'));
    assert(JSON.stringify(await db.timelineEvents.get(E)) === originalEvent && eventSaves === 0, 'Navigation or exact Cancel changed the stored event');
    await click(byId('world-date-start-picker-exact')); await input('world-date-start-exact-day', '7'); await click(byId('world-date-start-exact-apply'));
    await click(byId('world-date-end-clear'));
    assert(JSON.stringify(await db.timelineEvents.get(E)) === originalEvent && eventSaves === 0, 'Apply or end Clear bypassed the parent Save contract');
    await click(button(t('timeline.save')));
    await wait(async () => (await db.timelineEvents.get(E))?.worldDate?.day === 7 && !document.querySelector('[data-testid="world-date-start"]'), 'Parent Save did not persist and close the event');
    const saved = (await db.timelineEvents.get(E))!;
    assert(saved.worldDate?.month === 2 && saved.worldDateEnd === undefined && saved.description === event.description && eventSaves === 1, 'Save lost dates, description or issued duplicate writes');
    await renderEvent();
    assert(byId<HTMLInputElement>('world-date-start').value === formatWorldDate(timelineCalendar, { year: 4, month: 2, day: 7 }) && byId<HTMLInputElement>('world-date-end').value === '', 'Cold form reopen lost the saved date or removed end');
    await click(byId('world-date-start-clear'));
    assert(button(t('timeline.save')).disabled && (await db.timelineEvents.get(E))?.worldDate?.day === 7, 'A cleared required event start saved an invalid world event');
    await click(button(t('timeline.cancel'))); await unmount();
    passed.push('Actual TimelineView: cursor and exact draft/Cancel do not write; Apply/end Clear wait for parent Save; a cleared start disables Save; cold reopen preserves the independent calendar and saved dates');

    const beforeDescribe = JSON.stringify(await db.timelineEvents.get(E));
    const described = await runBridgeTool('wh_world_date', { projectId: P, timelineId: T, earthDate: '2030-01-01' });
    assert(described.ok && JSON.stringify((described.result as { date: unknown }).date) === JSON.stringify(start), `Registered date conversion failed: ${JSON.stringify(described)}`);
    assert(JSON.stringify(await db.timelineEvents.get(E)) === beforeDescribe, 'Readonly date conversion changed the event');
    const updated = await runBridgeTool('wh_update_event', { projectId: P, id: E, worldDate: { year: 5, month: 2, day: 8 }, worldDateEnd: '' });
    assert(updated.ok && (await db.timelineEvents.get(E))?.worldDate?.day === 8, `Registered event update failed: ${JSON.stringify(updated)}`);
    await renderEvent();
    assert(parseWorldDate(timelineCalendar, byId<HTMLInputElement>('world-date-start').value)?.year === 5, 'The normal form did not read the registered tool update');
    await unmount();
    passed.push('Actual registered renderer dispatch: wh_world_date returns the same correlated world day without writes; wh_update_event dates remain visible in the real event form (no invented transport claim)');

    await render(<Chapter />);
    await wait(() => !!document.querySelector('[data-testid="chapter-world-date-start"]'), 'Chapter date form did not open');
    const chapterBefore = JSON.stringify(await db.writings.get(W));
    await click(byId('chapter-world-date-start-picker')); await click(byId('chapter-world-date-start-picker-exact')); await input('chapter-world-date-start-exact-day', '9');
    await act(async () => { await pause(650); });
    assert(JSON.stringify(await db.writings.get(W)) === chapterBefore, 'Unapplied exact draft escaped into the chapter debounce');
    await click(byId('chapter-world-date-start-exact-apply'));
    await wait(async () => (await db.writings.get(W))?.worldDate?.day === 9, 'Chapter exact Apply did not follow its existing debounce');
    await click(byId('chapter-world-date-end-clear'));
    await wait(async () => (await db.writings.get(W))?.worldDateEnd === undefined, 'Chapter optional end did not clear');
    await click(byId('chapter-world-date-start-clear'));
    await wait(async () => { const row = (await db.writings.get(W))!; return row.worldDate === undefined && row.worldDateEnd === undefined; }, 'A chapter start without optional must still be clearable');
    assert((await db.writings.get(W))?.content === writing.content, 'Date controls changed the chapter prose');
    await unmount();
    const chapterUpdated = await runBridgeTool('wh_update_writing', { projectId: P, id: W, worldDate: { year: 4, month: 1, day: 3 }, worldDateEnd: { year: 4, month: 2, day: 4 } });
    assert(chapterUpdated.ok, `Registered chapter update failed: ${JSON.stringify(chapterUpdated)}`);
    await render(<Chapter />);
    await wait(() => !!document.querySelector('[data-testid="chapter-world-date-start"]'), 'Chapter did not reopen');
    assert(parseWorldDate(projectCalendar, byId<HTMLInputElement>('chapter-world-date-start').value)?.day === 3 && byId<HTMLInputElement>('chapter-world-date-start').value.includes('Frost'), 'Chapter tool update did not reopen in the project calendar');
    await unmount();
    passed.push('Actual ChapterWorldDate: pending exact draft stays private past the debounce; Apply follows normal persistence; end and start Clear keep their existing optional semantics and preserve prose; registered chapter update reopens');

    const expectedProject = (await db.projects.get(P))!, expectedTimeline = (await db.timelines.get(T))!, expectedEvent = (await db.timelineEvents.get(E))!, expectedWriting = (await db.writings.get(W))!;
    const archive = await createProjectZipArchive(P), zip = await JSZip.loadAsync(await archive.blob.arrayBuffer());
    const entry = (suffix: string) => { const file = Object.values(zip.files).find(file => file.name.endsWith(suffix)); assert(file, `Missing ZIP ${suffix}`); return file; };
    const exportedProject = JSON.parse(await entry('/project.json').async('string')) as Project;
    const exportedTimelines = JSON.parse(await entry('/timeline/timelines.json').async('string')) as Timeline[];
    const exportedEvents = JSON.parse(await entry('/timeline/timelineEvents.json').async('string')) as TimelineEvent[];
    const exportedWriting = JSON.parse(await entry(`__${W}.json`).async('string')) as Writing;
    assert(JSON.stringify(exportedProject.worldCalendar) === JSON.stringify(expectedProject.worldCalendar) && JSON.stringify(exportedTimelines[0].worldCalendar) === JSON.stringify(expectedTimeline.worldCalendar), 'ZIP dropped effective project or timeline calendar');
    assert(JSON.stringify(exportedEvents[0]) === JSON.stringify(expectedEvent) && JSON.stringify(exportedWriting) === JSON.stringify(expectedWriting), 'ZIP changed structured dates or persisted unrelated fields');
    await db.timelineEvents.update(E, { worldDate: { year: 1 }, worldDateEnd: undefined }); await db.writings.update(W, { worldDate: undefined, worldDateEnd: undefined }); await db.timelines.update(T, { worldCalendar: undefined });
    await importProjectZip(new File([archive.blob], 'date-controls.zip'), { replaceProjectIds: [P] });
    assert(JSON.stringify(await db.timelineEvents.get(E)) === JSON.stringify(expectedEvent) && JSON.stringify(await db.writings.get(W)) === JSON.stringify(expectedWriting) && JSON.stringify((await db.timelines.get(T))?.worldCalendar) === JSON.stringify(expectedTimeline.worldCalendar), 'Actual ZIP restore lost dates, prose or independent calendar');
    passed.push('Actual project ZIP export and replacement import preserve exact event/chapter rows, project calendar and independent timeline correlation without a schema change');
    return passed;
  } finally { await unmount(); await deleteProject(P); }
}
