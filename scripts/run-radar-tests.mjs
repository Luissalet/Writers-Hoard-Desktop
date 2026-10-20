import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'node_modules', '.cache', `radar-${process.pid}.mjs`);
try { await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'tests/radar-logic.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node20', tsconfig: path.join(root, 'tsconfig.app.json') }); const suite = await import(pathToFileURL(output).href); for (const test of suite.runRadarLogicTests()) console.log(`PASS ${test}`); } finally { await fs.rm(output, { force: true }); }
