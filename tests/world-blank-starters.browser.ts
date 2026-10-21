import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS, normalizeParams } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { WORLD_PRESETS, applyWorldPreset, matchesWorldPreset } from '@/engines/worldgen/core/presets';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { recalculateEnvironment } from '@/engines/worldgen/core/recalculate';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'synthetic-blank-starters';
const preset = (id: string) => WORLD_PRESETS.find(candidate => candidate.id === id)!;
const landCells = (elevation: Float32Array) => { let n = 0; for (const value of elevation) if (value > 0) n++; return n; };

export async function testWorldBlankStarters(): Promise<string[]> {
  try {
    // Presets: selectable, recognised, and leaving them clears the starter.
    const base = { ...DEFAULT_PARAMS, seed: 'blank-qa', width: 256 };
    const sea = applyWorldPreset(base, preset('blankSea')), land = applyWorldPreset(base, preset('blankLand'));
    assert(sea.starter === 'sea' && land.starter === 'land', 'Presets did not set the starter');
    assert(matchesWorldPreset(sea, preset('blankSea')) && !matchesWorldPreset(sea, preset('continents')) && !matchesWorldPreset(applyWorldPreset(base, preset('continents')), preset('blankSea')), 'Preset recognition confused blank and generated worlds');
    assert(applyWorldPreset(sea, preset('continents')).starter === undefined, 'Choosing a generated preset kept the blank starter');
    // Legacy recipes keep their identity.
    assert(!('starter' in normalizeParams(DEFAULT_PARAMS)) && !('starter' in normalizeParams({ ...DEFAULT_PARAMS, starter: 'bogus' as never })) && paramsKey(normalizeParams(DEFAULT_PARAMS)) === paramsKey(normalizeParams({ ...DEFAULT_PARAMS })), 'Legacy parameter identity changed');

    // Blank sea: no land at all until painted.
    const seaWorld = generateWorld(sea);
    assert(landCells(seaWorld.elevation) === 0 && seaWorld.rivers.length === 0, `Blank sea has land or rivers: ${landCells(seaWorld.elevation)} / ${seaWorld.rivers.length}`);
    // Paint a coast with the normal Land brush, then recalculate climate and rivers.
    const session = new PaintSession(seaWorld);
    session.push({ kind: 'land', op: 'land', stroke: { pts: [{ x: 100, y: 50 }, { x: 140, y: 60 }, { x: 160, y: 80 }], radius: 14, strength: 1, softness: 0.3 } });
    const painted = landCells(seaWorld.elevation);
    assert(painted > 500, `Land brush did not raise a coast on the blank sea (${painted})`);
    const derived = recalculateEnvironment(seaWorld);
    assert(session.pushRecalculation(derived, seaWorld.revision ?? 0), 'Recalculation was rejected');
    let landBiomes = 0, oceanOnLand = 0;
    for (let i = 0; i < seaWorld.elevation.length; i++) if (seaWorld.elevation[i] > 0) { if (seaWorld.biome[i] === Biome.Ocean) oceanOnLand++; else landBiomes++; }
    assert(landBiomes > painted * 0.9 && oceanOnLand === 0, `Painted land did not get land biomes (${landBiomes}/${painted}, ocean ${oceanOnLand})`);

    // Blank land: no sea anywhere, gentle relief.
    const landWorld = generateWorld(land);
    let minimum = Infinity, maximum = -Infinity;
    for (const value of landWorld.elevation) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    assert(minimum > 0 && maximum < 0.5, `Blank land is not a low plain: ${minimum}..${maximum}`);
    assert(generateWorld(land).elevation.every((value, i) => value === landWorld.elevation[i]), 'Blank land is not deterministic');

    // MCP: create a blank-sea world, refuse a bad width, undo the creation.
    await db.projects.put({ id: P, title: 'Blank', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const bad = await runBridgeTool('wh_create_world', { projectId: P, preset: 'blankSea', width: 999 });
    assert(!bad.ok && bad.code === 'bad-args', 'Bad width accepted');
    const unknown = await runBridgeTool('wh_create_world', { projectId: P, preset: 'moon' });
    assert(!unknown.ok, 'Unknown preset accepted');
    const created = await runBridgeTool('wh_create_world', { projectId: P, title: 'Mar abierto', preset: 'blankSea', seed: 'mcp-blank', width: 1024 });
    assert(created.ok, JSON.stringify(created));
    const id = (created.result as { worldId: string }).worldId, row = await db.generatedWorlds.get(id);
    assert(row?.params.starter === 'sea' && row.params.width === 1024 && row.params.seed === 'mcp-blank' && row.title === 'Mar abierto' && row.edits, `Created row wrong: ${JSON.stringify(row?.params)}`);
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_create_world', kind: 'create', entityId: id, projectId: P, summary: 'world' } });
    assert(undone.ok && !(await db.generatedWorlds.get(id)), `Undo did not remove the created world: ${JSON.stringify(undone)}`);
    return [
      'Blank sea and blank land presets are selectable, recognised and cleared by choosing a generated preset; legacy recipes keep their key',
      'Blank sea forges with no land or rivers; the normal Land brush paints a coast and recalculation gives it land biomes',
      'Blank land forges a deterministic low plain with no sea',
      'wh_create_world creates a blank-sea world with seed/width/title, refuses bad width and unknown presets, and undo removes it',
    ];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
