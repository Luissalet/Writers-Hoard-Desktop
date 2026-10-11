import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(path.join(os.tmpdir(), 'writer-faustus-transport-'));
try {
  const output = path.join(directory, 'transport.mjs');
  await build({ entryPoints: ['tests/faustus-copilot-transport.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  await import(pathToFileURL(output).href);
} finally { await rm(directory, { recursive: true, force: true }); }
