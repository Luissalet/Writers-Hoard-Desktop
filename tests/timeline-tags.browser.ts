import { db } from '@/db';
import type { Project, Timeline, TimelineEvent } from '@/types';
import { filterTimelineEvents, normalizeEventTags, normalizeTimelineFilter, retagEvents, timelineTagCounts } from '@/engines/timeline/timelineFilter';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Tags on timeline events, the filter and saved views, the tag manager, the wiki's timelines and the bridge. */
export async function testTimelineTags(): Promise<string[]> {
  const P = 'synthetic-timeline-tags', T = 'synthetic-timeline-tags-t';
  const ev = (id: string, title: string, order: number, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ id, projectId: P, timelineId: T, title, description: '', date: `Año ${order + 1}`, dateMode: 'text', eventType: 'point', order, lane: 'Reino', color: '#aa5533', createdAt: 1, updatedAt: 1, ...extra });
  // ---- pure ------------------------------------------------------------------------------
  assert(normalizeEventTags([' #Batalla ', 'batalla', 'Batálla', '', 3, 'x'.repeat(60)]).join('|') === `Batalla|${'x'.repeat(40)}`, `Tags tidied: ${normalizeEventTags([' #Batalla ', 'batalla', 'Batálla', '', 3, 'x'.repeat(60)])}`);
  const events = [ev('a', 'La partida', 0, { tags: ['viaje'] }), ev('b', 'La batalla del vado', 1, { tags: ['batalla', 'guerra'], eventType: 'milestone' }), ev('c', 'La profecía', 2, { tags: ['profecía'], hideFromWiki: true }), ev('d', 'El asedio', 3, { tags: ['guerra'] })];
  const pick = (filter: unknown) => filterTimelineEvents(events, normalizeTimelineFilter(filter)).map(e => e.id).join('');
  assert(pick({ tags: ['guerra'] }) === 'bd' && pick({ tags: ['GUERRA', 'viaje'] }) === 'abd' && pick({ types: ['milestone'] }) === 'b' && pick({ text: 'la vado' }) === 'b' && pick({ wikiOnly: true }) === 'abd' && pick({}) === 'abcd', 'Filters');
  assert(timelineTagCounts(events).map(r => `${r.tag}:${r.count}`).join() === 'guerra:2,batalla:1,profecía:1,viaje:1', `Counts: ${JSON.stringify(timelineTagCounts(events))}`);
  assert(JSON.stringify(retagEvents(events, 'Guerra', 'batalla')) === JSON.stringify([{ id: 'b', tags: ['batalla'] }, { id: 'd', tags: ['batalla'] }]), `Merge: ${JSON.stringify(retagEvents(events, 'Guerra', 'batalla'))}`);
  assert(JSON.stringify(retagEvents(events, 'viaje', null)) === JSON.stringify([{ id: 'a', tags: undefined }]), 'Remove');
  const passed = ['Event tags tidied (a leading #, repeats ignoring case and accents, 40 characters, 20 at most); the filter by any tag, shape, words and "only what the wiki shows"; counts most used first; a rename into an existing tag merges, a removal takes it off'];
  try {
    // ---- the wiki ----------------------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Crónica', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline', 'codex'], createdAt: 1, updatedAt: 1, timelineViews: [{ id: 'v-war', name: 'Guerra', filter: { tags: ['guerra'], types: [], text: '' } }] } as Project);
    await db.timelines.put({ id: T, projectId: P, title: 'Las guerras del norte', color: '#aa5533', createdAt: 1, updatedAt: 1 } satisfies Timeline);
    await db.codexEntries.put({ id: 'c-vado', projectId: P, type: 'location', title: 'El vado', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    for (const row of events) await db.timelineEvents.put(row.id === 'b' ? { ...row, linkedEntryIds: ['c-vado'], linkedEntryId: 'c-vado' } : row);
    const off = buildWorldWiki(await loadWorldWikiData(P, {}), {});
    assert(off.counts.timelines === 0 && !/Las guerras del norte/.test(off.html), 'Timelines stay out unless asked for');
    const all = buildWorldWiki(await loadWorldWikiData(P, { includeTimelines: true }), { includeTimelines: true });
    assert(all.counts.timelines === 1 && /La partida/.test(all.html) && /El asedio/.test(all.html) && !/La profecía/.test(all.html) && /#guerra/.test(all.html) && /value="timelines"/.test(all.html), 'The timeline as an article without the hidden event');
    const doc = new DOMParser().parseFromString(all.html, 'text/html');
    assert(doc.querySelector('article[data-category="timelines"] a[href^="#entry-"]')?.textContent === 'El vado', 'Linked cards are links');
    const war = buildWorldWiki(await loadWorldWikiData(P, { includeTimelines: true, timelineViewId: 'v-war' }), { includeTimelines: true, timelineViewId: 'v-war' });
    assert(/La batalla del vado/.test(war.html) && /El asedio/.test(war.html) && !/La partida/.test(war.html) && /Guerra/.test(war.html), 'A saved view narrows what the wiki publishes');
    passed.push('World wiki: "Incluir cronologías" adds each timeline as an article (events in order, tags, linked cards as links, a Timelines category) and never an event kept out of the wiki; the saved view "Guerra" publishes only its events; off by default');
    // ---- the bridge ---------------------------------------------------------------------------
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const made = await runBridgeTool('wh_create_event', { timelineId: T, title: 'La tregua', tags: ['#Paz', 'paz', 'guerra'], hideFromWiki: true });
    assert(made.ok, `Created: ${JSON.stringify(made)}`);
    const tregua = await db.timelineEvents.get((made.result as { id: string }).id);
    assert(tregua?.tags?.join() === 'Paz,guerra' && tregua.hideFromWiki === true, `Stored: ${JSON.stringify(tregua)}`);
    bad(await runBridgeTool('wh_update_event', { id: 'a', tags: 'viaje' }), /list of words/, 'tags as a string');
    const listed = await runBridgeTool('wh_list_events', { projectId: P, tags: ['guerra'], wikiOnly: true });
    assert((listed.result as { events: Array<{ id: string }> }).events.map(e => e.id).join() === 'b,d', `Filtered list: ${JSON.stringify(listed).slice(0, 300)}`);
    const renamed = await runBridgeTool('wh_timeline_tags', { projectId: P, action: 'rename', tag: 'guerra', to: 'batalla' });
    assert(renamed.ok && (renamed.result as { events: number }).events === 3, `Renamed: ${JSON.stringify(renamed).slice(0, 300)}`);
    assert((await db.timelineEvents.get('d'))?.tags?.join() === 'batalla' && (await db.timelineEvents.get('b'))?.tags?.join() === 'batalla', 'Merged on every event');
    bad(await runBridgeTool('wh_timeline_tags', { projectId: P, action: 'remove', tag: 'nadie' }), /No event carries/, 'Unknown tag');
    const audit = (renamed.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undo = await runBridgeTool('__undo', { entry: { tool: 'wh_timeline_tags', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'retag' } });
    assert(undo.ok && (await db.timelineEvents.get('d'))?.tags?.join() === 'guerra' && (await db.timelineEvents.get('b'))?.tags?.join() === 'batalla,guerra', `Undo puts the tags back: ${JSON.stringify(undo).slice(0, 200)} ${JSON.stringify(await db.timelineEvents.get('b'))}`);
    bad(await runBridgeTool('wh_timeline_tags', { projectId: P, action: 'color', tag: 'guerra', color: 'red' }), /#rrggbb/, 'A bad colour');
    const coloured = await runBridgeTool('wh_timeline_tags', { projectId: P, action: 'color', tag: 'Guerra', color: '#C0504D' });
    const listedTags = (await runBridgeTool('wh_timeline_tags', { projectId: P })).result as { tags: Array<{ tag: string; color: string | null }> };
    assert(coloured.ok && listedTags.tags.find(row => row.tag === 'guerra')?.color === '#c0504d', `Tag colour: ${JSON.stringify(listedTags)}`);
    bad(await runBridgeTool('wh_timeline_views', { projectId: P, action: 'save', name: 'Nada' }), /at least one/, 'An empty view');
    const saved = await runBridgeTool('wh_timeline_views', { projectId: P, action: 'save', name: 'Hitos', types: ['milestone'] });
    const views = (saved.result as { views: Array<{ name: string }> }).views.map(v => v.name).join();
    assert(saved.ok && views === 'Guerra,Hitos', `Views: ${views}`);
    passed.push('Bridge: wh_create_event/wh_update_event take tags (tidied) and hideFromWiki; wh_list_events filters by tags, types, text and wikiOnly; wh_timeline_tags renames (merging) on every event and undo puts them back; an unknown tag is refused; action color gives a tag its colour (listed with it); wh_timeline_views saves a view (an empty one is refused)');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
