const { buildSync } = require('esbuild');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const directory = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bridge-manifest-'));
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'manifest.cjs');
const result = buildSync({
  entryPoints: [path.join(root, 'src/services/aiBridge/manifest.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: file,
  metafile: true,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'warning',
});
const forbidden = Object.keys(result.metafile.inputs).filter(name =>
  /src\/(db|components)\/|node_modules\/(dexie|dompurify|react)\//.test(name));
assert.deepEqual(forbidden, [], 'The main-process tool manifest imports database or browser code');
assert.equal(typeof window, 'undefined', 'This regression must run in plain Node');
const { BRIDGE_TOOLS, getBridgeTool } = require(file);
assert(BRIDGE_TOOLS.length > 0, 'The main-process tool catalog is empty');
const reveal = getBridgeTool('wh_set_revealed');
assert(reveal?.writes && reveal.schema.required.includes('entryIds'), 'The reveal tool disappeared from the catalog');
assert(reveal.schema.properties.note.description.includes('500'), 'The reveal note limit was lost');
assert(reveal.schema.properties.moment.description.includes('120'), 'The reveal moment limit was lost');
console.log(`PASS Main-process manifest imports in plain Node without DOM, database or renderer modules (${BRIDGE_TOOLS.length} tools)`);
console.log('PASS Reveal tool schema and limits remain available to external clients');
