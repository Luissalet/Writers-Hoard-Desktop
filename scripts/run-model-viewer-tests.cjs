// node scripts/run-model-viewer-tests.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-model-viewer-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  const root = path.resolve(__dirname, '..');
  const { build } = await import('vite');
  const { default: tailwind } = await import('@tailwindcss/vite');
  const styles = await build({ configFile: false, root, plugins: [tailwind()], logLevel: 'error', build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/index.css') } } });
  const css = styles.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
  if (!css) throw new Error('No app CSS produced for model viewer visual QA');
  fs.writeFileSync(path.join(directory, 'test.css'), css.source);
  await esbuild.build({
    stdin: { contents: `import { testModelViewer } from './tests/model-viewer.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT = true; testModelViewer().then(tests => window.__result = {ok:true,tests}).catch(error => window.__result = {ok:false,error:error.stack || String(error)});`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///model-test.js"' }, logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 960, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.session.enableNetworkEmulation({ offline: true });
  await win.loadFile(path.join(directory, 'test.html'));
  const deadline = Date.now() + 120000;
  let result;
  while (Date.now() < deadline) {
    result = await win.webContents.executeJavaScript('window.__result ?? null');
    if (result) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!result?.ok) throw new Error(result?.error ?? 'Model viewer browser suite timed out');
  for (const test of result.tests) console.log(`PASS ${test}`);
  win.setContentSize(1280, 960);
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(directory, 'model-desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(720, 960);
  await new Promise(resolve => setTimeout(resolve, 100));
  const overflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth');
  if (overflow) throw new Error('3D model viewer has horizontal overflow at 720px');
  fs.writeFileSync(path.join(directory, 'model-narrow.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS 3D: offline rendering with current compiled app CSS, desktop and narrow viewport');
  console.log(`Visual QA: ${directory}`);
  app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
