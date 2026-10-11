// Real-CSS layout gate for the "Consultar" panel:  npm run test:reference:ui
//
// Mounts the real WritingsView / BookEditor against the app's compiled
// stylesheet (src/index.css through Tailwind, the same classes the build
// ships) and lets the test resize the window: the renderer asks for a size
// through `window.__setViewport(w, h)` and this process applies it with
// `setContentSize`, so media queries, breakpoints and sticky/fixed positioning
// are the browser's own, not a simulation. A screenshot is saved at each stop.
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-reference-ui-'));
app.setPath('userData', path.join(directory, 'profile'));

async function main() {
  const { compile } = require('@tailwindcss/node');
  const { Scanner } = require('@tailwindcss/oxide');
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] });
  fs.writeFileSync(path.join(directory, 'styles.css'), compiler.build(scanner.scan()));
  await esbuild.build({
    stdin: {
      contents: `import {testReferenceLayout as run} from './tests/reference-layout.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT = true; run().then(tests => window.__result = {ok:true,tests}).catch(error => window.__result = {ok:false,error:error.stack || String(error)});`,
      resolveDir: root,
    },
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', outfile: path.join(directory, 'test.js'),
    alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///reference-ui.js"' },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body class="bg-deep text-text-primary"><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 1280, height: 800, minWidth: 100, minHeight: 100, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') console.error(`${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Test renderer exited: ${details.reason} (${details.exitCode})`);
    app.exit(1);
  });
  await win.loadFile(path.join(directory, 'index.html'));
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({ result: window.__result ?? null, want: window.__want ?? null, shot: window.__shot ?? null })');
    if (state.want) {
      win.setContentSize(state.want.w, state.want.h);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await win.webContents.executeJavaScript(`window.__want = null; window.__sizeAck = ${state.want.n}; 0`);
    }
    if (state.shot) {
      const file = path.join(directory, `${state.shot.name}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      console.log(`SCREENSHOT ${file}`);
      await win.webContents.executeJavaScript(`window.__shot = null; window.__shotDone = ${JSON.stringify(state.shot.name)}; 0`);
    }
    if (state.result) {
      if (!state.result.ok) throw new Error(state.result.error);
      for (const test of state.result.tests) console.log(`PASS ${test}`);
      app.exit(0);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Reference UI test timed out');
}
main().catch((error) => { console.error(error.stack || error); app.exit(1); });
