import { db } from '@/db';
import type { CodexEntry, MapFeature, Project } from '@/types';
import { mapItemVisible, rebaseMapFeatures, stepMapFeatures } from '@/components/maps/mapGeometry';
import { parseMapKey, pinKey } from '@/components/maps/mapScale';
import { matchEntries, searchKey } from '@/components/maps/codexSearch';
import { createEntryFromMap } from '@/engines/maps/codexLink';
import { decodeAnnotationData } from '@/engines/annotations/portability';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
// Registers the maps engine's comment anchor, as opening the app does.
import '@/engines/maps';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Classic maps: the Codex link picker's search and creation, right-click comments, and edits that keep shapes added elsewhere. */
export async function testMapPicker(): Promise<string[]> {
  const P = 'synthetic-map-picker', M = 'map-picker-map';
  try {
    // Search: accent-free, every word, titles that start with the query first.
    const entry = (id: string, title: string): CodexEntry => ({ id, projectId: P, type: 'location', title, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const entries = [entry('a', 'Puerto de Ávila'), entry('b', 'Ávila del Estuario'), entry('c', 'Orden de la Sal')];
    assert(searchKey(' ÁVILA ') === 'avila', 'searchKey');
    // Map keys: a letter, a doubled letter or a number; a short real name is not a key.
    assert(pinKey('Ur') === null && pinKey('AA') === 'AA' && pinKey('b.') === 'B' && parseMapKey('AA. Puerta norte\nUr - ciudad').map((l) => l.key).join() === 'AA', 'Key letters');
    assert(matchEntries(entries, 'avila').map((e) => e.id).join() === 'b,a' && matchEntries(entries, 'sal orden').map((e) => e.id).join() === 'c' && matchEntries(entries, 'zzz').length === 0, 'matchEntries');

    // Creating from the map: a plain entry of the chosen type; refused when the Codex is off.
    await db.projects.put({ id: P, title: 'Maps', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['maps'], createdAt: 1, updatedAt: 1 } satisfies Project);
    let refused = false; try { await createEntryFromMap({ projectId: P }, 'Nope', 'location'); } catch { refused = true; }
    assert(refused, 'Created an entry with the Codex off');
    await db.projects.update(P, { enabledEngines: ['maps', 'codex', 'annotations'] });
    const made = await db.codexEntries.get(await createEntryFromMap({ projectId: P }, '  Vado Gris ', 'faction'));
    assert(made?.title === 'Vado Gris' && made.type === 'faction' && made.projectId === P, `Created ${JSON.stringify(made)}`);
    let blank = false; try { await createEntryFromMap({ projectId: P }, '   ', 'location'); } catch { blank = true; }
    assert(blank, 'Created an untitled entry with an empty title');

    // An edit made from an older snapshot keeps shapes added since (the agent's label), and its removals and order.
    const shape = (id: string, name = id): MapFeature => ({ id, kind: 'region', name, color: '#d5b575', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 15, y: 20 }] });
    const before = [shape('old', 'Old border'), shape('road')];
    const current = [...before, { ...shape('agent', 'Agent label'), kind: 'label' as const, points: [{ x: 50, y: 50 }] }];
    const saved = rebaseMapFeatures(current, before, [shape('old', 'New border'), shape('road')]);
    assert(saved.map((f) => `${f.id}:${f.name}`).join() === 'old:New border,road:road,agent:Agent label', `Save ${JSON.stringify(saved.map((f) => f.name))}`);
    const added = rebaseMapFeatures(current, before, [...before, shape('mine')]);
    assert(added.map((f) => f.id).join() === 'old,road,agent,mine', `Add ${added.map((f) => f.id)}`);
    const removed = rebaseMapFeatures(current, before, [shape('road')]);
    assert(removed.map((f) => f.id).join() === 'road,agent', `Remove ${removed.map((f) => f.id)}`);
    // Undo of a deletion puts the shape back in its place; undo/redo of a rename keep a label added between them.
    const afterDelete = [shape('road')];
    const undoDelete = rebaseMapFeatures([shape('road'), current[2]], afterDelete, before);
    assert(undoDelete.map((f) => f.id).join() === 'old,road,agent', `Undo delete ${undoDelete.map((f) => f.id)}`);
    const renamed = [shape('old', 'New border'), shape('road')];
    const undone = rebaseMapFeatures([...renamed, current[2]], renamed, before);
    const late = { ...shape('late', 'Agent label 2'), kind: 'label' as const, points: [{ x: 60, y: 60 }] };
    const redone = rebaseMapFeatures([...undone, late], before, renamed);
    assert(undone[0].name === 'Old border' && undone.some((f) => f.id === 'agent') && redone[0].name === 'New border' && redone.map((f) => f.id).join() === 'old,road,agent,late', `Undo/redo ${JSON.stringify(redone.map((f) => f.name))}`);
    // Undo only reverts shapes left as the step left them: the agent restyled "old" after the rename, so undo keeps it and says so.
    const restyled = [{ ...shape('old', 'New border'), strokeColor: '#ff0000' }, shape('road'), current[2]];
    const guarded = stepMapFeatures(restyled, renamed, before);
    assert(guarded.skipped.join() === 'old' && guarded.features[0].strokeColor === '#ff0000' && guarded.features[0].name === 'New border', `Guarded undo ${JSON.stringify(guarded)}`);
    const clean = stepMapFeatures([...renamed, current[2]], renamed, before);
    assert(!clean.skipped.length && clean.features[0].name === 'Old border' && clean.features.some((f) => f.id === 'agent'), 'Clean undo');
    const front = rebaseMapFeatures(current, before, [shape('road'), shape('old', 'Old border')]);
    assert(front.map((f) => f.id).join() === 'road,old,agent', `Order ${front.map((f) => f.id)}`);

    // Visibility: a deleted layer no longer counts, so hiding the remaining one hides the shape; with all layers gone it shows.
    const named = [{ id: 'l1', name: 'A', visible: false }];
    assert(!mapItemVisible({ layerIds: ['gone', 'l1'] }, named) && mapItemVisible({ layerIds: ['gone', 'gone2'] }, named) && mapItemVisible({ layerIds: ['gone', 'l1'] }, [{ ...named[0], visible: true }]), 'Deleted-layer visibility');

    // Comments at a spot on a map, through the bridge.
    await db.worldMaps.put({ id: M, projectId: P, title: 'Costa', features: [], createdAt: 1, updatedAt: 1 });
    const note = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'maps', entityId: M, note: '¿Puente o barca?', at: { x: 42.5, y: 61 } });
    assert(note.ok, `Annotate ${JSON.stringify(note)}`);
    const noteId = (note.result as { id: string; at: { x: number } }).id;
    const row = await db.annotations.get(noteId);
    assert(row?.anchor.type === 'map_point' && row.anchor.x === 42.5 && row.anchor.y === 61, `Stored ${JSON.stringify(row?.anchor)}`);
    const listed = (await runBridgeTool('wh_list_annotations', { projectId: P, engineId: 'maps', entityId: M })).result as { annotations: { id: string; at?: { x: number; y: number } }[] };
    assert(listed.annotations.some((r) => r.id === noteId && r.at?.x === 42.5 && r.at.y === 61), `List ${JSON.stringify(listed)}`);
    // Moving it: CAS on the thread revision, undone by its receipt.
    const moved = await runBridgeTool('wh_annotation_move', { projectId: P, id: noteId, expectedRevision: row.revision ?? 0, x: 10, y: 20 });
    const movedRow = await db.annotations.get(noteId);
    assert(moved.ok && movedRow?.anchor.x === 10 && movedRow.anchor.y === 20, `Move ${JSON.stringify(moved)}`);
    const staleMove = await runBridgeTool('wh_annotation_move', { projectId: P, id: noteId, expectedRevision: row.revision ?? 0, x: 30, y: 30 });
    const offMap = await runBridgeTool('wh_annotation_move', { projectId: P, id: noteId, expectedRevision: movedRow!.revision ?? 0, x: 130, y: 30 });
    assert(!staleMove.ok && !offMap.ok, 'A stale or off-map move was accepted');
    const receipt = (moved.result as { undo: unknown }).undo;
    const back = await runBridgeTool('wh_annotation_undo', { projectId: P, receipt });
    const backRow = await db.annotations.get(noteId);
    assert(back.ok && backRow?.anchor.x === 42.5 && backRow.anchor.y === 61, `Move undo ${JSON.stringify(back)}`);
    for (const bad of [{ at: { x: 120, y: 3 } }, { at: { x: 'a', y: 3 } }, { at: { x: 1, y: 2 }, quote: 'x' }]) {
      const result = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'maps', entityId: M, note: 'x', ...bad });
      assert(!result.ok, `Accepted ${JSON.stringify(bad)}`);
    }
    const onCodex = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'codex', entityId: made!.id, note: 'x', at: { x: 1, y: 2 } });
    assert(!onCodex.ok, '`at` accepted outside maps');

    // Archives keep the spot and refuse a broken one.
    const decoded = decodeAnnotationData({ annotations: [row], annotationReferences: [] }, P);
    assert(decoded.annotations[0].anchor.type === 'map_point' && decoded.annotations[0].anchor.x === 42.5, 'Archive round trip');
    let broken = false; try { decodeAnnotationData({ annotations: [{ ...row, anchor: { type: 'map_point', x: 150, y: 2 } }], annotationReferences: [] }, P); } catch { broken = true; }
    assert(broken, 'Archive accepted a spot off the map');
    return [
      'Link picker search is accent-free and word-based; entries created from a map get the chosen type, need a title and the Codex turned on',
      'A shape saved, undone or redone from an older snapshot keeps shapes added elsewhere since (the agent\'s labels), with its own additions, removals and order applied; an undone deletion returns to its place; undo leaves alone a shape changed after its step and names it; "Ur" is a name, not a key letter',
      'A deleted layer no longer keeps a shape visible: hiding its remaining layer hides it',
      'Bridge: wh_annotate takes `at` on maps (refused out of range, with a quote or on other engines); wh_list_annotations returns it; wh_annotation_move moves it with revision CAS and its receipt puts it back; archives keep it and refuse a spot off the map',
    ];
  } finally {
    await db.annotations.where('projectId').equals(P).delete();
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.worldMaps.delete(M);
    await db.projects.delete(P);
  }
}
