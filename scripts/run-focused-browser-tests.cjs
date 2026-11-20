const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Same as run-critical-tests: SwiftShader keeps WebGL available headless, so
// focused tests can mount the real 3D view instead of its 2D fallback.
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// Keep the main process alive until the owned Vite listener has closed.
app.on('window-all-closed', () => {});

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-focused-'));
const profile = path.join(directory, 'profile');
app.setPath('userData', profile);
process.env.WH_USER_DATA_DIR = profile;
const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const harnessPath = '/__focused_browser_test__';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function main() {
  const [file, exported, timeoutArgument] = process.argv.slice(2);
  const timeoutMs = timeoutArgument === undefined ? 60000 : Number(timeoutArgument);
  if (!file || !/^[A-Za-z_$][\w$]*$/.test(exported ?? '') || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Usage: electron scripts/run-focused-browser-tests.cjs tests/file.browser.tsx exportedFunction [timeoutMs:1000..600000]');
  const entry = path.resolve(root, file);
  if (!entry.startsWith(path.join(root, 'tests') + path.sep)) throw new Error('Test file must be inside tests/');
  const entryUrl = '/' + path.relative(root, entry).split(path.sep).map(encodeURIComponent).join('/');

  let phase = 'starting Vite';
  const watchdog = setTimeout(() => {
    console.error(`Focused browser tests timed out after ${timeoutMs} ms while ${phase}`);
    // A stuck startup, navigation or close promise cannot complete cleanup.
    app.exit(1);
  }, timeoutMs);

  let server;
  let win;
  try {
    // Scope the cache to this checkout and fixture because their dependency
    // paths and scan entries can differ even with the same lockfile.
    const cacheKey = createHash('sha256')
      .update(root).update('\0').update(entryUrl).update('\0')
      .update(fs.readFileSync(path.join(root, 'package-lock.json')))
      .digest('hex');
    const cacheDir = path.join(os.tmpdir(), 'wh-focused-vite', cacheKey);

    // Let Vite transform worker URLs/imports and serve public assets over the
    // same HTTP origin as the renderer, as it does for the app.
    const { createServer } = await import('vite');
    server = await createServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      mode: 'test',
      base: '/',
      cacheDir,
      logLevel: 'error',
      // Preserve the focused fixtures' existing renderer environment. Without a
      // mode, the source-tool bootstrap leaves registration to the fixture.
      define: { 'import.meta.env.DEV': 'false', 'import.meta.env.MODE': 'undefined' },
      optimizeDeps: { entries: [entry.replaceAll(path.sep, '/')] },
      server: { host, port: await freePort(), strictPort: true, hmr: false },
      plugins: [{
        name: 'focused-browser-test-page',
        configureServer(devServer) {
          devServer.middlewares.use(harnessPath, (_request, response) => {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
          });
        },
      }],
    });
    await server.listen();
    phase = 'starting Electron';
    await app.whenReady();
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('console-message', details => {
      if (details.level === 'error') console.error(`${details.sourceId}:${details.lineNumber} ${details.message}`);
    });
    let rendererError;
    win.webContents.on('render-process-gone', (_event, details) => {
      rendererError = new Error(`Test renderer exited: ${details.reason} (${details.exitCode})`);
    });
    phase = 'loading the test page';
    const { port } = server.httpServer.address();
    await win.loadURL(`http://${host}:${port}${harnessPath}`);
    phase = 'running the test';
    await win.webContents.executeJavaScript(
      `globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        void import(${JSON.stringify(entryUrl)})
          .then(module => module[${JSON.stringify(exported)}]())
          .then(tests => { window.__result = { ok: true, tests }; })
          .catch(error => { window.__result = { ok: false, error: error.stack || String(error) }; });`,
    );
    while (true) {
      if (rendererError) throw rendererError;
      const result = await win.webContents.executeJavaScript('window.__result ?? null');
      if (result) {
        if (!result.ok) throw new Error(result.error);
        for (const test of Array.isArray(result.tests) ? result.tests : [result.tests]) console.log(`PASS ${test}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally {
    phase = 'closing the test window and Vite';
    try {
      if (win && !win.isDestroyed()) win.destroy();
      await server?.close();
    } finally {
      clearTimeout(watchdog);
    }
  }
}

main().then(() => app.exit(0)).catch(error => { console.error(error.stack || error); app.exit(1); });
