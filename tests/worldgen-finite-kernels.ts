import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { recalculateEnvironment } from '../src/engines/worldgen/core/recalculate';
import { computeClimate } from '../src/engines/worldgen/core/climate';
import { computeHydrology, annualRunoff } from '../src/engines/worldgen/core/hydrology';
import { FlowSolver } from '../src/engines/worldgen/core/erosion';
import { nearshoreSst, coastalInfluence, computeCurrents } from '../src/engines/worldgen/core/currents';
import { applyGlaciers } from '../src/engines/worldgen/core/glaciers';
import { detectLandmarks } from '../src/engines/worldgen/core/landmarks';
import { adoptDomainDocument } from '../src/engines/worldgen/core/domainDocument';
import { domainSourceKey, sourceLatitude } from '../src/engines/worldgen/core/worldDomain';
import { DOMAIN_GRIDS, replayDomain } from '../src/engines/worldgen/core/domainReplay';

const hash = (array: ArrayBufferView) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const geometry = (width: number, height: number, originX = 0, originY = 0) => ({ width, height, originX, originY });
const params = { ...DEFAULT_PARAMS, width: 128, seed: 'own-finite-kernel-regression', starter: 'land' as const, erosion: 0, glaciation: .7, sourceFrame: { version: 1 as const, kind: 'flat-sheet' as const, widthKm: 600, centerLatitudeDeg: 40 } };
const environmentFields = ['temperature', 'precipitation', 'biome', 'flow', 'lake', 'lakeSurface', 'currentU', 'currentV', 'sst', 'currentSpeed', 'ice'] as const;

export function runFiniteKernelChecks() {
  const checks: string[] = [];
  const source = generateWorld(params);
  for (const bounds of [{ x: 48, y: 0, width: 32, height: 64 }, { x: -8, y: -16, width: 32, height: 64 }, { x: 49, y: 1, width: 31, height: 63 }, { x: 64, y: 32, width: 1, height: 1 }]) {
    const document = adoptDomainDocument(source, '', { version: 1, sourceKey: domainSourceKey(source.params, ''), entries: [] }, bounds);
    const world = replayDomain(source, document, 1);
    const before = { params: JSON.stringify(world.params), domain: JSON.stringify(world.domain), grids: DOMAIN_GRIDS.map(key => hash(world[key]!)) };
    const environment = recalculateEnvironment(world), count = world.width * world.height;
    for (const key of environmentFields) {
      assert.equal(environment[key]?.length, count, key + ' must use actual rectangular dimensions');
      assert(environment[key]?.every(Number.isFinite), key + ' must remain finite');
    }
    assert.deepEqual({ params: JSON.stringify(world.params), domain: JSON.stringify(world.domain), grids: DOMAIN_GRIDS.map(key => hash(world[key]!)) }, before, 'Recalculation must not mutate input terrain or metadata');
    const complete = { ...world, ...environment };
    for (const key of DOMAIN_GRIDS) assert.equal(complete[key]!.length, count, key + ' must compose with the actual terrain');
    for (const river of environment.rivers) for (let i = 0; i < river.cells.length; i++) {
      const cell = river.cells[i]; assert(cell >= 0 && cell < count);
      if (i) { const previous = river.cells[i - 1]; assert(Math.abs(cell % world.width - previous % world.width) <= 1 && Math.abs(Math.floor(cell / world.width) - Math.floor(previous / world.width)) <= 1, 'A finite river must not cross a wrapped seam'); }
    }
    assert(environment.landmarks.every(point => point.x >= 0 && point.x < world.width && point.y >= 0 && point.y < world.height));
    checks.push(`Actual pipeline/replay/recalculation ${bounds.width}x${bounds.height}:14 fields, immutable input and bounded rivers`);
  }

  const full = computeClimate(params, new Float32Array(128 * 64).fill(-1), null, undefined, { geometry: geometry(128, 64) });
  const odd = computeClimate(params, new Float32Array(31 * 63).fill(-1), null, undefined, { geometry: geometry(31, 63, 48, 0) });
  for (let y = 4; y < 58; y++) for (let x = 4; x < 27; x++) assert(Math.abs(full.temperature[y * 128 + x + 48] - odd.temperature[y * 31 + x]) <= 1e-5, 'Odd bounds must retain the same absolute climate samples');
  const iceFull = applyGlaciers(params, new Float32Array(128 * 64).fill(4), undefined, geometry(128, 64)).ice;
  const iceCrop = applyGlaciers(params, new Float32Array(32 * 64).fill(4), undefined, geometry(32, 64, 48, 0)).ice;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) assert.equal(iceCrop[y * 32 + x], iceFull[y * 128 + x + 48], 'Absolute glacier mask must survive a crop');
  checks.push('Odd climate bounds and cropped glaciers retain absolute source coordinates');

  const width = 16, height = 8, count = width * height, elevation = new Float32Array(count).fill(.3), anomaly = new Float32Array(count);
  for (let y = 0; y < height; y++) { elevation[y * width] = -1; anomaly[y * width] = -5; }
  const legacySst = nearshoreSst(anomaly, elevation, width, height, 2), finiteSst = nearshoreSst(anomaly, elevation, width, height, 2, false);
  const legacyCoast = coastalInfluence(elevation, width, height, 2), finiteCoast = coastalInfluence(elevation, width, height, 2, false);
  for (let y = 0; y < height; y++) {
    assert(legacySst[y * width + width - 1] < 0 && legacyCoast[y * width + width - 1] > 0, 'Legacy wrap must remain observable');
    assert.equal(finiteSst[y * width + width - 1], 0); assert.equal(finiteCoast[y * width + width - 1], 0);
    assert(finiteSst[y * width + 1] < 0, 'Finite influence must still reach the adjacent column');
  }
  checks.push('Finite SST/coasts have no opposite-edge alias; legacy seam remains active');

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) elevation[y * width + x] = x === width - 1 ? -1 : 1 + (width - x) * .02;
  const solver = new FlowSolver(width, height, 2, true); solver.solve(elevation, new Float32Array(count).fill(1));
  for (let cell = 0; cell < count; cell++) { const next = solver.receiver[cell]; assert(next >= 0 && next < count); assert(Math.abs(cell % width - next % width) <= 1 && Math.abs(Math.floor(cell / width) - Math.floor(next / width)) <= 1, 'Flow receiver must be a finite neighbour'); }
  const hydrology = computeHydrology({ ...params, hydrologyVersion: 2, drainageVersion: 2 }, elevation, new Float32Array(count).fill(1400), solver, new Float32Array(count).fill(15), geometry(width, height));
  assert(hydrology.discharge); let discharge = 0;
  for (let cell = 0; cell < count; cell++) if (solver.receiver[cell] === cell) discharge += hydrology.discharge[cell];
  const expected = (width - 1) * height * annualRunoff(1400, 15) * (600 / 128) ** 2 * 1000 / (365.25 * 24 * 60 * 60);
  assert(Math.abs(discharge - expected) <= expected * 1e-5, 'Total runoff must use immutable source cell area');
  checks.push('Finite flow receivers and total physical runoff use the immutable source cell');

  const landmarkWidth = 129, landmarkHeight = 96, landmarkCount = landmarkWidth * landmarkHeight, boundary = new Float32Array(landmarkCount);
  boundary[80 * landmarkWidth] = .8; boundary[80 * landmarkWidth + 128] = .8;
  const landmarks = detectLandmarks(params, new Float32Array(landmarkCount).fill(.6), boundary, new Float32Array(landmarkCount).fill(800), new Float32Array(landmarkCount).fill(15), [], new Uint8Array(landmarkCount), geometry(landmarkWidth, landmarkHeight));
  assert.deepEqual(landmarks.filter(point => point.type === 'volcano').map(point => [point.x, point.y]).sort((a, b) => a[0] - b[0]), [[0, 80], [128, 80]], 'Both finite edge volcanoes beyond carrier height must remain distinct');
  const currents = computeCurrents(params, new Float32Array(641 * 65).fill(-1), undefined, geometry(641, 65, -16, 16));
  for (const field of Object.values(currents)) { assert.equal(field.length, 641 * 65); assert(field.every(Number.isFinite)); }
  checks.push('Nonempty edge landmarks and reduced currents use actual rectangular dimensions');

  const legacy = { ...DEFAULT_PARAMS, width: 128 };
  for (const y of [-512, 512]) assert(Math.abs(sourceLatitude(legacy, y)) <= 89, 'An adopted legacy source extension must remain within physical latitude');
  checks.push('Adopted legacy source extensions have bounded absolute latitude');
  return checks;
}
