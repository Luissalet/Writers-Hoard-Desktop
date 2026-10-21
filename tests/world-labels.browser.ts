import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { applyEdits, deserializeEdits, editKey, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { glyphBounds, labelGlyphs, normalizeLabelChange } from '@/engines/worldgen/core/labelShape';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function flat(width = 64): WorldData {
  const n = width * width / 2;
  return {
    width, height: width / 2, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.1), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(500),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n), sst: new Float32Array(n),
    plateId: new Uint8Array(n), boundary: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [],
  } as unknown as WorldData;
}

/** Painted labels after placing: change, rename, remove/restore, shapes and the bridge. */
export async function testWorldLabels(): Promise<string[]> {
  const P = 'synthetic-world-labels', W = 'labels-world';
  const passed: string[] = [];
  try {
    // Replay: later changes win field by field; key is the origin even after a move.
    const key = editKey('label', 10, 8);
    const edits: WorldEdit[] = [
      { kind: 'label', x: 10, y: 8, text: 'Mar Quieto', style: 'water' },
      { kind: 'move', target: 'label', key, x: 20, y: 9 },
      { kind: 'relabel', key, size: 20, angle: 0.5, curve: 0.4 },
      { kind: 'relabel', key, spacing: 0.3, curve: -0.2 },
    ];
    let labels = applyEdits(flat(), edits).labels;
    assert(labels.length === 1 && labels[0].key === key && labels[0].size === 20 && labels[0].angle === 0.5 && labels[0].spacing === 0.3 && labels[0].curve === -0.2 && labels[0].text === 'Mar Quieto', `Relabel replay: ${JSON.stringify(labels)}`);
    labels = applyEdits(flat(), [...edits, { kind: 'rename', target: 'label', key, name: 'Mar del Sur' }]).labels;
    assert(labels[0].text === 'Mar del Sur', 'Rename did not reach a painted label');
    labels = applyEdits(flat(), [...edits, { kind: 'remove', target: 'label', key }]).labels;
    assert(!labels.length, 'Remove did not hide a painted label');
    labels = applyEdits(flat(), [...edits, { kind: 'remove', target: 'label', key }, { kind: 'restore', target: 'label', key }]).labels;
    assert(labels.length === 1, 'Restore did not bring the label back');
    // A second label in the same cell has its own key: removing or renaming the first never reaches it.
    labels = applyEdits(flat(), [...edits, { kind: 'remove', target: 'label', key }, { kind: 'label', x: 10, y: 8, text: 'Nuevo', style: 'note' }]).labels;
    assert(labels.length === 1 && labels[0].text === 'Nuevo' && labels[0].key === `${key}#2`, `Remove leaked onto a new label: ${JSON.stringify(labels)}`);
    labels = applyEdits(flat(), [...edits, { kind: 'label', x: 10, y: 8, text: 'Otro', style: 'note' }, { kind: 'rename', target: 'label', key, name: 'Primero' }]).labels;
    assert(labels.map((l) => l.text).join('|') === 'Primero|Otro', `Rename reached the wrong label: ${JSON.stringify(labels)}`);
    // A later change of words wins over an earlier rename.
    labels = applyEdits(flat(), [...edits, { kind: 'rename', target: 'label', key, name: 'Renombrado' }, { kind: 'relabel', key, text: 'Reescrito' }]).labels;
    assert(labels[0].text === 'Reescrito', `Rename beat a later text change: ${labels[0].text}`);
    const roundTrip = deserializeEdits(serializeEdits([...edits, { kind: 'relabel' } as never, { kind: 'relabel', key, size: 'huge' } as never, { kind: 'relabel', key, curve: 50 } as never]));
    assert(roundTrip.length === edits.length, 'Malformed relabels must be dropped on reading');
    passed.push('Relabel edits replay field by field after moves; painted labels answer rename, remove and restore with keys of their own per label; later words beat an earlier rename; malformed relabels are dropped');

    // Shape: straight runs centre on the anchor, a positive curve arches, the angle turns it.
    const widths = [10, 10, 10, 10, 10];
    const straight = labelGlyphs(widths, 2, 0, 0, 100, 50);
    assert(Math.abs(straight[0].x + straight[4].x - 200) < 1e-9 && straight.every((g) => g.y === 50 && g.a === 0), 'Straight run not centred');
    const arch = labelGlyphs(widths, 2, 1, 0, 100, 50);
    assert(arch[2].y < arch[0].y && arch[2].y < arch[4].y && Math.abs(arch[2].y - 50) < 1e-9 && arch[0].a < 0 && arch[4].a > 0, 'Positive curve does not arch up');
    const bow = labelGlyphs(widths, 2, -1, 0, 100, 50);
    assert(bow[0].y < 50 && bow[4].y < 50, 'Negative curve does not bow down');
    const turned = labelGlyphs(widths, 2, 0, Math.PI / 2, 100, 50);
    assert(Math.abs(turned[0].x - 100) < 1e-9 && turned[0].y < turned[4].y, 'Angle did not turn the run');
    const box = glyphBounds(straight, widths, 12);
    assert(box.w > 58 && box.h > 0, 'Bounds');
    for (const bad of [{ size: 2 }, { curve: 3 }, { spacing: -1 }, { angle: 9 }, { style: 'loud' }, { text: '  ' }]) {
      let refused = false; try { normalizeLabelChange(bad); } catch { refused = true; }
      assert(refused, `Accepted ${JSON.stringify(bad)}`);
    }
    passed.push('Label layout centres straight runs, arches or bows curved ones and turns with the angle; invalid changes are refused');

    // Bridge: add with a shape, list, update, refuse bad input, undo; rename/remove by key.
    await db.projects.put({ id: P, title: 'Labels', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'labels-planet' };
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'Label planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(W), paramsKey(params), generateWorld(params));
    const added = await runBridgeTool('wh_add_label', { worldId: W, x: 40, y: 30, text: 'Sierra Gris', style: 'range', size: 18, angleDegrees: -20, spacing: 0.25 });
    assert(added.ok && (added.result as { angleDegrees: number }).angleDegrees === -20, JSON.stringify(added));
    let listed: { ok: boolean; result?: unknown } | null = null;
    for (let i = 0; i < 60; i++) { listed = await runBridgeTool('wh_list_labels', { worldId: W }); if (listed.ok && !(listed.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 250)); }
    const first = (listed!.result as { labels: { key: string; size: number; angleDegrees: number; spacing: number; text: string }[] }).labels;
    assert(first.length === 1 && first[0].key === 'label:40,30' && first[0].size === 18 && first[0].angleDegrees === -20 && first[0].spacing === 0.25, `List: ${JSON.stringify(first)}`);
    for (const bad of [{ key: 'settlement:1,1', curve: 0.2 }, { key: 'label:1,1', curve: 0.2 }, { key: 'label:40,30', curve: 3 }, { key: 'label:40,30' }, { key: 'label:40,30', angleDegrees: 400 }]) {
      const refused = await runBridgeTool('wh_update_label', { worldId: W, ...bad });
      assert(!refused.ok && ['bad-args', 'not-found'].includes(refused.code ?? ''), `Accepted bad update ${JSON.stringify(bad)}: ${JSON.stringify(refused)}`);
    }
    const update = await runBridgeTool('wh_update_label', { worldId: W, key: 'label:40,30', curve: 0.5, text: 'Sierra Parda' });
    assert(update.ok, JSON.stringify(update));
    const after = (await runBridgeTool('wh_list_labels', { worldId: W })).result as { labels: { curve: number; text: string; size: number }[] };
    assert(after.labels[0].curve === 0.5 && after.labels[0].text === 'Sierra Parda' && after.labels[0].size === 18, `Update did not apply: ${JSON.stringify(after)}`);
    const audit = (update.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_update_label', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'label' } });
    const reverted = (await runBridgeTool('wh_list_labels', { worldId: W })).result as { labels: { curve?: number; text: string }[] };
    assert(undone.ok && reverted.labels[0].curve === undefined && reverted.labels[0].text === 'Sierra Gris', `Undo: ${JSON.stringify(reverted)}`);
    const renamed = await runBridgeTool('wh_rename_place', { worldId: W, key: 'label:40,30', name: 'Montes Grises' });
    const shown = (await runBridgeTool('wh_list_labels', { worldId: W })).result as { labels: { text: string }[] };
    assert(renamed.ok && shown.labels[0].text === 'Montes Grises', 'wh_rename_place did not rename the label');
    const removed = await runBridgeTool('wh_remove_place', { worldId: W, key: 'label:40,30' });
    const gone = (await runBridgeTool('wh_list_labels', { worldId: W })).result as { labels: unknown[] };
    assert(removed.ok && !gone.labels.length, 'wh_remove_place did not remove the label');
    const ghost = await runBridgeTool('wh_update_label', { worldId: W, key: 'label:40,30', curve: 0.1 });
    assert(!ghost.ok && ghost.code === 'not-found', `Updated a removed label: ${JSON.stringify(ghost)}`);
    passed.push('Bridge: wh_add_label takes size, angle and spacing; wh_list_labels reports keys and shapes; wh_update_label validates, changes only what it is given and undoes; rename and remove work on label keys');
    return passed;
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(W));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
