// Bundles tests/sd-lora-refusal.node.ts and runs it (no models, no server).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { build } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sd-lora-'));
  const outfile = path.join(dir, 'sd-lora-refusal.cjs');
  await build({
    entryPoints: [path.join(root, 'tests', 'sd-lora-refusal.node.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile, logLevel: 'error',
  });
  const { testSdLoraRefusal } = require(outfile);
  for (const line of testSdLoraRefusal()) console.log('PASS ' + line);
}

main().catch((error) => { console.error('FAIL ' + (error.stack || error)); process.exit(1); });
