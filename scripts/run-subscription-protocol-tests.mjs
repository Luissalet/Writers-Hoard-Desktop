import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'node_modules', '.cache', 'writers-hoard-tests', `subscription-protocol-${process.pid}.mjs`);
try {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await esbuild.build({ entryPoints: [path.join(root, 'tests/subscription-protocol.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  const suite = await import(pathToFileURL(output).href);
  for (const label of suite.runSubscriptionProtocolTests()) console.log(`PASS ${label}`);
} finally {
  await fs.rm(output, { force: true });
}
