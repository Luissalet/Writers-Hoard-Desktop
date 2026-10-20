const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rpg-qa-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  const { build } = await import('vite'), { default: tailwind } = await import('@tailwindcss/vite');
  const styles = await build({ configFile: false, root, plugins: [tailwind()], logLevel: 'error', build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/index.css') } } });
  const css = styles.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css')); if (!css) throw new Error('No compiled CSS');
  fs.writeFileSync(path.join(directory, 'preview.css'), css.source);
  await esbuild.build({ entryPoints: [path.join(root, 'tests/rpg-sheets-preview.tsx')], bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', outfile: path.join(directory, 'preview.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///rpg-preview.js"' }, logLevel: 'warning' });
  fs.writeFileSync(path.join(directory, 'preview.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="preview.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>');
  await app.whenReady(); const win = new BrowserWindow({ show: false, width: 1280, height: 960, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.session.enableNetworkEmulation({ offline: true }); await win.loadFile(path.join(directory, 'preview.html'));
  const end = Date.now() + 30000; while (Date.now() < end) { const state = await win.webContents.executeJavaScript('({ready:window.__previewReady,error:window.__previewError,loaded:!!document.querySelector(\'[aria-label="Nombre"]\')})'); if (state.error) throw new Error(state.error); if (state.ready && state.loaded) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  const shot = async name => { await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await new Promise(resolve => setTimeout(resolve, 100)); if (await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Horizontal overflow ${name}`); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await shot('rpg-stats-desktop');
  await win.webContents.executeJavaScript('[...document.querySelectorAll(\'[role="tab"]\')].find(n=>n.textContent==="Recursos").click()'); await shot('rpg-resources-desktop');
  win.setContentSize(720, 960); await shot('rpg-resources-narrow');
  await win.webContents.executeJavaScript('[...document.querySelectorAll(\'[role="tab"]\')].find(n=>n.textContent==="Dados e historial").click()'); await shot('rpg-dice-narrow');
  console.log(`PASS offline current-CSS RPG desktop/narrow overflow and screenshots: ${directory}`); app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
