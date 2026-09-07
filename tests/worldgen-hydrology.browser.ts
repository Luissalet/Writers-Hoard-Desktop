import { FlowSolver } from '@/engines/worldgen/core/erosion';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { annualRunoff, computeHydrology, hydrologyCellArea } from '@/engines/worldgen/core/hydrology';
import { DEFAULT_PARAMS, normalizeParams } from '@/engines/worldgen/core/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sum = (values: Float32Array | Uint8Array) => values.reduce((total, value) => total + value, 0);
const volumeFactor = 1000 / (365.25 * 24 * 60 * 60);

export async function testWorldgenHydrology(): Promise<string[]> {
  const passed: string[] = [];
  assert(DEFAULT_PARAMS.hydrologyVersion === 2 && normalizeParams({ hydrologyVersion: undefined }).hydrologyVersion === 1, 'Annual hydrology must be explicit for new recipes and preserve old ones');
  assert(annualRunoff(0, 15) === 0 && annualRunoff(120, 35) === 0, 'Dry catchments must not create floor rainfall');
  assert(annualRunoff(1800, 15) > annualRunoff(800, 15) && annualRunoff(800, 0) > annualRunoff(800, 25), 'Rainfall and evaporation must influence annual runoff in opposite directions');

  // A sloping, depression-free continent drains into a fixed southern sea band.
  // Its physical area is identical at both resolutions, so both local and
  // whole-world balances expose accidental rainfall or grid normalization.
  const totals: number[] = [];
  for (const width of [128, 256]) {
    const height = width / 2, length = width * height;
    const seaStart = height * 15 / 16;
    const elevation = Float32Array.from({ length }, (_, i) => Math.floor(i / width) >= seaStart ? -1 : 3 - Math.floor(i / width) / height * 2);
    const rain = new Float32Array(length).fill(1000), temperature = new Float32Array(length).fill(15);
    const solver = new FlowSolver(width, height, 2);
    const hydro = computeHydrology({ ...DEFAULT_PARAMS, width }, elevation, rain, solver, temperature);
    assert(sum(hydro.lake) === 0, 'Conservation fixture unexpectedly contains a depression');
    let expected = 0, delivered = 0;
    for (let i = 0; i < length; i++) {
      if (elevation[i] > 0) expected += annualRunoff(rain[i], temperature[i]) * hydrologyCellArea(width, height, Math.floor(i / width)) * volumeFactor;
      if (solver.receiver[i] === i) delivered += hydro.discharge![i];
    }
    assert(Math.abs(delivered - expected) / expected < 0.00001, 'River routing did not conserve physical runoff into outlets');
    totals.push(delivered);
  }
  assert(Math.abs(totals[0] - totals[1]) / totals[0] < 0.00001, 'Changing grid resolution changed total physical runoff');
  passed.push('Hydrology v2: annual runoff is conserved at outlets and independent of grid resolution for the same physical continent');

  const params = { ...DEFAULT_PARAMS, seed: 'hydrology-study', width: 512, hydrologyVersion: 1 as const };
  const world = generateWorld(params);
  const length = world.elevation.length;
  const scenario = (rain: number, temperature: number, density = 0.5) => computeHydrology(
    { ...params, hydrologyVersion: 2, riverDensity: density }, world.elevation,
    new Float32Array(length).fill(rain), null, new Float32Array(length).fill(temperature),
  );
  const dry = scenario(0, 15), arid = scenario(120, 15), temperate = scenario(800, 15), wet = scenario(1800, 15);
  assert(dry.rivers.length === 0 && sum(dry.lake) === 0 && sum(dry.flowMap) === 0, 'Rainless worlds must have no permanent rivers, wetland flow or lakes');
  assert(arid.rivers.length === 0 && sum(arid.lake) === 0, 'Arid worlds must not inherit permanent water from their terrain depressions');
  assert(temperate.rivers.length > 0 && wet.rivers.length > temperate.rivers.length && sum(wet.flowMap) > sum(temperate.flowMap), 'Wetter climate must produce a larger river network and stronger absolute flow');
  const cold = scenario(800, 0), hot = scenario(800, 30);
  assert(cold.rivers.length > hot.rivers.length && sum(cold.discharge!) > sum(hot.discharge!), 'Temperature must affect river discharge through evaporation');
  const sparse = scenario(800, 15, 0), dense = scenario(800, 15, 1);
  assert(sparse.rivers.length < temperate.rivers.length && temperate.rivers.length < dense.rivers.length, 'Density control must expose progressively smaller rivers');
  assert(sparse.discharge!.every((value, i) => value === dense.discharge![i]), 'Display density must not alter the water balance');
  const repeat = scenario(800, 15);
  assert(repeat.discharge!.every((value, i) => value === temperate.discharge![i]) && JSON.stringify(repeat.rivers) === JSON.stringify(temperate.rivers), 'Identical climate and terrain must give identical rivers');
  passed.push(`Hydrology v2 fixed terrain: dry/temperate/wet river counts ${dry.rivers.length}/${temperate.rivers.length}/${wet.rivers.length}; density low/default/high ${sparse.rivers.length}/${temperate.rivers.length}/${dense.rivers.length}; cold/hot ${cold.rivers.length}/${hot.rivers.length}`);

  // Wet headwaters enter a much larger hot, rainless depression. The lake must
  // absorb the inflow rather than leave a river continuing below a dry basin.
  const width = 128, height = 64, n = width * height;
  const elevation = Float32Array.from({ length: n }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    if (y === height - 1) return -1;
    if (x >= 52 && x <= 75 && y >= 25 && y <= 44) return 0.2;
    return 3 - y * 0.04 + Math.abs(x - width / 2) * 0.03;
  });
  const rain = new Float32Array(n), temperatures = new Float32Array(n).fill(35);
  for (let y = 5; y <= 15; y++) for (let x = 62; x <= 65; x++) rain[y * width + x] = 1800;
  const sink = computeHydrology({ ...DEFAULT_PARAMS, width }, elevation, rain, null, temperatures);
  assert(sum(sink.discharge!) > 0, 'Dry-sink fixture must include real wet headwater inflow');
  assert(sum(sink.lake) === 0, 'Evaporation must prevent a permanent lake in the hot dry sink');
  let downstream = 0;
  for (let y = 46; y < height; y++) for (let x = 0; x < width; x++) downstream += sink.discharge![y * width + x];
  assert(downstream < 0.1, 'A dry basin leaked a ghost river downstream');
  assert(sink.rivers.every((river) => [...river.cells].every((cell) => Math.floor(cell / width) <= 45)), 'Rendered river paths continued beyond the dry sink');
  passed.push('Hydrology v2: an evaporating dry basin absorbs wet headwaters and removes ghost rivers downstream');
  return passed;
}
