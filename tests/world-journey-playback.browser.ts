import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import { planRoute, type TravelOptions } from '@/engines/worldgen/core/travel';
import { travelAnchors, travellerAt } from '@/engines/worldgen/core/journeyPlayback';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function flat(width = 64): WorldData {
  const n = width * width / 2;
  const w = {
    width, height: width / 2, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.1), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(500),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n), sst: new Float32Array(n),
    plateId: new Uint8Array(n), boundary: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [],
  } as unknown as WorldData;
  // A band of marsh across the middle, with grass to either side.
  for (let y = 8; y < 24; y++) for (let x = 28; x < 36; x++) w.biome[y * width + x] = Biome.Marsh;
  return w;
}
const geo = (w: WorldData) => ({ depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(w.width * w.height).fill(-1), features: [], ruins: [], landforms: [], languages: { languages: [] }, languageOf: {} } as unknown as HumanGeography);

export async function testWorldJourneyPlayback(): Promise<string[]> {
  const P = 'synthetic-journey-playback', W = 'playback-world';
  try {
    const w = flat(256), g = geo(w), base: TravelOptions = { mode: 'foot', season: 'summer' };
    const route = planRoute(w, g, { x: 10, y: 64 }, { x: 120, y: 64 }, { ...base, pace: 'hard' }, 'en');
    assert(!route.impossible && (route.restDays ?? 0) > 0 && route.stages.length > 6, `Need a long hard route: ${route.days} days, ${route.restDays} rest`);
    const cellOf = (i: number) => ({ x: route.cells[i] % w.width, y: Math.floor(route.cells[i] / w.width) });
    const start = travellerAt(route, w.width, 0)!, end = travellerAt(route, w.width, route.days)!;
    assert(start.phase === 'start' && start.x === cellOf(0).x && start.y === cellOf(0).y, 'Day 0 is not the start');
    assert(end.phase === 'arrived' && Math.abs(end.x - cellOf(route.cells.length - 1).x) < 1e-9, 'Last day is not the arrival');
    // Day 7 is a rest day (six days on the move first): the banner stays put all day.
    const restA = travellerAt(route, w.width, 6.2)!, restB = travellerAt(route, w.width, 6.8)!;
    assert(restA.phase === 'rest' && restB.phase === 'rest' && restA.x === restB.x && restA.travelled === 6, `Rest day moved or mislabelled: ${JSON.stringify([restA, restB])}`);
    // Each night is spent where the planner put it.
    const second = route.stages[1], night = travellerAt(route, w.width, second.night - 0.2)!;
    const moving = travellerAt(route, w.width, second.night - 0.6)!;
    assert(moving.phase === 'travel', `Mid-day should be travelling: ${moving.phase}`);
    assert(night.phase === 'night' && night.stage?.night === second.night && Math.hypot(night.x - second.x, night.y - second.y) < 1.5, `Night 2 not at its stage: ${JSON.stringify([night, second])}`);
    // Progress only goes forward along the route's own cells.
    const anchors = travelAnchors(route, w.width);
    assert(anchors.every((a, i) => i === 0 || (a.index >= anchors[i - 1].index && a.travelled > anchors[i - 1].travelled)), 'Anchors go backwards');
    let lastX = -1;
    for (let d = 0; d <= route.days; d += 0.25) { const at = travellerAt(route, w.width, d)!; assert(at.x >= lastX - 1.5, `Banner went back at day ${d}`); lastX = Math.max(lastX, at.x); }
    // Through the bridge.
    await db.projects.put({ id: P, title: 'Playback', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'travel-profile' };
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'Playback planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    const generated = generateWorld(params);
    await saveSnapshot(worldRuntimeKey(W), paramsKey(params), generated);
    const land = (x: number, y: number) => generated.elevation[y * generated.width + x] > 0.05;
    let planned: { ok: boolean; result?: unknown } | null = null;
    search: for (let y = 12; y < generated.height - 12; y += 3) for (let x = 0; x < generated.width - 20; x += 4) {
      if (!land(x, y) || !land(x + 12, y)) continue;
      for (let i = 0; i < 40; i++) { planned = await runBridgeTool('wh_plan_journey', { worldId: W, stops: [{ x, y }, { x: x + 12, y }], atDay: 1 }); if (planned.ok && !(planned.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 250)); }
      if (planned?.ok && !(planned.result as { impossible?: string }).impossible) break search;
    }
    const at = (planned!.result as { atDay?: { day: number; phase: string } }).atDay;
    assert(at && at.day === 1 && ['travel', 'night', 'arrived'].includes(at.phase), `Bridge atDay: ${JSON.stringify(planned)}`);
    const bad = await runBridgeTool('wh_plan_journey', { worldId: W, stops: [{ x: 1, y: 1 }, { x: 2, y: 1 }], atDay: -1 });
    assert(!bad.ok && bad.code === 'bad-args', 'Negative atDay accepted');
    return [
      'Playback starts at the first cell and arrives at the last; a hard pace holds the banner still through its rest day',
      'Each day moves then halts for the night at the planner\'s stage; the banner only moves forward along the route\'s own cells',
      'wh_plan_journey atDay reports where the party is and what it is doing; a negative day is refused',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(W));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
