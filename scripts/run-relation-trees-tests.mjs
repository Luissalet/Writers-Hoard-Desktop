import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'node_modules', '.cache', `relation-trees-${process.pid}.mjs`);
try {
  await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'tests/relation-trees-logic.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node20', tsconfig: path.join(root, 'tsconfig.app.json') });
  const suite = await import(pathToFileURL(output).href);
  for (const test of suite.runRelationTreeLogicTests()) console.log(`PASS ${test}`);
} finally { await fs.rm(output, { force: true }); }
