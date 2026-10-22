import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { nextStoryChapter, normalizeStoryEvent, placeInChapter, reorderInChapter, previousStoryChapter, storyChapterFrames, storyEventsFrom, storyKnownBy } from '@/engines/worldgen/core/storyEvents';
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
    // Playback frames: chapters with events or fog, in order, with what happens and what is planned.
    const frames = storyChapterFrames(events, [4, 1]);
    assert(frames.map((f) => f.chapter).join() === '1,2,3,4' && frames[0].happened.map((e) => e.id).join() === 'b' && frames[1].planned.map((e) => e.id).join() === 'c' && !frames[1].happened.length && !frames[3].happened.length, `Frames ${JSON.stringify(frames)}`);
    const order = frames.map((f) => f.chapter);
    assert(nextStoryChapter(order, null) === 1 && nextStoryChapter(order, 2) === 3 && nextStoryChapter(order, 4) === null && nextStoryChapter([], null) === null && previousStoryChapter(order, 3) === 2 && previousStoryChapter(order, 1) === null && nextStoryChapter(order, 2.5) === 3, 'Chapter stepping');
    // Order within a chapter and who was there.
    for (const bad of [{ order: -1 }, { order: 1.5 }, { who: 'ana' }, { who: Array.from({ length: 21 }, (_, i) => `p${i}`) }, { who: [' '] }]) {
      let refused = false; try { normalizeStoryEvent({ id: 'w', x: 1, y: 1, type: 'custom', title: 'x', ...bad }); } catch { refused = true; }
      assert(refused, `Accepted ${JSON.stringify(bad)}`);
    }
    const tidyWho = normalizeStoryEvent({ id: 'w', x: 1, y: 1, type: 'custom', title: 'x', who: [' ana ', 'ana', 'bruno'], order: 2 });
    assert(tidyWho.who?.join() === 'ana,bruno' && tidyWho.order === 2, `Who ${JSON.stringify(tidyWho)}`);
    const chapterOne: WorldEdit[] = [
      { kind: 'story', ...normalizeStoryEvent({ id: 'p', x: 1, y: 1, type: 'custom', title: 'P', chapter: 1 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'q', x: 1, y: 1, type: 'custom', title: 'Q', chapter: 1 }) },
      { kind: 'story', ...normalizeStoryEvent({ id: 'r', x: 1, y: 1, type: 'custom', title: 'R', chapter: 1 }) },
    ];
    const unordered = storyEventsFrom(chapterOne);
    const shifted = reorderInChapter(unordered, 'r', -1);
    const reordered = storyEventsFrom([...chapterOne, ...shifted.map((e) => ({ kind: 'story' as const, ...e })), { kind: 'story', ...normalizeStoryEvent({ id: 's', x: 1, y: 1, type: 'custom', title: 'S', chapter: 1 }) }]);
    assert(reordered.map((e) => e.id).join() === 'p,r,q,s' && reorderInChapter(unordered, 'p', -1).length === 0, `Reorder ${reordered.map((e) => e.id)}`);
    const ids = (list: { id: string }[]) => list.map((e) => e.id).join();
    assert(ids(placeInChapter(unordered, 'r', 0)) === 'r,p,q' && ids(placeInChapter(unordered, 'p', 99)) === 'q,r,p' && placeInChapter(unordered, 'r', 0).map((e) => e.order).join() === '0,1,2', 'placeInChapter');
    // Records written since the list was sorted (a move just made) are re-read by their order, not their place in the array.
    const stale = [{ ...unordered[0], order: 1 }, { ...unordered[1], order: 0 }, { ...unordered[2], order: 2 }];
    assert(ids(reorderInChapter(stale, 'q', 1)) === 'p,q,r', `Reorder from fresh records ${ids(reorderInChapter(stale, 'q', 1))}`);
    let tooFar = false; try { normalizeStoryEvent({ id: 'w', x: 1, y: 1, type: 'custom', title: 'x', order: 10000 }); } catch (error) { tooFar = /0 to 9999/.test(String(error)); }
    assert(tooFar, 'order 10000 should be refused with its range');
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
    // Who was there: real Codex entries only, listed by name.
    await db.codexEntries.put({ id: 'story-ana', projectId: P, type: 'character', title: 'Ana', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const stranger = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: ['nobody'] });
    const withWho = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: ['story-ana'], order: 0 });
    const named = ((await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: { id: string; who?: string[]; whoNames?: string[]; order?: number }[] }).events.find((e) => e.id === id)!;
    assert(!stranger.ok && withWho.ok && named.who?.join() === 'story-ana' && named.whoNames?.join() === 'Ana' && named.order === 0, `Who ${JSON.stringify(named)}`);
    const cleared = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: [], order: null });
    const clearedEvent = ((await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: { id: string; who?: string[]; order?: number }[] }).events.find((e) => e.id === id)!;
    assert(cleared.ok && clearedEvent.who === undefined && clearedEvent.order === undefined, `Cleared ${JSON.stringify(clearedEvent)}`);
    // Only characters and factions; ids are tidied; the list is capped before any lookup.
    await db.codexEntries.put({ id: 'story-ford', projectId: P, type: 'location', title: 'The ford', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const aPlace = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: ['story-ford'] });
    const tooMany = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: Array.from({ length: 21 }, (_, i) => `nobody-${i}`) });
    const padded = await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: [' story-ana ', 'story-ana'] });
    assert(!aPlace.ok && /characters and factions/.test(aPlace.error ?? '') && !tooMany.ok && /up to 20/.test(tooMany.error ?? '') && padded.ok && (padded.result as { event: { who: string[] } }).event.who.join() === 'story-ana', `Who checks ${JSON.stringify([aPlace, tooMany, padded]).slice(0, 400)}`);
    await runBridgeTool('wh_update_story_event', { worldId: Wid, id, who: ['story-ana'], chapter: 2 });
    // An order is a position: the chapter's other events move along. Changing chapter without one goes to the end there.
    const second = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 60, y: 20, title: 'Second', chapter: 2 });
    const first = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 61, y: 20, title: 'First', chapter: 2, order: 0 });
    const chapterTwo = async () => ((await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: { id: string; title: string; chapter?: number; order?: number }[] }).events.filter((e) => e.chapter === 2);
    assert(first.ok && second.ok && (await chapterTwo()).map((e) => e.title).join() === 'First,Ambush at the ford,Second', `Placed first ${JSON.stringify(await chapterTwo())}`);
    const secondId = (second.result as { event: { id: string } }).event.id, firstId = (first.result as { event: { id: string } }).event.id;
    const toMiddle = await runBridgeTool('wh_update_story_event', { worldId: Wid, id: secondId, order: 1 });
    assert(toMiddle.ok && (await chapterTwo()).map((e) => e.title).join() === 'First,Second,Ambush at the ford', `Moved to the middle ${JSON.stringify(await chapterTwo())}`);
    await runBridgeTool('wh_update_story_event', { worldId: Wid, id: firstId, chapter: 7 });
    const sevenFirst = ((await runBridgeTool('wh_list_story_events', { worldId: Wid })).result as { events: { id: string; order?: number }[] }).events.find((e) => e.id === firstId)!;
    assert(sevenFirst.order === undefined, `A chapter change without order drops the old place ${JSON.stringify(sevenFirst)}`);
    await runBridgeTool('wh_remove_story_event', { worldId: Wid, id: firstId });
    await runBridgeTool('wh_remove_story_event', { worldId: Wid, id: secondId });
    // The story chapter by chapter, with how much of the map the reader knows by each.
    const painted = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'seen', chapter: 2, points: [{ x: 40, y: 20 }], radiusCells: 6 });
    assert(painted.ok, `Fog ${JSON.stringify(painted)}`);
    const chapters = await runBridgeTool('wh_story_chapters', { worldId: Wid });
    const frameList = (chapters.result as { chapters: { chapter: number; happened: { id: string; who?: string[] }[]; planned: { title: string }[]; map: { seen: number; hidden: number } }[] }).chapters;
    assert(chapters.ok && frameList.map((f) => f.chapter).join() === '2,5' && frameList[1].planned[0].title === 'The council' && frameList[0].map.seen > 0 && frameList[0].map.hidden < 1 && frameList[0].happened.find((e) => e.id === id)?.who?.join() === 'Ana', `Chapters ${JSON.stringify(chapters)}`);
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
      'Playback steps through the chapters with events or fog, each with what happens and what is planned',
      'Events take a place within their chapter (later ones follow; placing one moves the others along; fresh records re-read) and who was there (validated, tidied)',
      'Bridge: wh_add/update/remove/list_story_events with validation and knownByChapter, who (real Codex characters and factions, tidied, capped, listed by name) and order as a position (others move along; a chapter change without it goes last); wh_story_chapters gives each chapter with the map the reader knows; wh_render_world_map marks them',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
