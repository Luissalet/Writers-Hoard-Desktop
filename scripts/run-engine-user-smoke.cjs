const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'writers-hoard-engines-'));
// Set before app ready: this harness must never open the author's profile.
app.setPath('userData', path.join(directory, 'profile'));
const root = path.resolve(__dirname, '..');

async function main() {
  await esbuild.build({
    stdin: {
      contents: `import {testEngineUserSmoke} from './tests/engine-user-smoke.browser.tsx';
        testEngineUserSmoke().then(tests => window.__engineSmokeResult = {ok:true, tests})
          .catch(error => window.__engineSmokeResult = {ok:false, error:error.stack || String(error)});`,
      resolveDir: root,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    target: 'chrome130',
    outfile: path.join(directory, 'smoke.js'),
    alias: { '@': path.join(root, 'src') },
    loader: { '.css': 'empty' },
    define: {
      'process.env.NODE_ENV': '"test"',
      'import.meta.env': '{"DEV":false,"BASE_URL":"/"}',
      'import.meta.url': '"file:///engine-smoke.js"',
    },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'smoke.html'), `<!doctype html><html>
    <head><meta charset="utf-8"><title>Engine render smoke</title></head><body>
    <script>
      window.addEventListener('error', e => window.__engineSmokeResult = {ok:false,error:e.error?.stack || e.message});
      window.addEventListener('unhandledrejection', e => window.__engineSmokeResult = {ok:false,error:e.reason?.stack || String(e.reason)});
      // Test mounting and lifecycle only. Vite owns the real Worker assets;
      // terrain computation has separate Worldgen and startup regressions.
      window.Worker = class { onmessage=null; onerror=null; postMessage(){} terminate(){} };
    </script><script src="smoke.js"></script></body></html>`, 'utf8');

  const win = new BrowserWindow({
    show: false, width: 1280, height: 960,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await win.loadFile(path.join(directory, 'smoke.html'));
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript('window.__engineSmokeResult ?? null');
    if (result) {
      fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(result, null, 2), 'utf8');
      if (!result.ok) throw new Error(result.error || 'Engine render smoke failed');
      for (const line of result.tests) console.log(`PASS ${line}`);
      console.log(`\n${result.tests.length} engines mounted; isolated report: ${path.join(directory, 'results.json')}`);
      console.log('Scope: empty/default UI rendering and lifecycle; workers are dormant, no generation or AI execution.');
      app.exit(0);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Engine render smoke timed out');
}

app.whenReady().then(main).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
