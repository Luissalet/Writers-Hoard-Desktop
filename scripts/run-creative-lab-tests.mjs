// Focused deterministic gate:
//   node scripts/run-creative-lab-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(cacheDirectory, `writers-hoard-creative-lab-${process.pid}.mjs`);

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'tests', 'creative-lab.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
    sourcemap: 'inline',
  });

  const suite = await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
  const passed = suite.runCreativeLabTests();
  for (const label of passed) console.log(`PASS ${label}`);
} finally {
  await fs.rm(output, { force: true });
}
