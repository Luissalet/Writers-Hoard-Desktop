// Reproducible focused gates:
//   node scripts/run-gallery-import-queue.mjs
//   node scripts/run-gallery-import-queue.mjs --benchmark
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = process.argv.includes('--benchmark');
const entry = benchmark
  ? 'tests/gallery-import-queue.bench.ts'
  : 'tests/gallery-import-queue.ts';
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(
  cacheDirectory,
  `writers-hoard-gallery-import-${benchmark ? 'benchmark' : 'tests'}-${process.pid}.mjs`,
);

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [`./${entry.replaceAll('\\', '/')}`],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
  });

  const suite = await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
  if (benchmark) {
    const report = await suite.runGalleryImportQueueBenchmark();
    console.log(JSON.stringify(report, null, 2));
  } else {
    const passed = await suite.runGalleryImportQueueTests();
    for (const label of passed) console.log(`PASS ${label}`);
  }
} finally {
  await fs.rm(output, { force: true });
}
