// Focused gate: MCP/bridge tool descriptions stay under 750 characters (about 250 tokens).
//   node scripts/run-mcp-description-budget-tests.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'writers-hoard-tests');
const output = path.join(cacheDirectory, `writers-hoard-mcp-desc-${process.pid}.mjs`);
const MAX_DESCRIPTION_CHARS = 750;

try {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'src', 'services', 'aiBridge', 'manifest.ts')],
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
  const mod = await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
  const tools = mod.BRIDGE_TOOLS;
  assert.ok(Array.isArray(tools) && tools.length > 0, 'BRIDGE_TOOLS is non-empty');
  const oversized = tools
    .filter((t) => (t.description || '').length > MAX_DESCRIPTION_CHARS)
    .map((t) => `${t.name}:${t.description.length}`);
  assert.deepEqual(oversized, [], `oversized descriptions: ${oversized.join(', ')}`);
  console.log(`PASS every bridge/MCP tool description ≤ ${MAX_DESCRIPTION_CHARS} chars (${tools.length} tools)`);

  for (const name of ['wh_list_claims', 'wh_grade_source']) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} present`);
    const chars = tool.description.length;
    const tokens = Math.ceil(chars / 3);
    const first = tool.description.split('\n')[0];
    assert.ok(first.length <= 110, `${name} first line ${first.length} > 110`);
    assert.ok(chars <= 750, `${name} ${chars} chars (>750 ≈ 250 tokens)`);
    assert.ok(tokens <= 250, `${name} ~${tokens} tokens`);
    console.log(`PASS ${name}: ${chars} chars (~${tokens} tokens), first line ${first.length}`);
  }
} finally {
  await fs.rm(output, { force: true });
}
