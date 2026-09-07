// Focused deterministic gate:
//   node scripts/run-narrative-xray-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(cacheDirectory, `writers-hoard-narrative-xray-${process.pid}.mjs`);

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'tests', 'narrative-xray.tsx')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
    sourcemap: 'inline',
    define: { 'process.env.NODE_ENV': '"test"' },
  });

  const suite = await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
  const passed = suite.runNarrativeXrayTests();
  for (const label of passed) console.log(`PASS ${label}`);
} finally {
  await fs.rm(output, { force: true });
}
