import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS, normalizeParams, type WorldData } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { WORLD_PRESETS, applyWorldPreset } from '@/engines/worldgen/core/presets';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import {
  PLANET_KM, SHEET_LAT, cellKmOf, climateLatDeg, isSheet, mapDistanceKm, sheetKmForLandmass, sheetScale, worldKmOf,
} from '@/engines/worldgen/core/geoScale';
import { closedPerimeterKm, measurePolyline, polygonAreaKm2 } from '@/engines/worldgen/core/measure';
import { hydrologyCellArea } from '@/engines/worldgen/core/hydrology';
import { kmPerWorldCell } from '@/engines/worldgen/region/terrain';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Land cells, rivers, towns and the mean sea-level temperature of a generated world. */
function survey(world: WorldData) {
  let land = 0, warm = 0, n = 0;
  for (let i = 0; i < world.elevation.length; i++) {
    if (world.elevation[i] <= 0) continue;
    land++;
    if (world.elevation[i] < 0.2) { warm += world.temperature[i]; n++; }
  }
  const towns = buildHumanGeography(world, undefined, 'places', false).settlements.length;
  return { land, rivers: world.rivers.length, towns, lowlandC: n ? warm / n : NaN };
}

/** The sheet without the database: scale, climate, generation, measures. */
export function sheetChecks(): string[] {
  // ---- the scale -----------------------------------------------------------------
  assert(worldKmOf(undefined) === PLANET_KM && !isSheet({}) && worldKmOf({ worldKm: 40075 }) === PLANET_KM && worldKmOf({ worldKm: 500 }) === PLANET_KM, 'A planet unless a sheet of 1000-40074 km');
  assert(isSheet({ worldKm: 2880 }) && cellKmOf({ worldKm: 2880 }, 1024) === 2880 / 1024 && sheetScale({ worldKm: 4007.5 }) === 0.1, 'A sheet measures its own km');
  assert(sheetKmForLandmass(300) === 1000 && sheetKmForLandmass(900) === 2880 && sheetKmForLandmass(9000) === 28800, `Sheet for a landmass: ${sheetKmForLandmass(300)}, ${sheetKmForLandmass(900)}, ${sheetKmForLandmass(9000)}`);
  assert(normalizeParams({ ...DEFAULT_PARAMS, worldKm: 2880 }).worldKm === 2880 && normalizeParams({ ...DEFAULT_PARAMS, worldKm: 200 }).worldKm === undefined && normalizeParams({ ...DEFAULT_PARAMS, worldKm: 50000 }).worldKm === undefined, 'worldKm kept in range, dropped outside it');
  // The climate: pole to pole on a planet, a band round 40° on a sheet.
  assert(climateLatDeg(0, {}) === 90 && climateLatDeg(1, {}) === -90, 'A planet runs pole to pole');
  const top = climateLatDeg(0, { worldKm: 2880 }), bottom = climateLatDeg(1, { worldKm: 2880 });
  assert(Math.abs(climateLatDeg(0.5, { worldKm: 2880 }) - SHEET_LAT) < 1e-9 && top > SHEET_LAT && top < SHEET_LAT + 8 && bottom < SHEET_LAT && bottom > SHEET_LAT - 8, `A 2880 km sheet spans ${bottom.toFixed(1)}°..${top.toFixed(1)}°`);
  // Distances and areas: flat, at the sheet's scale.
  const sheet = { worldKm: 2048 };
  assert(Math.abs(mapDistanceKm(sheet, 1024, 512, 10, 100, 13, 104) - 5 * 2) < 1e-9, 'Flat distance: a 3-4-5 triangle of 2 km cells is 10 km');
  assert(Math.abs(mapDistanceKm(sheet, 1024, 512, 2, 50, 1020, 50) - 6 * 2) < 1e-9, 'Round the seam the short way');
  const square = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }];
  const ruler = measurePolyline(square, 1024, 512, sheet);
  assert(Math.abs(ruler.totalKm - 60) < 1e-6 && Math.abs(polygonAreaKm2(square, 1024, 512, undefined, sheet) - 400) < 1e-6 && Math.abs(closedPerimeterKm(square, 1024, 512, sheet) - 80) < 1e-6, `The ruler on a sheet: ${ruler.totalKm} km, ${polygonAreaKm2(square, 1024, 512, undefined, sheet)} km²`);
  const planetArea = polygonAreaKm2(square, 1024, 512);
  assert(planetArea > 50000, `The planet's ruler is unchanged: ${Math.round(planetArea)} km²`);
  assert(hydrologyCellArea(1024, 512, 10, sheet) === 4 && hydrologyCellArea(1024, 512, 256) > 1000, 'Rain falls on 4 km² cells on the sheet, on planet cells otherwise');
  assert(kmPerWorldCell({ width: 1024, params: sheet }) === 2 && Math.abs(kmPerWorldCell({ width: 1024 }) - 2 * Math.PI * 6371 / 1024) < 1e-9, 'The regional sheets read the same cell size');

  // ---- a small island, on the planet and on its own sheet ----------------------------
  const island = WORLD_PRESETS.find((p) => p.id === 'island')!;
  const params = { ...applyWorldPreset({ ...DEFAULT_PARAMS, seed: 'sheet-qa', width: 1024 }, island), landmassKm: 300 };
  const onPlanet = survey(generateWorld(params));
  const sheetWorld = generateWorld({ ...params, worldKm: sheetKmForLandmass(300) });
  const onSheet = survey(sheetWorld);
  assert(onSheet.land > onPlanet.land * 100, `The island gets cells: ${onSheet.land} on its sheet against ${onPlanet.land} on the planet`);
  assert(onSheet.rivers >= 5 && onSheet.rivers > onPlanet.rivers, `Rivers: ${onSheet.rivers} against ${onPlanet.rivers}`);
  assert(onSheet.towns >= 30 && onSheet.towns > onPlanet.towns * 5, `Towns: ${onSheet.towns} against ${onPlanet.towns}`);
  assert(onSheet.lowlandC > 5 && onSheet.lowlandC < 22, `A temperate island: lowlands at ${onSheet.lowlandC.toFixed(1)} °C`);
  // The land is about the size asked: its extent at the sheet's own scale.
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < sheetWorld.elevation.length; i++) if (sheetWorld.elevation[i] > 0) { const x = i % sheetWorld.width; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const spanKm = (x1 - x0 + 1) * cellKmOf(sheetWorld.params, sheetWorld.width);
  assert(spanKm > 300 * 0.45 && spanKm < 300 * 2, `About 300 km across on its sheet: ${Math.round(spanKm)} km`);
  const again = generateWorld({ ...params, worldKm: sheetKmForLandmass(300) });
  assert(again.elevation.every((e, i) => e === sheetWorld.elevation[i]), 'The same seed lays the same sheet');
  return [
    'A world is the planet unless worldKm makes it a sheet of 1000-40074 km; a landmass gets a sheet about 3.2 times its size (300 km → 1000, 900 → 2880); worldKm is dropped out of range',
    `The sheet's climate is a band round ${SHEET_LAT}° (${bottom.toFixed(1)}°..${top.toFixed(1)}° for 2880 km); distances, the ruler's area and perimeter, rain per cell and the regional cell size are flat at the sheet's own km; the planet's are unchanged`,
    `A 300 km island: ${onSheet.land} land cells, ${onSheet.rivers} rivers and ${onSheet.towns} towns on its own sheet against ${onPlanet.land}, ${onPlanet.rivers} and ${onPlanet.towns} on the planet; ${Math.round(spanKm)} km across, lowlands at ${onSheet.lowlandC.toFixed(1)} °C; the same seed lays the same sheet`,
  ];
}

/** Bounded sheet worlds: small lands with room for detail, and the bridge. */
export async function testWorldSheet(): Promise<string[]> {
  const P = 'synthetic-sheet';
  try {
    const lines = sheetChecks();
    await db.projects.put({ id: P, title: 'Sheet', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', worldKm: 500 }), /worldKm/, 'A sheet too small');
    bad(await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', worldKm: 5000, sheet: false }), /sheet/, 'worldKm with sheet:false');
    bad(await runBridgeTool('wh_create_world', { projectId: P, preset: 'continents', sheet: true }), /sheet/, 'sheet:true without a landmass or worldKm');
    const made = await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', landmassKm: 300, seed: 'sheet-bridge', width: 1024 });
    const madeR = made.result as { worldId: string; worldKm: number; cellKm: number; sheet: boolean };
    assert(made.ok && madeR.sheet && madeR.worldKm === 1000 && Math.abs(madeR.cellKm - 0.977) < 0.001, `Island on its sheet: ${JSON.stringify(made).slice(0, 300)}`);
    const stored = await db.generatedWorlds.get(madeR.worldId);
    assert(stored?.params.worldKm === 1000 && stored.params.landmassKm === 300, 'Saved with the sheet');
    const planet = await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', sheet: false, seed: 'sheet-planet' });
    assert(planet.ok && !(planet.result as { sheet: boolean }).sheet && (await db.generatedWorlds.get((planet.result as { worldId: string }).worldId))?.params.worldKm === undefined, 'sheet:false keeps the planet');
    const wide = await runBridgeTool('wh_create_world', { projectId: P, preset: 'continents', worldKm: 6000, seed: 'sheet-wide' });
    assert(wide.ok && (wide.result as { worldKm: number }).worldKm === 6000, 'Any preset on a sheet of a chosen width');
    const got = await runBridgeTool('wh_get_world', { worldId: madeR.worldId });
    const gotR = got.result as { worldKm: number; cellKm: number; sheet: boolean };
    assert(got.ok && gotR.sheet && gotR.worldKm === 1000 && gotR.cellKm === madeR.cellKm, `wh_get_world: ${JSON.stringify(got).slice(0, 300)}`);
    const measured = await runBridgeTool('wh_measure_world', { worldId: madeR.worldId, points: [{ x: 100, y: 100 }, { x: 103, y: 104 }] });
    const km = (measured.result as { totalKm: number }).totalKm;
    assert(measured.ok && Math.abs(km - 5 * 1000 / 1024) < 0.02, `wh_measure_world measures flat at the sheet's scale: ${km} km`);
    return [
      ...lines,
      'Bridge: wh_create_world lays island/country/continent on their own sheet by default (worldKm and cellKm returned), sheet:false keeps the planet, worldKm sets a sheet for any preset; too small a sheet, worldKm with sheet:false and sheet:true without a landmass are refused; wh_get_world reports the sheet and wh_measure_world measures flat on it',
    ];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
