// Real domain Workers and dispatcher in an empty private renderer profile.
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true, timeout: 240000 });
  if (child.error) console.error(child.error);
  process.exit(child.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-domain-workflows-'));
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const inputs = [
  'scripts/run-worldgen-domain-tests.cjs', 'scripts/run-vvd-tests.cjs',
  'tests/worldgen-domain-workflows.entry.ts', 'tests/worldgen-domain-workflows.html',
  'tests/worldgen-domain-measure.browser.ts', 'tests/worldgen-domain-waypoints.browser.ts',
  'tests/worldgen-domain-waypoint-axis.browser.ts',
  'tests/worldgen-era-cache-cleanup.browser.ts', 'src/db/operations.ts',
  'src/engines/worldgen/snapshots.ts', 'src/engines/worldgen/era.ts',
  'src/services/aiBridge/tools/worldgen.ts', 'src/engines/worldgen/core/measure.ts',
  'src/engines/worldgen/core/geoScale.ts', 'src/engines/worldgen/worldDomain.ts',
  'src/engines/worldgen/core/worldDomain.ts', 'src/engines/worldgen/waypointPosition.ts',
  'tests/worldgen-domain-road-boundary.browser.ts', 'src/engines/worldgen/bridgeAccess.ts',
  'src/engines/worldgen/core/edits.ts', 'src/engines/worldgen/core/domainReplay.ts',
  'tests/worldgen-domain-coordinate-families.browser.ts', 'src/engines/worldgen/core/biomeKeys.ts',
];
const hashes = () => inputs.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  let server, win;
  const receipt = { directory, errors: [], blocked: [], workerRequests: [], before: hashes() };
  try {
    let base = process.argv.find(arg => arg.startsWith('--base-url='))?.slice('--base-url='.length) || process.env.WH_TEST_BASE_URL;
    if (!base) {
      const { createServer } = await import('vite');
      server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(directory, 'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: await freePort(), strictPort: true, hmr: false, watch: null } });
      await server.listen();
      base = server.resolvedUrls.local[0];
    }
    const baseUrl = new URL(base);
    await app.whenReady();
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') receipt.errors.push(event.message); });
    win.webContents.on('render-process-gone', (_event, details) => receipt.errors.push(`Renderer exited: ${details.reason}`));
    win.webContents.session.webRequest.onBeforeRequest((details, done) => {
      const url = new URL(details.url);
      const allowed = ['blob:', 'data:'].includes(url.protocol)
        || (['http:', 'ws:'].includes(url.protocol) && url.host === baseUrl.host);
      if (!allowed) receipt.blocked.push(url.origin + url.pathname);
      if (allowed && url.pathname.endsWith('/domain.worker.ts')) receipt.workerRequests.push(url.pathname);
      done({ cancel: !allowed });
    });
    await win.loadURL(new URL('/tests/worldgen-domain-workflows.html', base).href);
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const result = await win.webContents.executeJavaScript('window.__domainWorkflowResult ?? null');
      if (result) {
        receipt.result = result;
        if (!result.ok) throw Error(result.error);
        if (receipt.errors.length || receipt.blocked.length) throw Error('Unexpected renderer errors or external requests');
        if (!receipt.workerRequests.length) throw Error('Actual domain Worker was not requested');
        for (const test of result.tests) console.log(`PASS ${test}`);
        receipt.ok = true;
        return;
      }
      if (receipt.errors.length) throw Error(receipt.errors.join('\n'));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error('Finite domain workflows timed out');
  } catch (error) {
    receipt.ok = false;
    receipt.error = error.stack || String(error);
    throw error;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (server) await server.close();
    receipt.windowDestroyed = !win || win.isDestroyed();
    receipt.after = hashes();
    receipt.sourceStable = JSON.stringify(receipt.before) === JSON.stringify(receipt.after);
    if (!receipt.sourceStable) { receipt.ok = false; receipt.error = 'Test inputs changed during execution'; }
    fs.writeFileSync(path.join(directory, 'RESULT.json'), JSON.stringify(receipt, null, 2));
    console.log(`Finite domain evidence: ${directory}`);
    if (!receipt.sourceStable) throw Error(receipt.error);
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error.stack || error); app.exit(1); });
