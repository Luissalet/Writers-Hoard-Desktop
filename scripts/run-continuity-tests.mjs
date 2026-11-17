// Focused deterministic gate for the continuity checks (travel verifier and state ledger):
//   node scripts/run-continuity-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(cacheDirectory, `writers-hoard-continuity-${process.pid}.mjs`);

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'tests', 'continuity-logic.ts')],
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
  for (const label of suite.runContinuityLogicTests()) console.log(`PASS ${label}`);
} finally {
  await fs.rm(output, { force: true });
}
