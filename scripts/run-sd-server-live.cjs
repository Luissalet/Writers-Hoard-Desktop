// Bundles tests/sd-server-live.ts for Node and runs it against the installed
// sd-server runtime and model (see the test header). Exit code 0 = PASS.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { build } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sd-live-'));
  const outfile = path.join(dir, 'sd-server-live.cjs');
  await build({
    entryPoints: [path.join(root, 'tests', 'sd-server-live.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile, logLevel: 'error',
    alias: { '@': path.join(root, 'src') },
  });
  const { testSdServerLive } = require(outfile);
  for (const line of await testSdServerLive()) console.log('PASS ' + line);
}

main().catch((error) => { console.error('FAIL ' + (error.stack || error)); process.exit(1); });
