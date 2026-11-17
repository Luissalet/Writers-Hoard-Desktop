// Focused deterministic gate for the novelist checks (travel verifier, state ledger, voice by character):
//   node scripts/run-continuity-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const suites = [
  ['continuity-logic.ts', 'runContinuityLogicTests'],
  ['voice-logic.ts', 'runVoiceLogicTests'],
];

await fs.mkdir(cacheDirectory, { recursive: true });
for (const [file, entry] of suites) {
  const output = path.join(cacheDirectory, `writers-hoard-${path.basename(file, '.ts')}-${process.pid}.mjs`);
  try {
    await esbuild.build({
      absWorkingDir: projectRoot,
      entryPoints: [path.join(projectRoot, 'tests', file)],
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
    for (const label of suite[entry]()) console.log(`PASS ${label}`);
  } finally {
    await fs.rm(output, { force: true });
  }
}
