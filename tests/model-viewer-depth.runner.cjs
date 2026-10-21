const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-model-depth-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  const root = path.resolve(__dirname, '..');
  const { build } = await import('vite');
  const { default: tailwind } = await import('@tailwindcss/vite');
  const result = await build({ configFile: false, root, plugins: [tailwind()], logLevel: 'error', build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/index.css') } } });
  const css = result.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
  if (!css) throw new Error('No current application CSS');
  fs.writeFileSync(path.join(directory, 'test.css'), css.source);
  await esbuild.build({ stdin: { contents: `import {testModelViewerDepth} from './tests/model-viewer-depth.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT=true; testModelViewerDepth().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});`, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///depth-test.js"' }, logLevel: 'warning' });
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.session.enableNetworkEmulation({ offline: true });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  await win.loadFile(path.join(directory, 'test.html'));
  let outcome; const deadline = Date.now() + 120000;
  while (Date.now() < deadline) { outcome = await win.webContents.executeJavaScript('window.__result ?? null'); if (outcome) break; await new Promise(done => setTimeout(done, 50)); }
  if (!outcome?.ok) throw new Error(outcome?.error ?? 'Depth suite timed out');
  for (const test of outcome.tests) console.log(`PASS ${test}`);
  await win.webContents.executeJavaScript('modelDepthShowEditor()');
  for (const [name, width] of [['desktop', 1280], ['narrow', 720]]) {
    win.setContentSize(width, 1000);
    await win.webContents.executeJavaScript('window.scrollTo(0,0)');
    await win.webContents.executeJavaScript('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const layout = await win.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth,ready:document.body.textContent.includes("Model ready"),fly:document.body.textContent.includes("Forward")})');
    if (layout.overflow || !layout.ready || !layout.fly) throw new Error(`Invalid settled ${name} layout: ${JSON.stringify(layout)}`);
    fs.writeFileSync(path.join(directory, `model-depth-${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  console.log(`Visual QA: ${directory}`); app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
