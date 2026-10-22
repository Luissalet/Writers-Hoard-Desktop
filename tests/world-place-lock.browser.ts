import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits, duplicateName, duplicatePlaceEdit, duplicateSpot, lockViolation, lockedPlaceKeys, type WorldEdit } from '@/engines/worldgen/core/edits';
import { isViewOnlyEdit } from '@/engines/worldgen/core/storyEvents';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Locking a place against accidents and duplicating one: the rules, storage and the bridge tools. */
export async function testWorldPlaceLock(): Promise<string[]> {
  const P = 'synthetic-place-lock', Wid = 'place-lock-world';
  try {
    // The last lock edit for a key wins; locks are view-only and survive storage, a malformed one costs only itself.
    const lock = (key: string, locked: boolean): WorldEdit => ({ kind: 'lock', target: 'settlement', key, locked });
    const keys = lockedPlaceKeys([lock('settlement:1,1', true), lock('settlement:2,2', true), lock('settlement:1,1', false)]);
    assert(keys.size === 1 && keys.has('settlement:2,2'), `Locked keys ${[...keys]}`);
    assert(isViewOnlyEdit(lock('settlement:2,2', true)), 'A lock should be view-only (no world replay)');
    const back = deserializeEdits(JSON.stringify([lock('settlement:2,2', true), { kind: 'lock', key: 'x', locked: 'yes' }, { kind: 'lock', locked: true }]));
    assert(back.length === 1 && back[0].kind === 'lock', `Stored locks ${JSON.stringify(back)}`);
    // What a copy is: the same kind and type, a new name; realms and seas are not copied.
    const town = duplicatePlaceEdit({ kind: 'settlement', type: 'city', name: 'Vado' }, { x: 3, y: 4 }, 'Vado 2');
    const ruin = duplicatePlaceEdit({ kind: 'ruin', type: 'tower', name: 'Torre' }, { x: 3, y: 4 }, 'Torre 2');
    const peak = duplicatePlaceEdit({ kind: 'landmark', type: 'volcano', name: 'Fuego' }, { x: 3, y: 4 }, '');
    const capitalCopy = duplicatePlaceEdit({ kind: 'settlement', type: 'capital', name: 'Corte' }, { x: 3, y: 4 }, 'Corte 2');
    assert(capitalCopy?.rank === 'city', 'A copied capital should be a city');
    assert(town?.marker === 'settlement' && town.rank === 'city' && town.name === 'Vado 2' && ruin?.ruin === 'tower' && peak?.landmark === 'volcano' && peak.name === undefined, `Copies ${JSON.stringify([town, ruin, peak])}`);
    assert(duplicatePlaceEdit({ kind: 'realm', type: 'realm', name: 'Reino' }, { x: 1, y: 1 }, 'x') === null && duplicatePlaceEdit({ kind: 'feature', type: 'sea', name: 'Mar' }, { x: 1, y: 1 }, 'x') === null, 'Realms and seas are not copied');

    // One rule for every way in: a locked key is neither moved nor removed; a lock in the same batch counts.
    assert(lockViolation([lock('settlement:2,2', true)], [{ kind: 'remove', target: 'settlement', key: 'settlement:2,2' }]) === 'settlement:2,2', 'Remove of a locked key');
    assert(lockViolation([], [lock('settlement:3,3', true), { kind: 'move', target: 'settlement', key: 'settlement:3,3', x: 1, y: 1 }]) === 'settlement:3,3', 'Lock then move in one batch');
    assert(lockViolation([lock('settlement:2,2', true)], [{ kind: 'rename', target: 'settlement', key: 'settlement:2,2', name: 'x' }]) === null, 'Renaming a locked place is allowed');
    // A landmark answers to its older feature: key too, both ways.
    const peakLock: WorldEdit = { kind: 'lock', target: 'landmark', key: 'landmark:volcano:5,5', locked: true };
    assert(lockViolation([peakLock], [{ kind: 'remove', target: 'feature', key: 'feature:volcano:5,5' }]) === 'feature:volcano:5,5' && lockedPlaceKeys([{ kind: 'lock', target: 'feature', key: 'feature:volcano:5,5', locked: true }]).has('landmark:volcano:5,5'), 'Landmark key aliases');
    // The eraser does not take a locked hand-placed mark (refused up front, and kept on replay).
    const mark: WorldEdit = { kind: 'marker', marker: 'settlement', x: 3, y: 3, rank: 'town', name: 'Mark' };
    const markLock: WorldEdit = { kind: 'lock', target: 'settlement', key: 'settlement:3,3', locked: true };
    const rub: WorldEdit = { kind: 'eraseMarkers', x: 3.2, y: 3.1, radius: 1 };
    // The eraser is not refused (it still takes the marks around); the replay keeps the locked one.
    assert(lockViolation([mark, markLock], [rub]) === null, 'Eraser over a locked mark is not refused outright');
    const kept = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'lock-planet' });
    applyEdits(kept, [mark, markLock, rub]);
    const gone = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'lock-planet' });
    applyEdits(gone, [mark, rub]);
    const lockedLater = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'lock-planet' });
    applyEdits(lockedLater, [mark, rub, markLock]);
    assert(kept.painted?.markers.length === 1 && gone.painted?.markers.length === 0 && lockedLater.painted?.markers.length === 0, 'Replay keeps a mark locked before the eraser, not one locked after');
    // Where a copy goes: dry, not a lake, a key nothing uses; names count up.
    const tiny = { width: 10, height: 6, elevation: new Float32Array(60).fill(1), lake: new Uint8Array(60) };
    tiny.elevation[2 * 10 + 6] = -1; // sea two cells east of (4,2)
    tiny.lake[2 * 10 + 2] = 1;       // a lake two cells west
    const spot = duplicateSpot(tiny, { kind: 'settlement', type: 'town', x: 4, y: 2 }, new Set(['settlement:4,4']));
    assert(spot && spot.x === 4 && spot.y === 0, `Spot skips sea, lake and a used key: ${JSON.stringify(spot)}`);
    assert(duplicateName('Vado', new Set()) === 'Vado 2' && duplicateName('Vado', new Set(['Vado 2'])) === 'Vado 3' && duplicateName('Vado 2', new Set(['Vado 3'])) === 'Vado 4', 'Copy names');

    // The bridge.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'lock-planet' };
    const world = generateWorld(params);
    await db.projects.put({ id: P, title: 'Lock', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Lock planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    type Place = { key: string; name: string; x: number; y: number; kind: string; type: string; locked?: boolean };
    const places = async (kind?: string) => ((await runBridgeTool('wh_list_places', { worldId: Wid, ...(kind ? { kind } : {}), limit: 1000 })).result as { places: Place[] }).places;
    const towns = await places('settlement');
    assert(towns.length > 0, 'No towns');
    const first = towns[0];
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const locked = await runBridgeTool('wh_lock_place', { worldId: Wid, key: first.key });
    assert(locked.ok && (await places('settlement')).find((p) => p.key === first.key)?.locked === true, 'Listed as locked');
    const found = ((await runBridgeTool('wh_find_place', { worldId: Wid, query: first.name })).result as { places: Place[] }).places.find((p) => p.key === first.key);
    assert(found?.locked === true, 'Found as locked');
    bad(await runBridgeTool('wh_move_place', { worldId: Wid, key: first.key, x: Math.floor(first.x), y: Math.floor(first.y) }), /locked/, 'move while locked');
    bad(await runBridgeTool('wh_remove_place', { worldId: Wid, key: first.key }), /locked/, 'remove while locked');
    bad(await runBridgeTool('wh_lock_place', { worldId: Wid, key: first.key, locked: 'no' }), /true or false/, 'locked not a boolean');
    bad(await runBridgeTool('wh_lock_place', { worldId: Wid, key: 'settlement:9999,9999' }), /No place/, 'lock of nothing');
    const at = (await runBridgeTool('wh_place_at', { worldId: Wid, x: Math.floor(first.x), y: Math.floor(first.y) })).result as { place?: { key: string }; locked?: boolean };
    assert(at.place?.key !== first.key || at.locked === true, `wh_place_at marks it locked ${JSON.stringify(at).slice(0, 200)}`);
    const unlocked = await runBridgeTool('wh_lock_place', { worldId: Wid, key: first.key, locked: false });
    const moved = await runBridgeTool('wh_move_place', { worldId: Wid, key: first.key, x: Math.floor(first.x), y: Math.floor(first.y) });
    assert(unlocked.ok && moved.ok && (await places('settlement')).find((p) => p.key === first.key)?.locked === undefined, 'Unlocked, then moved');
    // Duplicate: a town on the nearest free dry land, named "<name> 2" (a capital's copy is a city); a realm is refused.
    const from = towns[0];
    const copy = await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: from.key });
    assert(copy.ok, `Copy ${JSON.stringify(copy).slice(0, 300)}`);
    const made = copy.result as { key: string; name: string; marker: string; x: number; y: number };
    const edits = deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    const marker = edits[edits.length - 1] as Extract<WorldEdit, { kind: 'marker' }>;
    const cell = made.y * world.width + made.x;
    assert(made.name === `${from.name} 2` && marker.kind === 'marker' && marker.marker === 'settlement' && marker.rank === (from.type === 'capital' ? 'city' : from.type) && world.elevation[cell] > 0 && !world.lake[cell] && made.key !== from.key, `Copy ${JSON.stringify([made, marker, from])}`);
    const again = await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: from.key });
    const second = again.result as { key: string; name: string };
    assert(again.ok && second.name === `${from.name} 3` && second.key !== made.key, `A second copy ${JSON.stringify(again).slice(0, 300)}`);
    bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: from.key, x: made.x, y: made.y }), /already has a place/, 'copy onto the first copy');
    const seaCell = world.elevation.findIndex((e) => e <= 0);
    bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: from.key, x: seaCell % world.width, y: Math.floor(seaCell / world.width) }), /sea or a lake/, 'copy onto the sea');
    await runBridgeTool('wh_remove_place', { worldId: Wid, key: second.key });
    const listedCopy = (await places('settlement')).find((p) => p.name === `${from.name} 2`);
    assert(listedCopy, 'The copy is a place of the world');
    const realm = (await places('realm'))[0];
    if (realm) bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: realm.key }), /cannot be duplicated/, 'copy of a realm');
    bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: 'settlement:999,999' }), /No place/, 'copy of nothing');
    const audit = (copy.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_duplicate_place', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'copy' } });
    assert(undone.ok && !(await places('settlement')).some((p) => p.name === `${from.name} 2`), 'Undo takes the copy away');
    return [
      'Locks: the last lock edit for a key wins, they are view-only, stored, and a malformed one is dropped; one rule refuses moving, removing or rubbing out a locked key (landmark aliases count; a lock earlier in the same batch counts; renames pass; the eraser leaves a mark locked at that point of the list); copies keep the kind and type (a capital becomes a city), go to dry free cells and count their names up; realms and seas are not copied',
      `Bridge: wh_lock_place locks ${first.name} (listed and found as locked; move and remove refused) and unlocks it; wh_duplicate_place copies ${from.name} as "${made.name}" on free dry land (a second copy is "${second.name}"), refuses a used cell, the sea, a realm and an unknown key, and undoes`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
