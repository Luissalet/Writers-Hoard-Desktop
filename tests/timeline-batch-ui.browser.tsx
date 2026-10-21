import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { listEraRows, saveWorldEra } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';
import type { TimelineEvent } from '@/types';
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40)); let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw Error('Timeline UI handshake timed out'); }
async function settle(check: () => boolean) { for (let i = 0; i < 180; i++) { if (check()) return; await act(async () => { await pause(); }); } throw Error('Timeline UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
export async function testTimelineBatchUi() {
  const P = `timeline-batch-ui-${Date.now()}`, timelineId = `${P}-line`, host = document.getElementById('root')!, root = createRoot(host), results: string[] = [];
  const scope = { projectId: P, eraId: 'later' }, id1 = `${P}-departure`, id2 = `${P}-arrival`;
  let mounted = false;
  try {
    useLocaleStore.setState({ locale: 'es' });
    await db.projects.put({ id: P, title: 'Synthetic timeline', type: 'standalone', mode: 'custom', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 });
    await db.timelines.put({ id: timelineId, projectId: P, title: 'La expedición', color: '#c4973b', createdAt: 1, updatedAt: 1 });
    await db.timelineEvents.bulkPut([{ id: id1, title: 'Salida del puerto', realDate: '2026-10-20', order: 0 }, { id: id2, title: 'Llegada a la isla', realDate: '2026-10-24', order: 1 }].map(event => ({ ...event, projectId: P, timelineId, description: 'Un viaje de cuatro días', date: event.realDate, dateMode: 'calendar', eventType: 'point', lane: 'La expedición', color: '#c4973b', createdAt: 1, updatedAt: 1 })));
    await db.timelineConnections.put({ id: `${P}-link`, projectId: P, timelineId, sourceEventId: id1, targetEventId: id2, color: '#c4973b', style: 'solid', label: 'Cuatro días', createdAt: 1 });
    await saveWorldEra(P, { id: 'later', name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const read = () => listEraRows<TimelineEvent>(scope, 'timelineEvents');
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
    for (const width of [1440, 640]) {
      const n = ++sequence;
      await act(async () => { channel.__want = { w: width, h: 1100, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `timeline-${width}`, projectId: P, eraId: 'later', visible: true, primary: true }}><main className="min-h-screen bg-deep p-4 text-text-primary"><TimelineEngine key={width} projectId={P} /></main></EnginePaneContext.Provider></MemoryRouter>); mounted = true; await pause(); });
      await settle(() => !!host.querySelector('[data-testid="timeline-batch"]'));
      await click(host.querySelector('[data-testid="timeline-batch"] summary')!);
      await click(host.querySelector<HTMLInputElement>(`[data-batch-event="${id1}"]`)!); await click(host.querySelector<HTMLInputElement>(`[data-batch-event="${id2}"]`)!);
      await click(host.querySelector<HTMLInputElement>('input[aria-label="Desplazamiento en días"]')!);
      await native([{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }, { type: 'text', text: '2' }]);
      await click(button('Desplazar selección'));
      await settle(() => host.querySelector('[data-testid="timeline-batch"]')?.getAttribute('aria-busy') === 'false' && !!button('Deshacer conjunto'));
      const shifted = await read(); assert(shifted.find(row => row.id === id1)?.realDate === '2026-10-22' && shifted.find(row => row.id === id2)?.realDate === '2026-10-26', 'Native batch UI did not move both dates equally');
      host.querySelector('[data-testid="timeline-batch"]')!.scrollIntoView({ block: 'start', behavior: 'instant' });
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Timeline batch controls overflow horizontally');
      const shot = `timeline-batch-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      await click(button('Deshacer conjunto')); await settle(() => host.querySelector('[data-testid="timeline-batch"]')?.getAttribute('aria-busy') === 'false' && !button('Deshacer conjunto'));
      assert((await read()).find(row => row.id === id1)?.realDate === '2026-10-20', 'Normal batch Undo lost the original date');
      await click(button('Borrar selección')); await settle(() => !!document.querySelector('[role="dialog"]'));
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(node => node.textContent === 'Eliminar')!; assert(confirm, 'Delete confirmation is missing'); await click(confirm);
      await settle(() => host.querySelector('[data-testid="timeline-batch"]')?.getAttribute('aria-busy') === 'false' && !!button('Deshacer conjunto'));
      assert((await read()).length === 0 && (await listEraRows(scope, 'timelineConnections')).length === 0, 'UI deletion left selected events or links');
      await click(button('Deshacer conjunto')); await settle(() => !!host.querySelector(`[data-batch-event="${id1}"]`) && !button('Deshacer conjunto'));
      assert((await read()).length === 2 && (await listEraRows(scope, 'timelineConnections')).length === 1, 'UI Undo did not restore the complete batch');
      results.push(`Native ${width}px: select two events, shift together, Undo, confirm delete and restore events with connection`);
    }
    assert((await db.timelineEvents.get(id1))?.realDate === '2026-10-20' && await db.timelineEvents.where('projectId').equals(P).count() === 2, 'Era UI changed Base');
    return results;
  } finally { if (mounted) await act(async () => root.unmount()); await deleteProject(P); }
}
