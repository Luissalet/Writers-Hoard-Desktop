import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { normalizeStoryEvent, storyEventsFrom, storyKnownBy } from '@/engines/worldgen/core/storyEvents';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { drawAnnotations } from '@/engines/worldgen/cartography/annotations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Story events on the map: the record, its storage, the session, drawing and the bridge. */
export async function testStoryEvents(): Promise<string[]> {
  const P = 'synthetic-story-events', Wid = 'story-events-world';
  try {
    // Records: validated and tidied; bad ones refused.
    for (const bad of [{ id: 'a', x: 1, y: 1, type: 'duel', title: 'x' }, { id: 'a', x: 1, y: 1, type: 'fight', title: ' ' }, { id: 'a', x: 1, y: 1, type: 'fight', title: 'x', chapter: 1.5 }, { id: '', x: 1, y: 1, type: 'fight', title: 'x' }, { id: 'a', x: 'n', y: 1, type: 'fight', title: 'x' }]) {
      let refused = false; try { normalizeStoryEvent(bad); } catch { refused = true; }
      assert(refused, `Accepted ${JSON.stringify(bad)}`);
    }
    const tidy = normalizeStoryEvent({ id: ' e1 ', x: 10.123456, y: 5, type: 'fight', title: '  Ambush  ' });
    assert(tidy.id === 'e1' && tidy.title === 'Ambush' && tidy.status === 'happened' && tidy.chapter === undefined, `Tidy ${JSON.stringify(tidy)}`);
    // Upsert by id, removal, order by chapter then first placement; reader filter.
    const edits: WorldEdit[] = [
      { kind: 'story', ...normalizeStoryEvent({ id: 'a', x: 1, y: 1, type: 'meeting', title: 'Meet', chapter: 3 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'b', x: 2, y: 2, type: 'fight', title: 'Fight', chapter: 1 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'c', x: 3, y: 3, type: 'find', title: 'Plan', status: 'planned', chapter: 2 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'd', x: 4, y: 4, type: 'custom', title: 'Always' }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'a', x: 9, y: 9, type: 'meeting', title: 'Meet again', chapter: 3 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'e', x: 5, y: 5, type: 'rest', title: 'Gone', chapter: 1 }) },
      { kind: 'storyRemove', id: 'e' },
    ];
    const events = storyEventsFrom(edits);
    assert(events.map((e) => e.id).join() === 'b,c,a,d' && events[2].title === 'Meet again' && events[2].x === 9, `Events ${JSON.stringify(events.map((e) => [e.id, e.title]))}`);
    assert(storyKnownBy(events, 2).map((e) => e.id).join() === 'b,d' && storyKnownBy(events, null).map((e) => e.id).join() === 'b,a,d', 'Known by chapter');
    // Storage: round-trip; a malformed record costs only itself.
    const back = deserializeEdits(serializeEdits(edits));
    assert(storyEventsFrom(back).length === 4, 'Round trip');
    const json = JSON.stringify({ v: 2, edits: [...JSON.parse(serializeEdits(edits)).edits, { kind: 'story', id: 'z', x: 1, y: 1, type: 'duel', title: 'x' }, { kind: 'storyRemove' }] });
    assert(deserializeEdits(json).length === edits.length, 'Malformed story edits were kept');
    // The painting session records them without replaying the world.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'story-planet' };
    const sessionWorld = generateWorld(params);
    const session = new PaintSession(sessionWorld);
    const rev = sessionWorld.revision ?? 0;
    session.push(edits[0]); session.push({ kind: 'storyRemove', id: 'a' }); session.undo();
    assert((sessionWorld.revision ?? 0) === rev && storyEventsFrom(session.edits).length === 1, 'Story edits replayed the world');
    // Drawing: a mark lands on the canvas, also across the seam.
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const wrapX = (wx: number) => { let d = wx - 32; while (d > 32) d -= 64; while (d < -32) d += 64; return (d + 32) * 4; };
    drawAnnotations(ctx, { story: [{ ...events[0], x: 62, y: 10 }] }, { width: 64, height: 32 } as never, wrapX, (y) => y * 4, 4);
    const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    const leftInk = Array.from(ctx.getImageData(0, 30, 30, 20).data).filter((v, i) => i % 4 === 3 && v > 0).length;
    assert(alpha(248, 40) > 0 && leftInk > 0, 'Story mark not drawn at the seam');
    // The bridge: add, list, update, remove, render.
    await db.projects.put({ id: P, title: 'Story', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Story planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), generateWorld(params));
    const noTitle = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 3, y: 3, title: ' ' });
    const badType = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 3, y: 3, title: 'x', type: 'duel' });
    const nowhere = await runBridgeTool('wh_add_story_event', { worldId: Wid, title: 'x' });
    assert(!noTitle.ok && !badType.ok && !nowhere.ok, 'Bridge accepted a bad event');
    const plain = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256 });
    const added = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 40, y: 20, type: 'fight', title: 'Ambush at the ford', chapter: 2 });
    const planned = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 80, y: 30, type: 'meeting', title: 'The council', chapter: 5, status: 'planned' });
    assert(added.ok && planned.ok, `Add ${JSON.stringify(added)}`);
    const id = (added.result as { event: { id: string } }).event.id;
    const list = await runBridgeTool('wh_list_story_events', { worldId: Wid });
    const listed = (list.result as { events: { id: string; x: number; chapter: number }[] }).events;
    assert(list.ok && listed.length === 2 && listed[0].id === id && listed[0].x === 40.5, `List ${JSON.stringify(list)}`);
    const moved = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, x: 50, y: 22, note: 'Two dead', chapter: null });
    const after = (await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: { id: string; x: number; note?: string; chapter?: number }[] };
    const ev = after.events.find((e) => e.id === id)!;
    assert(moved.ok && ev.x === 50.5 && ev.note === 'Two dead' && ev.chapter === undefined, `Update ${JSON.stringify(ev)}`);
    const known = (await runBridgeTool('wh_list_story_events', { worldId: Wid, knownByChapter: 9 })).result as { events: unknown[] };
    assert(known.events.length === 1, 'knownByChapter should leave out the planned council');
    const marked = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256, storyEvents: true });
    assert(marked.ok && (marked.result as { dataUrl: string }).dataUrl !== (plain.result as { dataUrl: string }).dataUrl, 'Render ignored the story events');
    const missing = await runBridgeTool('wh_remove_story_event', { worldId: Wid, id: 'nope' });
    const removed = await runBridgeTool('wh_remove_story_event', { worldId: Wid, id });
    const left = (await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: unknown[] };
    assert(!missing.ok && removed.ok && left.events.length === 1, 'Remove');
    return [
      'Story events validate kind, title, chapter and position; bad ones are refused',
      'A later record replaces an earlier one by id, removal takes it off, order is by chapter; the reader knows what happened by a chapter',
      'They round-trip, cost only themselves when malformed, never replay the world in a painting session, and draw across the seam',
      'Bridge: wh_add/update/remove/list_story_events with validation and knownByChapter; wh_render_world_map marks them',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
