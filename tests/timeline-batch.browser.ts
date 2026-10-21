import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { applyTimelineBatch, timelineBatchTargets, undoTimelineBatch } from '@/engines/timeline/eventBatch';
import { defaultWorldCalendar } from '@/engines/timeline/worldCalendar';
import { listEraRows, saveWorldEra } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { TimelineEvent } from '@/types';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function rejects(run: () => Promise<unknown>, code: string) { try { await run(); } catch (error) { assert(String(error).includes(code), `Wrong error ${error}`); return; } throw Error(`Expected ${code}`); }
export async function testTimelineBatch() {
  const P = `timeline-batch-${Date.now()}`, p2 = `${P}-foreign`, results: string[] = [];
  try {
    const calendar = defaultWorldCalendar();
    await db.projects.bulkPut([P, p2].map(id => ({ id, title: id, mode: 'custom', type: 'standalone', enabledEngines: ['timeline'], worldCalendar: calendar, createdAt: 1, updatedAt: 1 })));
    const a = `${P}-a`, b = `${P}-b`;
    await db.timelines.bulkPut([a, b].map(id => ({ id, projectId: P, title: id, color: '#ab1234', createdAt: 1, updatedAt: 1 })));
    const events: TimelineEvent[] = [
      { id: `${P}-one`, projectId: P, timelineId: a, title: 'One', description: '', date: '', dateMode: 'calendar', realDate: '2024-02-28', realDateEnd: '2024-03-02', time: '23:15', endTime: '02:30', eventType: 'range', order: 0, lane: 'A', color: '#ab1234', createdAt: 1, updatedAt: 1 },
      { id: `${P}-two`, projectId: P, timelineId: b, title: 'Two', description: '', date: '', dateMode: 'world', worldDate: { year: 1, month: 12, day: 29, approx: true }, worldDateEnd: { year: 2, month: 1, day: 2 }, time: '11:00', eventType: 'range', order: 2, lane: 'B', color: '#ab1234', createdAt: 1, updatedAt: 1 },
    ];
    await db.timelineEvents.bulkPut(events);
    await db.timelineConnections.put({ id: `${P}-link`, projectId: P, timelineId: b, sourceEventId: events[0].id, targetEventId: events[1].id, color: '#ab1234', style: 'solid', createdAt: 1 });
    const scope = { projectId: P }, versions = await timelineBatchTargets(scope);
    const shifted = await applyTimelineBatch(scope, events.map(row => row.id), { kind: 'shift', days: 2 }, versions);
    const e1 = await db.timelineEvents.get(events[0].id), e2 = await db.timelineEvents.get(events[1].id);
    assert(e1?.realDate === '2024-03-01' && e1.realDateEnd === '2024-03-04' && e1.time === '23:15' && e1.endTime === '02:30', 'Gregorian leap boundary lost duration or clock');
    assert(e2?.worldDate?.year === 2 && e2.worldDate.month === 1 && e2.worldDate.day === 1 && e2.worldDate.approx && e2.worldDateEnd?.day === 4 && e2.order === 2, 'World dates lost duration/precision or ordering');
    assert(await db.timelineConnections.count() >= 1, 'Moving destroyed links');
    await rejects(() => applyTimelineBatch(scope, [events[0].id], { kind: 'remove' }, versions), 'conflict');
    await undoTimelineBatch(scope, shifted.receiptId);
    assert((await db.timelineEvents.get(events[0].id))?.realDate === events[0].realDate, 'Undo did not restore original dates');
    results.push('Atomic movement across Gregorian leap and world year boundaries preserves ranges/clocks/precision/links; stale CAS is refused');
    await db.timelineEvents.update(events[1].id, { worldDate: { year: 1 } });
    const partialTargets = await timelineBatchTargets(scope);
    await rejects(() => applyTimelineBatch(scope, events.map(row => row.id), { kind: 'shift', days: 1 }, partialTargets), 'exact_dates');
    assert((await db.timelineEvents.get(events[0].id))?.realDate === events[0].realDate, 'Invalid second event partially moved the first');
    await db.timelineEvents.put(events[1]);
    const removed = await applyTimelineBatch(scope, [events[0].id], { kind: 'remove' }, await timelineBatchTargets(scope));
    assert(!await db.timelineEvents.get(events[0].id) && !await db.timelineConnections.get(`${P}-link`) && !!await db.timelineEvents.get(events[1].id), 'Delete left touching cross-line links or deleted unrelated event');
    await undoTimelineBatch(scope, removed.receiptId);
    assert(!!await db.timelineEvents.get(events[0].id) && !!await db.timelineConnections.get(`${P}-link`), 'Undo lost cross-line connection');
    const occupied = await applyTimelineBatch(scope, [events[0].id], { kind: 'remove' }, await timelineBatchTargets(scope));
    await db.timelineEvents.put({ ...events[0], projectId: p2, timelineId: `${P}-foreign-line` });
    await rejects(() => undoTimelineBatch(scope, occupied.receiptId), 'conflict');
    assert((await db.timelineEvents.get(events[0].id))?.projectId === p2 && !await db.timelineConnections.get(`${P}-link`), 'Occupied-ID Undo overwrote another project or partially restored links');
    await db.timelineEvents.delete(events[0].id); await undoTimelineBatch(scope, occupied.receiptId);
    results.push('Invalid/partial dates roll back all; delete and Undo include cross-line links, and globally occupied child identities are preserved');
    await saveWorldEra(P, { id: 'later', name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const era = { projectId: P, eraId: 'later' }, preview = await runBridgeTool('wh_timeline_batch_preview', era);
    assert(preview.ok, JSON.stringify(preview));
    const done = await runBridgeTool('wh_timeline_batch_apply', { ...era, eventIds: events.map(row => row.id), kind: 'shift', days: -2, expectedTargets: (preview.result as { targets: unknown }).targets });
    assert(done.ok, JSON.stringify(done));
    assert((await db.timelineEvents.get(events[0].id))?.realDate === events[0].realDate && (await listEraRows<TimelineEvent>(era, 'timelineEvents')).find(row => row.id === events[0].id)?.realDate === '2024-02-26', 'Era batch leaked into Base');
    const restored = await runBridgeTool('wh_timeline_batch_undo', { ...era, receiptId: (done.result as { receiptId: string }).receiptId }); assert(restored.ok, JSON.stringify(restored));
    const conflict = await applyTimelineBatch(scope, [events[0].id], { kind: 'shift', days: 1 }, await timelineBatchTargets(scope));
    await db.timelineEvents.update(events[0].id, { title: 'Newer author edit' });
    await rejects(() => undoTimelineBatch(scope, conflict.receiptId), 'conflict');
    assert((await db.timelineEvents.get(events[0].id))?.title === 'Newer author edit', 'Undo overwrote newer author edit');
    results.push('Registered normal MCP handlers isolate named eras; Undo refuses subsequent author edits');
    return results;
  } finally { await deleteProject(P); await deleteProject(p2); }
}

export async function testTimelineBatchOuterRollback() {
  const projectId = `timeline-outer-${Date.now()}`, timelineId = `${projectId}-line`, id = `${projectId}-event`, scope = { projectId };
  try {
    await db.projects.put({ id: projectId, title: 'Synthetic outer rollback', mode: 'custom', type: 'standalone', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 });
    await db.timelines.put({ id: timelineId, projectId, title: 'Line', color: '#ab1234', createdAt: 1, updatedAt: 1 });
    await db.timelineEvents.put({ id, projectId, timelineId, title: 'Event', description: '', date: '', dateMode: 'calendar', realDate: '2024-01-01', order: 0, color: '#ab1234', createdAt: 1, updatedAt: 1 });
    const changed = await applyTimelineBatch(scope, [id], { kind: 'shift', days: 1 }, await timelineBatchTargets(scope));
    await rejects(() => db.transaction('rw', db.tables, async () => { await undoTimelineBatch(scope, changed.receiptId); throw Error('synthetic_outer_abort'); }), 'synthetic_outer_abort');
    assert((await db.timelineEvents.get(id))?.realDate === '2024-01-02', 'Outer rollback did not retain shifted state');
    await undoTimelineBatch(scope, changed.receiptId);
    assert((await db.timelineEvents.get(id))?.realDate === '2024-01-01', 'Retry after aborted Undo lost the receipt');
    return ['Timeline Undo consumes its session receipt only when the surrounding transaction commits; aborted Undo can be retried'];
  } finally { await deleteProject(projectId); }
}
