// Run with node. Re-enters through Electron to verify the actual downloaded
// file under file:// with the network disabled, in addition to the UI suite.
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
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-wiki-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  const root = path.resolve(__dirname, '..');
  await esbuild.build({
    stdin: { contents: `import { testWikiExport } from './tests/wiki-export.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT = true; testWikiExport().then(tests => window.__result = {ok:true,tests}).catch(error => window.__result = {ok:false,error:error.stack || String(error)});`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///wiki-test.js"' }, logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadFile(path.join(directory, 'test.html'));
  const deadline = Date.now() + 120000;
  let result;
  while (Date.now() < deadline) {
    result = await win.webContents.executeJavaScript('window.__result ?? null');
    if (result) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!result?.ok) throw new Error(result?.error ?? 'Wiki browser suite timed out');
  for (const test of result.tests) console.log(`PASS ${test}`);
  const html = await win.webContents.executeJavaScript('window.__wikiArtifact');
  const filename = path.join(directory, 'world-wiki.html');
  fs.writeFileSync(filename, html);
  const portable = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: `wiki-offline-${Date.now()}` } });
  portable.webContents.session.enableNetworkEmulation({ offline: true });
  await portable.loadFile(filename);
  const check = await portable.webContents.executeJavaScript(`(() => {
    const search = document.getElementById('search'); search.value = 'malaga guardiana'; search.dispatchEvent(new Event('input'));
    return { protocol: location.protocol, visible: [...document.querySelectorAll('#wiki > article')].filter(article => !article.hidden).length, count: document.getElementById('count').textContent, scripts: document.scripts.length, injected: '__injected' in window, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  if (check.protocol !== 'file:' || check.visible !== 1 || check.count !== '1' || check.scripts !== 1 || check.injected || check.overflow) throw new Error(`Offline file failed: ${JSON.stringify(check)}`);
  console.log('PASS wiki: saved file:// artifact executes search with network disabled and no desktop overflow');
  await portable.webContents.executeJavaScript("document.getElementById('search').value = ''; document.getElementById('search').dispatchEvent(new Event('input'));");
  fs.writeFileSync(path.join(directory, 'wiki-desktop.png'), (await portable.webContents.capturePage()).toPNG());
  portable.setContentSize(620, 850);
  const narrowOverflow = await portable.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth');
  if (narrowOverflow) throw new Error('Wiki overflows the narrow viewport');
  fs.writeFileSync(path.join(directory, 'wiki-narrow.png'), (await portable.webContents.capturePage()).toPNG());
  console.log('PASS wiki: narrow viewport without horizontal overflow');
  console.log(`Visual QA: ${directory}`);
  app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
