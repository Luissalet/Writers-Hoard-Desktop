import { db } from '@/db';
import { exportProjectData, importProjectData, deleteProject } from '@/db/operations';
import type { MapVersion, Project, TimelineEvent } from '@/types';
import { captureMapVersion, linkMapVersion } from '@/engines/maps/operations';
import { orderMapVersions } from '@/engines/maps/versionTimeline';
import { defaultWorldCalendar } from '@/engines/timeline/worldCalendar';
import { saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { saveWorldEra } from '@/services/worldEras/store';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Map eras tied to timeline moments: ordering, links, the bridge, undo, eras and portability. */
export async function testWorldMapEras(): Promise<string[]> {
  const P = `map-eras-${Date.now()}`, M = `${P}-map`, T = `${P}-lane`;
  const passed: string[] = [], created: string[] = [P];
  const project = { id: P, title: 'Map eras fixture', type: 'standalone' as const, mode: 'custom' as const, color: '#cab57d', description: '', status: 'draft' as const, enabledEngines: ['maps', 'timeline'], engineOrder: ['maps', 'timeline'], createdAt: 1, updatedAt: 1 } as unknown as Project;
  const event = (id: string, title: string, order: number, year?: number): TimelineEvent => ({ id: `${P}-${id}`, projectId: P, timelineId: T, title, description: '', date: year ? `Year ${year}` : '', order, lane: 'Main', color: '#777777', createdAt: 1, updatedAt: 1, ...(year ? { worldDate: { year } } : {}) } as unknown as TimelineEvent);
  const saved = async () => (await db.worldMaps.get(M))!;
  try {
    await db.projects.put(project);
    await saveWorldCalendar(P, defaultWorldCalendar('Reckoning'));
    await db.timelines.put({ id: T, projectId: P, title: 'History', color: '#777777', createdAt: 1, updatedAt: 1 } as never);
    // Timeline order deliberately disagrees with the calendar: the calendar wins.
    const founding = event('founding', 'Founding', 3, 100), war = event('war', 'Border war', 1, 350), flood = event('flood', 'The flood', 2, 220);
    await db.timelineEvents.bulkPut([founding, war, flood]);
    await db.worldMaps.put({ id: M, projectId: P, title: 'Changing borders', features: [], createdAt: 1, updatedAt: 1 } as never);

    // Eras are saved out of order; two link to events, one stays free, one points at nothing.
    const late = await captureMapVersion(M, { name: 'After the war', date: 'late', eventId: war.id });
    const free = await captureMapVersion(M, { name: 'Sketch', date: 'undated' });
    const early = await captureMapVersion(M, { name: 'First borders', date: '', eventId: founding.id });
    const lost = await captureMapVersion(M, { name: 'Lost moment', date: 'typed', eventId: `${P}-gone` });
    const calendar = defaultWorldCalendar('Reckoning');
    let ordered = orderMapVersions((await saved()).versions!, [founding, war, flood], calendar);
    assert(ordered.map(row => row.version.id).join() === [early, late, free, lost].join(), `Calendar order wrong: ${ordered.map(row => row.version.name)}`);
    assert(ordered[0].event?.id === founding.id && ordered[0].dateLabel.includes('100') && !ordered[0].orphan, `Linked label: ${ordered[0].dateLabel}`);
    assert(ordered[3].orphan && !ordered[3].event && ordered[3].dateLabel === 'typed' && !ordered[2].orphan && ordered[2].dateLabel === 'undated', 'Orphan and free eras keep their typed dates');
    // Without a calendar the timeline order decides; nothing in storage moves.
    ordered = orderMapVersions((await saved()).versions!, [founding, war, flood], null);
    assert(ordered.map(row => row.version.id).slice(0, 2).join() === [late, early].join(), 'Timeline order fallback');
    assert((await saved()).versions!.map(v => v.id).join() === [late, free, early, lost].join(), 'Storage order untouched');
    passed.push('Eras order by the world calendar, then timeline order; free eras follow in saved order, orphans keep their typed date');

    // Link, guarded relink, unlink.
    assert(await linkMapVersion(M, free, flood.id) === null, 'First link returns no previous');
    let refused = false; try { await linkMapVersion(M, free, war.id, undefined, null); } catch { refused = true; }
    assert(refused && (await saved()).versions!.find(v => v.id === free)!.timelineEventId === flood.id, 'Stale expected link was not refused');
    assert(await linkMapVersion(M, free, null, undefined, flood.id) === flood.id && !('timelineEventId' in (await saved()).versions!.find(v => v.id === free)!), 'Unlink removes the field');
    passed.push('Linking returns the previous moment, refuses a stale expectation and unlinks cleanly');

    // Bridge: list, capture, link, bad arguments and undo.
    const list = await runBridgeTool('wh_list_map_versions', { mapId: M });
    const eras = (list.result as { eras: { id: string; eventId: string | null; orphan: boolean; date: string }[] }).eras;
    assert(list.ok && eras.map(row => row.id).join() === [early, late, free, lost].join() && eras[3].orphan && eras[0].eventId === founding.id, `Bridge list: ${JSON.stringify(list)}`);
    const capture = await runBridgeTool('wh_capture_map_version', { mapId: M, name: 'Flood year', eventId: flood.id });
    assert(capture.ok, JSON.stringify(capture));
    const captured = capture.result as { versionId: string; __audit: { before: unknown; entityId: string; projectId: string } };
    const floodEra = (await saved()).versions!.find(v => v.id === captured.versionId);
    assert(floodEra?.timelineEventId === flood.id && floodEra.date.includes('220'), `Bridge capture links and keeps the moment's date: ${floodEra?.date}`);
    const missing = await runBridgeTool('wh_link_map_version', { mapId: M, versionId: free });
    const foreign = await runBridgeTool('wh_link_map_version', { mapId: M, versionId: free, eventId: 'no-such-event' });
    const noEra = await runBridgeTool('wh_link_map_version', { mapId: M, versionId: 'no-such-era', eventId: war.id });
    assert(!missing.ok && missing.code === 'bad-args' && !foreign.ok && !noEra.ok && noEra.code === 'not-found', `Bad link arguments accepted: ${JSON.stringify([missing, foreign, noEra])}`);
    const link = await runBridgeTool('wh_link_map_version', { mapId: M, versionId: free, eventId: war.id });
    assert(link.ok && (await saved()).versions!.find(v => v.id === free)?.timelineEventId === war.id, 'Bridge link');
    const linkAudit = (link.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    const undoLink = await runBridgeTool('__undo', { entry: { tool: 'wh_link_map_version', kind: 'update', entityId: linkAudit.entityId, projectId: linkAudit.projectId, before: linkAudit.before, summary: 'link' } });
    assert(undoLink.ok && !('timelineEventId' in (await saved()).versions!.find(v => v.id === free)!), `Link undo: ${JSON.stringify(undoLink)}`);
    // Undo refuses once someone else has moved the link.
    const relink = await runBridgeTool('wh_link_map_version', { mapId: M, versionId: free, eventId: war.id });
    const relinkAudit = (relink.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    await linkMapVersion(M, free, flood.id);
    const staleUndo = await runBridgeTool('__undo', { entry: { tool: 'wh_link_map_version', kind: 'update', entityId: relinkAudit.entityId, projectId: relinkAudit.projectId, before: relinkAudit.before, summary: 'link' } });
    assert(!staleUndo.ok && (await saved()).versions!.find(v => v.id === free)?.timelineEventId === flood.id, `Stale link undo overwrote a later edit: ${JSON.stringify(staleUndo)}`);
    const undoCapture = await runBridgeTool('__undo', { entry: { tool: 'wh_capture_map_version', kind: 'create', entityId: captured.__audit.entityId, projectId: captured.__audit.projectId, before: captured.__audit.before, summary: 'capture' } });
    assert(undoCapture.ok && !(await saved()).versions!.some(v => v.id === captured.versionId), `Capture undo: ${JSON.stringify(undoCapture)}`);
    passed.push('Bridge lists eras in order, captures linked eras with their moment dates, rejects bad links, and undo reverts link and capture but never a later edit');

    // A world era keeps its own map history; the base map is untouched.
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 } as never, null);
    const before = JSON.stringify((await saved()).versions);
    const eraCapture = await runBridgeTool('wh_capture_map_version', { mapId: M, projectId: P, eraId: 'past', name: 'Era-only', eventId: war.id });
    assert(eraCapture.ok, `Era capture: ${JSON.stringify(eraCapture)}`);
    const eraList = await runBridgeTool('wh_list_map_versions', { mapId: M, projectId: P, eraId: 'past' });
    const eraRows = (eraList.result as { eras: { name: string; eventId: string | null }[] }).eras;
    assert(eraRows.some(row => row.name === 'Era-only' && row.eventId === war.id) && JSON.stringify((await saved()).versions) === before, 'Era capture leaked into the base map');
    const eraAudit = (eraCapture.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    const eraUndo = await runBridgeTool('__undo', { entry: { tool: 'wh_capture_map_version', kind: 'create', entityId: eraAudit.entityId, projectId: P, eraId: 'past', before: eraAudit.before, summary: 'era capture' } });
    const eraAfter = ((await runBridgeTool('wh_list_map_versions', { mapId: M, projectId: P, eraId: 'past' })).result as { eras: { name: string }[] }).eras;
    assert(eraUndo.ok && !eraAfter.some(row => row.name === 'Era-only') && JSON.stringify((await saved()).versions) === before, `Era undo: ${JSON.stringify(eraUndo)}`);
    passed.push('Era-scoped capture, listing and undo stay inside the world era');

    // JSON export/import and full duplication carry links to the copied events.
    const check = async (projectId: string, how: string) => {
      created.push(projectId);
      const map = (await db.worldMaps.where('projectId').equals(projectId).toArray())[0]; assert(map, `${how}: no map`);
      const events = await db.timelineEvents.where('projectId').equals(projectId).toArray();
      const byTitle = (title: string) => events.find(item => item.title === title)?.id;
      const named = (name: string) => map.versions!.find((v: MapVersion) => v.name === name)!;
      assert(named('First borders').timelineEventId === byTitle('Founding') && named('After the war').timelineEventId === byTitle('Border war') && byTitle('Founding') !== founding.id, `${how}: links not remapped ${JSON.stringify(map.versions!.map(v => [v.name, v.timelineEventId]))}`);
      assert(named('Lost moment').timelineEventId === `${P}-gone`, `${how}: orphan link changed`);
      assert(orderMapVersions(map.versions!, events, calendar)[0].version.name === 'First borders', `${how}: order lost`);
    };
    await check(await importProjectData(await exportProjectData(P) as never), 'JSON import');
    const preview = await previewProjectDuplicate({ projectId: P });
    const copy = await duplicateProject({ projectId: P, title: 'Copy', operationId: crypto.randomUUID(), expectedSourceVersion: preview.sourceVersion });
    await check(copy.projectId, 'Duplicate');
    passed.push('JSON import and project duplication relink eras to the copied events and keep orphans visible');
    return passed;
  } finally {
    for (const id of created) await deleteProject(id).catch(() => undefined);
  }
}
