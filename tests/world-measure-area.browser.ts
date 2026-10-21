import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { PLANET_RADIUS_KM, polygonAreaKm2, closedPerimeterKm, cellDistanceKm } from '@/engines/worldgen/core/measure';
import { placeReference, referenceRings, SCALE_REFERENCES } from '@/engines/worldgen/core/scaleReference';
import { loadBasemap } from '@/engines/real-atlas/basemap';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const W = 2048, H = 1024, DEG = Math.PI / 180;
const cell = (lon: number, lat: number) => ({ x: (lon + 180) / 360 * W, y: (90 - lat) / 180 * H });
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) / b <= tolerance;

export async function testWorldMeasureArea(): Promise<string[]> {
  const P = 'synthetic-measure-area';
  try {
    // A lat/lon rectangle has an exact spherical area: R² Δλ (sin φ2 − sin φ1).
    const exact = (lon0: number, lon1: number, lat0: number, lat1: number) => PLANET_RADIUS_KM ** 2 * (lon1 - lon0) * DEG * (Math.sin(lat1 * DEG) - Math.sin(lat0 * DEG));
    const box = (lon0: number, lon1: number, lat0: number, lat1: number) => [cell(lon0, lat0), cell(lon1, lat0), cell(lon1, lat1), cell(lon0, lat1)];
    for (const [lon0, lon1, lat0, lat1] of [[0, 10, 0, 10], [20, 21, 60, 61], [-170, -100, -40, 20]]) {
      const area = polygonAreaKm2(box(lon0, lon1, lat0, lat1), W, H), truth = exact(lon0, lon1, lat0, lat1);
      assert(near(area, truth, 0.01), `Rectangle ${lon0},${lat0} area ${area} vs ${truth}`);
    }
    // Orientation and the east-west seam do not change the answer.
    const reversed = box(0, 10, 0, 10).reverse();
    assert(near(polygonAreaKm2(reversed, W, H), exact(0, 10, 0, 10), 0.01), 'Clockwise ring measured differently');
    const seam = box(175, 185, 0, 10).map(p => ({ x: p.x % W, y: p.y }));
    assert(near(polygonAreaKm2(seam, W, H), exact(0, 10, 0, 10), 0.01), `Seam ring ${polygonAreaKm2(seam, W, H)} vs ${exact(0, 10, 0, 10)}`);
    assert(polygonAreaKm2(box(0, 10, 0, 10).slice(0, 2), W, H) === 0, 'Two points enclose nothing');
    // A ring round the pole measures the polar cap, not the rest of the planet.
    const cap = PLANET_RADIUS_KM ** 2 * 2 * Math.PI * (1 - Math.sin(60 * DEG));
    const round = polygonAreaKm2([cell(-180, 60), cell(-60, 60), cell(60, 60)], W, H);
    assert(near(round, cap, 0.01), `Polar ring ${round} vs cap ${cap}`);
    const wide = polygonAreaKm2([cell(-170, 50), cell(-50, 70), cell(70, 55)], W, H);
    assert(wide < 2 * Math.PI * PLANET_RADIUS_KM ** 2, `A ring round the pole reported more than a hemisphere: ${wide}`);
    const square = box(0, 10, 0, 10), perimeter = closedPerimeterKm(square, W, H);
    const expectedPerimeter = cellDistanceKm(square[0], square[1], W, H) + cellDistanceKm(square[1], square[2], W, H) + cellDistanceKm(square[2], square[3], W, H) + cellDistanceKm(square[3], square[0], W, H);
    assert(Math.abs(perimeter - expectedPerimeter) < 1e-6, 'Closed perimeter omitted the closing side');

    // Real outlines keep their size wherever they are laid.
    const basemap = await loadBasemap();
    for (const ref of SCALE_REFERENCES) assert(referenceRings(basemap, ref).length > 0, `No outline for ${ref.id}`);
    const iberia = referenceRings(basemap, SCALE_REFERENCES.find(ref => ref.id === 'iberia')!);
    const areaAt = (u: number, v: number) => placeReference(iberia, u, v).rings.reduce((sum, ring) => sum + polygonAreaKm2(ring.map(([x, y]) => ({ x: x * W, y: y * H })), W, H), 0);
    const equator = areaAt(0.3, 0.5), north = areaAt(0.7, 0.22), seamArea = areaAt(0.999, 0.4);
    // Iberia is about 582,000 km² on Earth; the planet radius differs by 0.1%.
    assert(near(equator, 582000, 0.08) && near(north, equator, 0.04) && near(seamArea, equator, 0.04), `Outline area changed with position: ${Math.round(equator)} / ${Math.round(north)} / ${Math.round(seamArea)}`);
    const placed = placeReference(iberia, 0.5, 0.5);
    assert(near(placed.widthKm, 1100, 0.2) && near(placed.heightKm, 1000, 0.2), `Iberia bounding size ${placed.widthKm} × ${placed.heightKm}`);
    const europe = referenceRings(basemap, SCALE_REFERENCES.find(ref => ref.id === 'europe')!);
    assert(europe.every(ring => ring.every(([lon, lat]) => lon > -40 && lon < 60 && lat > 25)), 'Europe kept overseas territories');

    // MCP ruler: distance, legs and enclosed area.
    await db.projects.put({ id: P, title: 'Measure', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: 'measure-world', projectId: P, title: 'Measure', params: { ...DEFAULT_PARAMS, width: W }, edits: '[]', createdAt: 1, updatedAt: 1 });
    const measured = await runBridgeTool('wh_measure_world', { worldId: 'measure-world', points: box(0, 10, 0, 10) });
    assert(measured.ok, JSON.stringify(measured));
    const result = measured.result as { totalKm: number; legs: unknown[]; areaKm2: number; closedPerimeterKm: number };
    assert(result.legs.length === 3 && near(result.areaKm2, exact(0, 10, 0, 10), 0.01) && Math.abs(result.closedPerimeterKm - expectedPerimeter) < 0.02, `Bridge ruler wrong: ${JSON.stringify(result)}`);
    const line = await runBridgeTool('wh_measure_world', { worldId: 'measure-world', points: box(0, 10, 0, 10).slice(0, 2) });
    assert(line.ok && (line.result as { areaKm2?: number }).areaKm2 === undefined, 'Two points reported an area');
    const bad = await runBridgeTool('wh_measure_world', { worldId: 'measure-world', points: [{ x: 1, y: -5 }, { x: 2, y: 2 }] });
    assert(!bad.ok && bad.code === 'bad-args', 'Accepted a point off the sheet');
    return [
      'Enclosed area matches the exact spherical rectangle within 1% at the equator, high latitude and across 70° of longitude; orientation and the seam do not change it',
      'Closed perimeter includes the closing side; two points enclose nothing; a ring round a pole measures the polar cap',
      'Every bundled real outline loads; Iberia keeps its ~582,000 km² wherever it is laid, including across the seam; Europe drops overseas territories',
      'wh_measure_world returns legs, distance, area and closed perimeter, and refuses points off the sheet',
    ];
  } finally {
    await db.generatedWorlds.delete('measure-world'); await db.projects.delete(P);
  }
}
