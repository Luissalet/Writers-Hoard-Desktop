// Pure-core Node benchmark; no Electron, GPU, database, or user worlds involved.
// Example: node scripts/benchmark-worldgen.mjs --baseline HEAD --output /tmp/worldgen.json
// Generation is expensive: defaults to one paired run, while hot paths use
// three measured pairs after warmup. Increase --generation-samples to 3 for
// generation medians. Timings remain machine/load dependent, never CI gates.
// Optional --modern-samples 3 also profiles current v2 recipes and verifies
// determinism across those runs; the paired compatibility run stays v1.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Expected --option value pairs');
  flags.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const baseline = flags.get('baseline') ?? 'HEAD';
const widths = (flags.get('widths') ?? '1024,2048').split(',').map(Number);
const samples = Number(flags.get('samples') ?? 3);
const generationSamples = Number(flags.get('generation-samples') ?? 1);
const modernSamples = Number(flags.get('modern-samples') ?? 0);
if (widths.some((width) => !Number.isInteger(width) || width < 32 || width > 4096 || width % 2)
  || !Number.isInteger(samples) || samples < 1 || !Number.isInteger(generationSamples) || generationSamples < 1
  || !Number.isInteger(modernSamples) || modernSamples < 0) throw new Error('Invalid widths or sample counts');
const scratch = mkdtempSync(path.join(tmpdir(), 'wh-worldgen-benchmark-'));
const require = createRequire(import.meta.url);
const sourceCache = new Map();
function readBaseline(relativePath) {
  if (!sourceCache.has(relativePath)) {
    try { sourceCache.set(relativePath, execFileSync('git', ['show', `${baseline}:${relativePath}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { sourceCache.set(relativePath, null); }
  }
  return sourceCache.get(relativePath);
}
const baselinePlugin = {
  name: 'read-only-git-baseline',
  setup(builder) {
    builder.onResolve({ filter: /^baseline:/ }, ({ path: entry }) => ({ path: entry.slice(9), namespace: 'baseline' }));
    builder.onResolve({ filter: /.*/, namespace: 'baseline' }, (args) => {
      const stem = args.path.startsWith('@/') ? `src/${args.path.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
      for (const candidate of [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`]) {
        if (readBaseline(candidate) !== null) return { path: candidate, namespace: 'baseline' };
      }
      throw new Error(`Missing baseline dependency ${args.path} from ${args.importer}`);
    });
    builder.onLoad({ filter: /.*/, namespace: 'baseline' }, ({ path: entry }) => ({ contents: readBaseline(entry), loader: entry.endsWith('.tsx') ? 'tsx' : 'ts' }));
  },
};
async function bundle(old) {
  const prefix = old ? 'baseline:src/engines/worldgen/core/' : './src/engines/worldgen/core/';
  const outfile = path.join(scratch, old ? 'before.cjs' : 'after.cjs');
  await build({ stdin: { contents: `export { generateWorld } from '${prefix}pipeline.ts'; export { buildPlates } from '${prefix}plates.ts'; export { DEFAULT_PARAMS } from '${prefix}types.ts'; export { renderBase, renderAtlasWindow, renderComposite${old ? '' : ', renderAtlasPreview'} } from '${prefix}render.ts'; export { encodeWorld, decodeWorld } from '${prefix}worldStore.ts';`, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', plugins: old ? [baselinePlugin] : [], alias: { '@': path.join(root, 'src') } });
  return require(outfile);
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function hashFields(value, keys) {
  const result = createHash('sha256');
  for (const key of keys) result.update(value[key]);
  for (const river of value.rivers ?? []) result.update(river.cells);
  return result.digest('hex');
}
function statistics(before, after) {
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return { beforeMs: before, afterMs: after, beforeMedianMs: median(before), afterMedianMs: median(after) };
}
function pair(before, after, count = samples) {
  const oldTimes = [], newTimes = [];
  for (let i = 0; i <= count; i++) {
    let start = performance.now(); before(); if (i) oldTimes.push(performance.now() - start);
    start = performance.now(); after(); if (i) newTimes.push(performance.now() - start);
  }
  return statistics(oldTimes, newTimes);
}
async function asyncPair(before, after) {
  const oldTimes = [], newTimes = [];
  for (let i = 0; i <= samples; i++) {
    let start = performance.now(); await before(); if (i) oldTimes.push(performance.now() - start);
    start = performance.now(); await after(); if (i) newTimes.push(performance.now() - start);
  }
  return statistics(oldTimes, newTimes);
}
const results = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, baseline: execFileSync('git', ['rev-parse', baseline], { cwd: root, encoding: 'utf8' }).trim(), methodology: 'Pure core in Node; same seed and explicit legacy drainage/hydrology v1; paired before/after on this machine. Exact hashes cover every baseline typed field and river cells; newly added fields are listed separately. Hot paths discard one warmup pair. Generation samples are not warmed. Thumbnail baseline measures full composite only, excluding canvas downscaling, so its comparison is conservative. Each snapshot decoder reads its own encoded format.', seed: flags.get('seed') ?? 'core-audit', samples, generationSamples, widths: [] };
try {
  const before = await bundle(true), after = await bundle(false);
  for (const width of widths) {
    const params = { ...after.DEFAULT_PARAMS, seed: results.seed, width, drainageVersion: 1, hydrologyVersion: 1 };
    const oldTimes = [], newTimes = [], stagesBefore = [], stagesAfter = [];
    let world, oldWorld, comparedFields;
    const generate = (api, stages) => {
      const timing = {}; let stage = '', last = performance.now();
      const result = api.generateWorld(params, (next) => { if (next !== stage) { const now = performance.now(); if (stage) timing[stage] = (timing[stage] ?? 0) + now - last; last = now; stage = next; } });
      stages.push(timing); return result;
    };
    for (let i = 0; i < generationSamples; i++) {
      let start = performance.now(); oldWorld = generate(before, stagesBefore); oldTimes.push(performance.now() - start);
      start = performance.now(); world = generate(after, stagesAfter); newTimes.push(performance.now() - start);
      process.stderr.write(`Worldgen ${width}: generation pair ${i + 1}/${generationSamples}\n`);
      comparedFields = Object.keys(oldWorld).filter((key) => ArrayBuffer.isView(oldWorld[key])).sort();
      if (hashFields(oldWorld, comparedFields) !== hashFields(world, comparedFields)) throw new Error(`Legacy world mismatch at ${width}`);
    }
    const generation = { ...statistics(oldTimes, newTimes), stagesBefore, stagesAfter, identicalFields: true, comparedFields, addedFields: Object.keys(world).filter((key) => ArrayBuffer.isView(world[key]) && !comparedFields.includes(key)), elevationSha256: hash(world.elevation) };
    const plates = pair(() => before.buildPlates(params), () => after.buildPlates(params));
    const base = after.renderBase(world, 'atlas', { shade: false });
    const oldPixels = new Uint8ClampedArray(1280 * 720 * 4), newPixels = new Uint8ClampedArray(oldPixels.length);
    const view = { x: -25, y: 0, w: width / 3, h: width / 5 };
    const window = { ...pair(() => before.renderAtlasWindow(world, base, oldPixels, 1280, 720, view), () => after.renderAtlasWindow(world, base, newPixels, 1280, 720, view)), identicalPixels: hash(oldPixels) === hash(newPixels) };
    if (!window.identicalPixels) throw new Error(`Atlas window mismatch at ${width}`);
    const thumbnail = { ...pair(() => before.renderComposite(world, 'atlas', true), () => after.renderAtlasPreview(world, 256, true)), fullRasterBytes: width * (width / 2) * 8, previewRasterBytes: width <= 256 ? width * (width / 2) * 8 : 256 * 128 * 5 };
    const oldBytes = await before.encodeWorld(world), newBytes = await after.encodeWorld(world);
    const snapshot = { ...await asyncPair(() => before.decodeWorld(oldBytes), () => after.decodeWorld(newBytes)), temporaryBytesAvoided: width * (width / 2) * 16 };
    let modernGeneration;
    if (modernSamples) {
      const durations = [], stages = [];
      let referenceHash;
      for (let sample = 0; sample < modernSamples; sample++) {
        const timing = {}; let stage = '', last = performance.now(); const start = last;
        const modern = after.generateWorld({ ...params, drainageVersion: 2, hydrologyVersion: 2 }, (next) => {
          if (next !== stage) { const now = performance.now(); if (stage) timing[stage] = (timing[stage] ?? 0) + now - last; last = now; stage = next; }
        });
        durations.push(performance.now() - start); stages.push(timing);
        const actualHash = hashFields(modern, Object.keys(modern).filter((key) => ArrayBuffer.isView(modern[key])).sort());
        referenceHash ??= actualHash;
        if (actualHash !== referenceHash) throw new Error(`Modern world is not deterministic at ${width}`);
      }
      modernGeneration = { samples: modernSamples, durationsMs: durations, medianMs: [...durations].sort((a, b) => a - b)[Math.floor(modernSamples / 2)], stages, deterministicFieldsSha256: referenceHash };
    }
    results.widths.push({ width, generation, plates, window, thumbnail, snapshot, modernGeneration });
    process.stderr.write(`Worldgen ${width}: paired hot-path measurements complete\n`);
  }
  const json = `${JSON.stringify(results, null, 2)}\n`;
  if (flags.has('output')) { const output = path.resolve(flags.get('output')); mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, json); }
  process.stdout.write(json);
} finally {
  for (const name of ['before.cjs', 'after.cjs']) { try { unlinkSync(path.join(scratch, name)); } catch { /* A failed build may not have produced both files. */ } }
  try { rmdirSync(scratch); } catch { /* Keep diagnostics if an unexpected file was produced. */ }
}
