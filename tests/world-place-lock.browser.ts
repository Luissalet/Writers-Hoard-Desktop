import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, duplicatePlaceEdit, lockedPlaceKeys, type WorldEdit } from '@/engines/worldgen/core/edits';
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
    assert(town?.marker === 'settlement' && town.rank === 'city' && town.name === 'Vado 2' && ruin?.ruin === 'tower' && peak?.landmark === 'volcano' && peak.name === undefined, `Copies ${JSON.stringify([town, ruin, peak])}`);
    assert(duplicatePlaceEdit({ kind: 'realm', type: 'realm', name: 'Reino' }, { x: 1, y: 1 }, 'x') === null && duplicatePlaceEdit({ kind: 'feature', type: 'sea', name: 'Mar' }, { x: 1, y: 1 }, 'x') === null, 'Realms and seas are not copied');

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
    const unlocked = await runBridgeTool('wh_lock_place', { worldId: Wid, key: first.key, locked: false });
    const moved = await runBridgeTool('wh_move_place', { worldId: Wid, key: first.key, x: Math.floor(first.x), y: Math.floor(first.y) });
    assert(unlocked.ok && moved.ok && (await places('settlement')).find((p) => p.key === first.key)?.locked === undefined, 'Unlocked, then moved');
    // Duplicate: a town two cells east (or on land given), named "<name> 2"; a realm is refused.
    let copy: BridgeReply | null = null, from: Place | null = null;
    for (const t of towns.slice(0, 20)) { const r = await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: t.key }); if (r.ok) { copy = r; from = t; break; } }
    assert(copy && from, 'No town could be copied two cells east');
    const made = copy.result as { key: string; name: string; marker: string; x: number };
    const edits = deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    const marker = edits[edits.length - 1] as Extract<WorldEdit, { kind: 'marker' }>;
    assert(made.name === `${from.name} 2` && marker.kind === 'marker' && marker.marker === 'settlement' && marker.rank === from.type && marker.x === (Math.floor(from.x) + 2) % world.width, `Copy ${JSON.stringify([made, marker, from])}`);
    const listedCopy = (await places('settlement')).find((p) => p.name === `${from!.name} 2`);
    assert(listedCopy, 'The copy is a place of the world');
    const realm = (await places('realm'))[0];
    if (realm) bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: realm.key }), /cannot be duplicated/, 'copy of a realm');
    bad(await runBridgeTool('wh_duplicate_place', { worldId: Wid, key: 'settlement:999,999' }), /No place/, 'copy of nothing');
    const audit = (copy.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_duplicate_place', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'copy' } });
    assert(undone.ok && !(await places('settlement')).some((p) => p.name === `${from!.name} 2`), 'Undo takes the copy away');
    return [
      'Locks: the last lock edit for a key wins, they are view-only, stored, and a malformed one is dropped; copies keep the kind and type of a town, ruin or landmark; realms and seas are not copied',
      `Bridge: wh_lock_place locks ${first.name} (listed and found as locked; move and remove refused) and unlocks it; wh_duplicate_place copies ${from.name} as "${made.name}" two cells east, refuses a realm and an unknown key, and undoes`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
