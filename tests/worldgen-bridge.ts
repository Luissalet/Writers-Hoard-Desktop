// ============================================================================
// Worldgen ↔ AI bridge: reading a stored world privately, writing through the
// one writer that owns it, and undoing an external edit
// ============================================================================
//
// A small planet is forged for real (a 128-cell grid takes well under a
// second), saved as the snapshot the app would keep, and then read and edited
// the way the bridge tools do — with no view open, and with a fake view
// registered as the live writer.

import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { deserializeEdits, editKey, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { createWorldEditWriter } from '@/engines/worldgen/editWriter';
import { generatedWorldOps } from '@/engines/worldgen/operations';
import { registerLiveWorld } from '@/engines/worldgen/core/liveWorlds';
import { applyWorldEdits, openWorldForReading } from '@/engines/worldgen/bridgeAccess';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { onDataChanged, type DataChangedDetail } from '@/engines/_shared/dataChanged';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = TOOL_HANDLERS[tool];
  assert(handler, `no handler for ${tool}`);
  return (await handler(args)) as Record<string, unknown>;
}

export async function testWorldgenBridgeAccess(): Promise<string> {
  const now = Date.now();
  const projectId = generateId('project');
  const worldId = generateId('world');
  const params = { ...DEFAULT_PARAMS, width: 128, seed: 'bridge-critical' };
  await db.projects.add({
    id: projectId, title: 'Bridge world host', mode: 'novelist', type: 'standalone', color: '#000',
    description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'],
    createdAt: now, updatedAt: now,
  });
  await db.generatedWorlds.add({ id: worldId, projectId, title: 'Small planet', params, createdAt: now, updatedAt: now });

  try {
    // 1. Never forged here: the read answers pending instead of blocking.
    const world = (await db.generatedWorlds.get(worldId))!;
    const pending = await openWorldForReading(world, 'places');
    assert(!pending.ok && pending.code === 'generating', 'a world without a snapshot must answer generating');

    // 2. With the snapshot in place, the read replays the stored edits privately.
    const data = generateWorld(params);
    await saveSnapshot(worldId, paramsKey(params), data);
    let land = -1;
    for (let i = 0; i < data.elevation.length; i += 1) {
      if (data.elevation[i] > 0) { land = i; break; }
    }
    assert(land >= 0, 'the small planet has no land at all');
    const lx = land % data.width;
    const ly = Math.floor(land / data.width);

    const placed = await call('wh_add_place', { worldId, marker: 'settlement', x: lx, y: ly, name: 'Puerto Claro', rank: 'city' });
    assert(placed.delivered === 'row' && placed.key === editKey('settlement', lx, ly), 'row write did not report its key');
    const found = await call('wh_find_place', { worldId, query: 'puerto' });
    const hits = found.places as Array<Record<string, unknown>>;
    assert(found.live === false && hits.length === 1 && hits[0].name === 'Puerto Claro', 'the private replay did not show the placed city');
    assert(hits[0].key === placed.key, 'atlas key differs from the edit key');

    const at = await call('wh_place_at', { worldId, x: lx, y: ly });
    assert(at.found === true && (at.place as Record<string, unknown>).name === 'Puerto Claro', 'wh_place_at did not resolve the city');

    // A snapshot read must never touch the stored row's data arrays: a second
    // read after another edit rebuilds from the snapshot, and the first
    // build's object is not reused for a different list.
    const first = await openWorldForReading((await db.generatedWorlds.get(worldId))!, 'full');
    assert(first.ok, 'second read failed');
    // Through the dispatcher, the way main relays it: a successful write must
    // announce itself so mounted lists (and the open view) refetch.
    const announced: DataChangedDetail[] = [];
    const offChanged = onDataChanged((detail) => { announced.push(detail); });
    let renamed: Record<string, unknown>;
    try {
      const reply = await runBridgeTool('wh_rename_place', { worldId, key: placed.key, name: 'Puerto Oscuro' });
      assert(reply.ok, `rename failed through the dispatcher: ${reply.error}`);
      renamed = reply.result as Record<string, unknown>;
      const readReply = await runBridgeTool('wh_get_world', { worldId });
      assert(readReply.ok, 'read failed through the dispatcher');
    } finally {
      offChanged();
    }
    assert(announced.length === 1, `a write must announce exactly once (got ${announced.length}; reads must not)`);
    assert(announced[0].source === 'ai' && announced[0].table === 'generatedWorlds' && announced[0].entityId === worldId, 'the announcement does not name the world row');
    const second = await openWorldForReading((await db.generatedWorlds.get(worldId))!, 'full');
    assert(second.ok && second.world !== first.world, 'a changed edit list reused the stale private build');
    assert(second.ok && second.world.atlas.byKey.get(String(placed.key))?.name === 'Puerto Oscuro', 'rename did not reach the atlas');

    // 3. Undo restores the edit list as it stood before the rename. The audit
    //    envelope is what the executor files (kind is `update`: the result
    //    says neither `created` nor `deleted`), and the generic undo puts the
    //    recorded fields back with a plain update.
    const envelope = renamed.__audit as Record<string, unknown>;
    assert(envelope && envelope.table === 'generatedWorlds' && envelope.entityId === worldId, 'rename did not audit against the world row');
    assert(!('created' in renamed) && !('deleted' in renamed), 'an edit must audit as an update, never as a create or delete');
    const undone = await undoAuditEntry({ entry: { kind: 'update', entityId: worldId, summary: envelope.summary, before: envelope.before } });
    assert(undone.undone, 'undo refused the rename');
    const afterUndo = (await db.generatedWorlds.get(worldId))!;
    const list = deserializeEdits(afterUndo.edits ?? '');
    assert(list.length === 1 && list[0].kind === 'marker', 'undo did not restore the pre-rename edit list');
    const third = await openWorldForReading(afterUndo, 'full');
    assert(third.ok && third.world.atlas.byKey.get(String(placed.key))?.name === 'Puerto Claro', 'the read after undo still shows the undone rename');

    // 4. A live view owns the world: edits go to it, the row is not touched.
    const received: WorldEdit[][] = [];
    const unregister = registerLiveWorld(worldId, {
      apply: (edits) => { received.push(edits); },
      snapshot: () => 'live-snapshot',
    });
    try {
      const rowBefore = (await db.generatedWorlds.get(worldId))!.edits;
      const viewWrite = await applyWorldEdits((await db.generatedWorlds.get(worldId))!, [{ kind: 'label', x: 1, y: 1, text: 'Here', style: 'note' }]);
      assert(viewWrite.delivered === 'view' && viewWrite.before === 'live-snapshot', 'a live view did not receive the edit');
      assert(received.length === 1 && received[0][0].kind === 'label', 'the view got the wrong edit');
      assert((await db.generatedWorlds.get(worldId))!.edits === rowBefore, 'a view-delivered edit wrote the row too');
      const detail = await call('wh_get_world', { worldId });
      assert(detail.live === true, 'wh_get_world does not report the open view');
    } finally {
      unregister();
    }
    assert((await call('wh_get_world', { worldId })).live === false, 'unregister left the view registered');

    // 4b. Sin vista registrada (cerrándose, o preparando su sesión tras
    //     regenerar) la fila puede tener un guardado de la vista aún en vuelo,
    //     y el llamante trae una copia de la fila leída antes de abrir el mundo.
    //     La edición externa se suma a lo que la fila TIENE, y el guardado
    //     retrasado de la vista no puede taparla después.
    const stale = (await db.generatedWorlds.get(worldId))!;
    const viewList = [...deserializeEdits(stale.edits ?? ''), { kind: 'label', x: 5, y: 5, text: 'View stroke', style: 'note' } as WorldEdit];
    const viewWriter = createWorldEditWriter(worldId, (json) => generatedWorldOps.update(worldId, { edits: json }), 60_000);
    viewWriter.schedule(serializeEdits(viewList));
    const rowWrite = await applyWorldEdits(stale, [{ kind: 'label', x: 6, y: 6, text: 'Bridge label', style: 'note' }]);
    await viewWriter.flush();
    const merged = deserializeEdits((await db.generatedWorlds.get(worldId))!.edits ?? '');
    const texts = merged.map((edit) => (edit.kind === 'label' ? edit.text : edit.kind));
    assert(rowWrite.delivered === 'row' && texts.includes('View stroke') && texts.includes('Bridge label'),
      `a row write must keep the view's pending save and survive it (got ${JSON.stringify(texts)})`);
    assert(rowWrite.before === serializeEdits(viewList), 'the audit "before" must be the row as it stood, not the stale copy');

    // 4c. El vaciado es una espera. Una vista que se registra MIENTRAS tanto
    //     ya es la dueña: la edición va a ella y la fila no se toca.
    const lateReceived: WorldEdit[][] = [];
    let unregisterLate: (() => void) | undefined;
    const beforeLate = (await db.generatedWorlds.get(worldId))!.edits ?? '';
    const lateWriter = createWorldEditWriter(worldId, async (json) => {
      await generatedWorldOps.update(worldId, { edits: json });
      unregisterLate = registerLiveWorld(worldId, {
        apply: (edits) => { lateReceived.push(edits); },
        snapshot: () => json,
      });
    }, 60_000);
    lateWriter.schedule(beforeLate);
    try {
      const lateWrite = await applyWorldEdits(stale, [{ kind: 'label', x: 7, y: 7, text: 'Late view label', style: 'note' }]);
      assert(lateWrite.delivered === 'view' && lateReceived.length === 1,
        `a view that registers during the drain must receive the edit (delivered ${lateWrite.delivered})`);
      const lateRow = deserializeEdits((await db.generatedWorlds.get(worldId))!.edits ?? '');
      assert(!lateRow.some((edit) => edit.kind === 'label' && edit.text === 'Late view label'),
        'an edit handed to the late view must not be written to the row too');
    } finally {
      unregisterLate?.();
    }

    // 4d. Y un guardado que OTRO escritor programa durante el vaciado también
    //     llega antes de la suma: si no, aterriza después con la lista vieja.
    const beforeRace = (await db.generatedWorlds.get(worldId))!.edits ?? '';
    const raceList = [...deserializeEdits(beforeRace), { kind: 'label', x: 8, y: 8, text: 'Second writer', style: 'note' } as WorldEdit];
    const secondWriter = createWorldEditWriter(worldId, (json) => generatedWorldOps.update(worldId, { edits: json }), 60_000);
    const firstWriter = createWorldEditWriter(worldId, async (json) => {
      await generatedWorldOps.update(worldId, { edits: json });
      secondWriter.schedule(serializeEdits(raceList));
    }, 60_000);
    firstWriter.schedule(beforeRace);
    const raceWrite = await applyWorldEdits(stale, [{ kind: 'label', x: 9, y: 9, text: 'Bridge after race', style: 'note' }]);
    await secondWriter.flush();
    const raced = deserializeEdits((await db.generatedWorlds.get(worldId))!.edits ?? '')
      .map((edit) => (edit.kind === 'label' ? edit.text : edit.kind));
    assert(raceWrite.delivered === 'row' && raced.includes('Second writer') && raced.includes('Bridge after race'),
      `a save scheduled during the drain must not clobber the appended edit (got ${JSON.stringify(raced)})`);

    // 5. Deleting the world takes its links and caches with it.
    await db.entityLinks.add({
      id: generateId('entity-link'), projectId, sourceEngineId: 'worldgen', sourceEntityType: 'world-spatial',
      sourceEntityId: `${worldId}::${placed.key}`, sourceTitle: 'x', targetEngineId: 'codex', targetEntityType: 'codex-entry',
      targetEntityId: 'nope', targetTitle: 'y', relation: 'represents', provenance: 'manual', createdAt: now, updatedAt: now,
    });
    const { deleteWorldCascade } = await import('@/engines/worldgen/operations');
    await deleteWorldCascade(worldId);
    assert(!(await db.generatedWorlds.get(worldId)), 'world row survived the cascade');
    assert(!(await db.worldSnapshots.get(worldId)), 'snapshot survived the cascade');
    assert((await db.entityLinks.where('sourceEntityId').startsWith(`${worldId}::`).count()) === 0, 'place links survived the cascade');
  } finally {
    await db.entityLinks.where('projectId').equals(projectId).delete();
    await db.generatedWorlds.delete(worldId);
    await db.worldSnapshots.delete(worldId);
    await db.projects.delete(projectId);
  }
  return 'Worldgen bridge access: private read, row and view writes, change announcement, undo, cascade';
}
