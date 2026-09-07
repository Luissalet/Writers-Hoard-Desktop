const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-focused-'));
app.setPath('userData', path.join(directory, 'profile'));
const root = path.resolve(__dirname, '..');

async function main() {
  const [file, exported, timeoutArgument] = process.argv.slice(2);
  const timeoutMs = timeoutArgument === undefined ? 60000 : Number(timeoutArgument);
  if (!file || !/^[A-Za-z_$][\w$]*$/.test(exported ?? '') || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Usage: electron scripts/run-focused-browser-tests.cjs tests/file.browser.tsx exportedFunction [timeoutMs:1000..600000]');
  const entry = path.resolve(root, file);
  if (!entry.startsWith(path.join(root, 'tests') + path.sep)) throw new Error('Test file must be inside tests/');
  await esbuild.build({
    stdin: {
      contents: `import {${exported} as run} from ${JSON.stringify(entry)}; globalThis.IS_REACT_ACT_ENVIRONMENT = true; run().then(tests => window.__result = {ok:true,tests}).catch(error => window.__result = {ok:false,error:error.stack || String(error)});`,
      resolveDir: root,
    },
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic',
    outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///focused-test.js"' },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(`${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Test renderer exited: ${details.reason} (${details.exitCode})`);
    app.exit(1);
  });
  await win.loadFile(path.join(directory, 'test.html'));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript('window.__result ?? null');
    if (result) {
      if (!result.ok) throw new Error(result.error);
      for (const test of Array.isArray(result.tests) ? result.tests : [result.tests]) console.log(`PASS ${test}`);
      app.exit(0);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Focused browser tests timed out');
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
