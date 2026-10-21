// Hidden native UI uses the product preload, IPC registration and CPU worker.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const harness = require('./run-codex-properties-ui.cjs');
const cache = process.env.WH_VISUAL_SEARCH_TEST_CACHE;
if (!cache || !path.isAbsolute(cache)) throw Error('Set WH_VISUAL_SEARCH_TEST_CACHE to the isolated prepared model directory.');
const root = path.resolve(__dirname, '..'), preloadFile = path.join(harness.directory, 'native-preload.cjs');
esbuild.buildSync({ entryPoints: [path.join(root, 'electron/preload.ts')], outfile: preloadFile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
esbuild.buildSync({ entryPoints: [path.join(root, 'electron/visualSearch/ipc.ts'), path.join(root, 'electron/visualSearch/runtime.ts'), path.join(root, 'electron/security.ts')], outdir: path.join(root, 'dist-electron/visual-search-test'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@huggingface/transformers'] });
esbuild.buildSync({ entryPoints: [path.join(root, 'electron/visualSearch/worker.ts')], outfile: path.join(root, 'dist-electron/visualSearch/worker.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['@huggingface/transformers'] });
const { registerVisualSearchIpc } = require('../dist-electron/visual-search-test/visualSearch/ipc.cjs');
const { VisualSearchRuntime } = require('../dist-electron/visual-search-test/visualSearch/runtime.cjs');
const { isIpcChannelAllowedForRole } = require('../dist-electron/visual-search-test/security.cjs');
const runtime = new VisualSearchRuntime(cache, path.join(root, 'dist-electron/visualSearch/worker.cjs'));
let expectedWindow;
const fixtures = [path.join(root, '.impeccable/review/maps-depth/continents-wonder-country-cpu.png'), process.env.WH_VISUAL_SEARCH_TEST_PAGE];
if (fixtures.some(file => !file || !fs.existsSync(file))) throw Error('Provide the prepared local page fixture in WH_VISUAL_SEARCH_TEST_PAGE.');
harness.main({ preloadFile, setup() {
  for (const action of ['status', 'prepare', 'image', 'text']) {
    if (!isIpcChannelAllowedForRole(`visual-search:${action}`, 'main') || isIpcChannelAllowedForRole(`visual-search:${action}`, 'quick-note')) throw Error('Visual IPC role matrix failed');
  }
  registerVisualSearchIpc((event, channel) => { if (event.sender !== expectedWindow?.webContents || !isIpcChannelAllowedForRole(channel, 'main')) throw Error('Test sender is not the isolated main renderer'); }, runtime);
}, async window(win) {
  expectedWindow = win;
  win.webContents.once('did-finish-load', () => { void win.webContents.executeJavaScript(`window.__visualFixtures = ${JSON.stringify(fixtures.map(file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64')))}; 0`); });
}, close: () => runtime.close() }).catch(async error => { console.error(error.stack || error); await runtime.close(); app.exit(1); });
