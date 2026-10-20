const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-radar-qa-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  const { build } = await import('vite'), { default: tailwind } = await import('@tailwindcss/vite');
  const styles = await build({ configFile: false, root, plugins: [tailwind()], logLevel: 'error', build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/index.css') } } });
  const css = styles.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css')); if (!css) throw new Error('No compiled CSS'); fs.writeFileSync(path.join(directory, 'preview.css'), css.source);
  await esbuild.build({ entryPoints: [path.join(root, 'tests/radar-preview.tsx')], bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', outfile: path.join(directory, 'preview.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///radar-preview.js"' }, logLevel: 'warning' });
  fs.writeFileSync(path.join(directory, 'preview.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="preview.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>');
  await app.whenReady(); const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } }); win.webContents.session.enableNetworkEmulation({ offline: true }); await win.loadFile(path.join(directory, 'preview.html'));
  const end = Date.now() + 30000; while (Date.now() < end) { const state = await win.webContents.executeJavaScript('({ready:window.__previewReady,error:window.__previewError,loaded:!!document.querySelector(\'[aria-label="Nombre del gráfico"]\')})'); if (state.error) throw new Error(state.error); if (state.ready && state.loaded) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  const shot = async name => { await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await new Promise(resolve => setTimeout(resolve, 100)); if (await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')) throw new Error(`Horizontal overflow ${name}`); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await shot('radar-series-desktop'); await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(n=>n.textContent==="Ejes y escalas").click()'); await shot('radar-axes-desktop');
  win.setContentSize(720, 960); await shot('radar-narrow');
  console.log(`PASS offline current-CSS radar desktop/narrow overflow and screenshots: ${directory}`); app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
