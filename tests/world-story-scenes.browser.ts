import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { normalizeStoryEvent, placeInChapter, storyEventsFrom, type StoryEvent } from '@/engines/worldgen/core/storyEvents';
import { deserializeEdits } from '@/engines/worldgen/core/edits';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Story events told in the manuscript: the link to a chapter or scene, its checks, and dragging to a place in the chapter. */
export async function testWorldStoryScenes(): Promise<string[]> {
  const P = 'synthetic-story-scenes', Wid = 'story-scenes-world', other = 'synthetic-story-scenes-other';
  try {
    // ---- the record ---------------------------------------------------------------------
    const base = { id: 'e1', x: 10, y: 10, type: 'fight', title: 'Emboscada' };
    assert(normalizeStoryEvent({ ...base, writingId: '  w-1 ' }).writingId === 'w-1', 'A link is kept, tidied');
    assert(normalizeStoryEvent(base).writingId === undefined, 'No link by default');
    for (const bad of ['', '   ', 'x'.repeat(81), 3]) {
      let refused = false; try { normalizeStoryEvent({ ...base, writingId: bad }); } catch { refused = true; }
      assert(refused, `Refused writingId ${JSON.stringify(bad).slice(0, 20)}`);
    }
    // ---- dragging within a chapter -----------------------------------------------------------
    const events: StoryEvent[] = ['a', 'b', 'c', 'd'].map((id) => normalizeStoryEvent({ id, x: 1, y: 1, type: 'custom', title: id, chapter: 2 }));
    const moved = placeInChapter(events, 'd', 1);
    assert(moved.map((e) => `${e.id}${e.order}`).join() === 'a0,d1,b2,c3', `Dragged to second: ${moved.map((e) => e.id).join()}`);
    const back = storyEventsFrom(moved.map((e) => ({ kind: 'story' as const, ...e })));
    assert(back.map((e) => e.id).join() === 'a,d,b,c', `Read back in the new order: ${back.map((e) => e.id).join()}`);
    // ---- the bridge ------------------------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Story scenes', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen', 'writings'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.projects.put({ id: other, title: 'Other', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.writings.put({ id: 'w-huida', projectId: P, title: 'La huida', status: 'draft', content: '', wordCount: 0, chapter: 3, tags: [], createdAt: 1, updatedAt: 1 });
    await db.writings.put({ id: 'w-ajena', projectId: other, title: 'Ajena', status: 'draft', content: '', wordCount: 0, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 });
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Scenes', params: { ...DEFAULT_PARAMS, seed: 'story-scenes', width: 256 }, edits: '[]', createdAt: 1, updatedAt: 1 });
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 20, y: 20, title: 'x', writingId: 'nope' }), /No manuscript chapter/, 'An unknown writing');
    bad(await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 20, y: 20, title: 'x', writingId: 'w-ajena' }), /No manuscript chapter/, 'A writing of another project');
    const added = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 20, y: 20, type: 'journey', title: 'Cruzan el vado', writingId: 'w-huida' });
    const ev = (added.result as { event: StoryEvent }).event;
    assert(added.ok && ev.writingId === 'w-huida' && ev.chapter === 3, `Told in "La huida", so in chapter 3: ${JSON.stringify(added).slice(0, 300)}`);
    const kept = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: 22, y: 20, title: 'Otra', chapter: 5, writingId: 'w-huida' });
    assert(kept.ok && (kept.result as { event: StoryEvent }).event.chapter === 5, 'A chapter given is kept');
    const listed = await runBridgeTool('wh_list_story_events', { worldId: Wid });
    const row = (listed.result as { events: Array<StoryEvent & { writingTitle?: string | null }> }).events.find((e) => e.id === ev.id);
    assert(row?.writingTitle === 'La huida', `Listed with the chapter's title: ${JSON.stringify(row)}`);
    const unlinked = await runBridgeTool('wh_update_story_event', { worldId: Wid, id: ev.id, writingId: null });
    assert(unlinked.ok && (unlinked.result as { event: StoryEvent }).event.writingId === undefined && (unlinked.result as { event: StoryEvent }).event.chapter === 3, 'null unlinks it and keeps its chapter');
    const relinked = await runBridgeTool('wh_update_story_event', { worldId: Wid, id: ev.id, writingId: 'w-huida' });
    assert(relinked.ok && (relinked.result as { event: StoryEvent }).event.writingId === 'w-huida', 'Linked again');
    const stored = storyEventsFrom(deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]')).find((e) => e.id === ev.id);
    assert(stored?.writingId === 'w-huida', 'Saved with the world');
    return [
      'A story event keeps the manuscript chapter or scene where it is told (writingId, tidied; empty or overlong ids refused)',
      'Dragged to a place within its chapter, the chapter\'s events take their new order and read back in it',
      'Bridge: wh_add_story_event links an event to a chapter of the project (one of another project or an unknown id is refused) and an event with no chapter takes the chapter\'s number; wh_list_story_events gives the chapter\'s title; wh_update_story_event writingId null unlinks it',
    ];
  } finally {
    for (const id of [P, other]) {
      for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(id).delete();
      await db.projects.delete(id);
    }
  }
}
