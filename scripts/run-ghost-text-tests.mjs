// Logic gate for ghost text (eligibility, codex context, trimming, model choice,
// debounce and cancellation):  node scripts/run-ghost-text-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(cacheDirectory, `writers-hoard-ghost-text-${process.pid}.mjs`);

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'tests', 'ghost-text-logic.ts')],
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
  for (const label of suite.runGhostTextLogicTests()) console.log(`PASS ${label}`);
  for (const label of await suite.runGhostSchedulerTests()) console.log(`PASS ${label}`);
} finally {
  await fs.rm(output, { force: true });
}