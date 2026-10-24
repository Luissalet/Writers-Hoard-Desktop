// Real built-worker RegionSheet precheck. Reuses the normal CSS harness only.
// Precondition: run the product's normal npm run build in this repository first.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

async function main() {
  if (!process.versions.electron) throw new Error('Run this precheck with the existing Electron executable.');
  const assets = path.join(process.cwd(), 'dist', 'assets');
  const matches = fs.existsSync(assets)
    ? fs.readdirSync(assets).filter(name => /^region\.worker-[\w-]+\.js$/.test(name)) : [];
  if (matches.length !== 1) throw new Error('Run npm run build first in the repository root; expected one dist/assets/region.worker-*.js.');
  const filename = path.join(assets, matches[0]);
  const asset = {
    url: pathToFileURL(filename).href,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
  };
  console.log(`REGION_WORKER_ASSET ${JSON.stringify(asset)}`);
  const runner = require('../scripts/run-codex-properties-ui.cjs');
  const preloadFile = path.join(runner.directory, 'place-icon-worker.preload.cjs');
  fs.writeFileSync(preloadFile,
    `const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('__placeIconWorkerTest',Object.freeze(${JSON.stringify(asset)}));`, 'utf8');
  process.argv[2] = 'tests/review-worldgen-place-icons.browser.tsx';
  process.argv[3] = 'testReviewPlaceIconRegionSheetDownloadProvisional';
  await runner.main({ preloadFile });
}

main().catch(error => {
  console.error(error.stack || error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
