import { db } from '@/db';
import type { Project, Timeline, TimelineEvent } from '@/types';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A timeline event copied right after itself, through the bridge (the swim lanes' "Duplicate event" is in its runner). */
export async function testTimelineDuplicate(): Promise<string[]> {
  const P = `timeline-duplicate-${Date.now()}`, T = `${P}-t`;
  try {
    await db.projects.put({ id: P, title: 'Timeline', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.timelines.put({ id: T, projectId: P, title: 'Crónica', description: '', color: '#aa5533', order: 0, createdAt: 1, updatedAt: 1 } as Timeline);
    const event = (id: string, title: string, order: number) => db.timelineEvents.put({ id, projectId: P, timelineId: T, title, description: `${title}.`, date: `Año ${order}`, dateMode: 'text', eventType: 'point', order, lane: '', color: '#aa5533', linkedEntryIds: ['x'], createdAt: 1, updatedAt: 1 } satisfies TimelineEvent);
    await event('e1', 'La partida', 0); await event('e2', 'La batalla', 1); await event('e3', 'El regreso', 2);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_duplicate_event', { projectId: P, id: 'nope' }), /No timeline event/, 'An unknown event');
    const made = await runBridgeTool('wh_duplicate_event', { projectId: P, id: 'e2' });
    assert(made.ok, JSON.stringify(made));
    const id = (made.result as { id: string }).id;
    const rows = (await db.timelineEvents.where('timelineId').equals(T).toArray()).sort((a, b) => a.order - b.order);
    assert(rows.map((r) => r.title).join(' | ') === 'La partida | La batalla | La batalla (copy) | El regreso', `Right after its original: ${rows.map((r) => `${r.order}:${r.title}`).join(' | ')}`);
    const copy = rows.find((r) => r.id === id)!;
    assert(copy.date === 'Año 1' && copy.description === 'La batalla.' && copy.linkedEntryIds?.join() === 'x' && copy.color === '#aa5533', 'The same date, description, links and colour');
    const named = await runBridgeTool('wh_duplicate_event', { projectId: P, id: 'e1', title: 'La segunda partida' });
    assert(named.ok && (await db.timelineEvents.get((named.result as { id: string }).id))?.title === 'La segunda partida', 'A title can be given');
    const audit = (made.result as { __audit: { entityId: string; projectId: string } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_duplicate_event', kind: 'create', entityId: audit.entityId, projectId: audit.projectId, table: 'timelineEvents', summary: 'copy' } });
    assert(undone.ok && !(await db.timelineEvents.get(id)), `Undo removes the copy: ${JSON.stringify(undone).slice(0, 200)}`);
    return ['Bridge: wh_duplicate_event copies an event right after itself with its date, description, links and colour ("(copy)" or a given title), refuses an unknown event, and undo removes the copy'];
  } finally {
    await db.timelineEvents.where('projectId').equals(P).delete();
    await db.timelines.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
