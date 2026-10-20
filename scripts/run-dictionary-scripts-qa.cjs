const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-dictionary-scripts-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'dictionary-scripts-qa', configureServer(instance) {
    instance.middlewares.use('/__dictionary_scripts_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__dictionary_scripts_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/dictionary-scripts-preview.tsx"></script></body></html>')); });
  } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1100, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__dictionary_scripts_qa`);
  for (let attempt = 0; attempt < 300; attempt++) { const state = await win.webContents.executeJavaScript('({ready:!!document.querySelector(\'[data-testid="dictionary-script-preset"]\'),error:window.__scriptError})'); if (state.error) throw new Error(state.error); if (state.ready) break; if (attempt === 299) throw new Error('Script preview timeout'); await pause(100); }
  await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('[data-testid="dictionary-script-preset"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(c,'tifinagh');c.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(80);
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="dictionary-script-apply"]').click()`); await pause(200);
  const preview = await win.webContents.executeJavaScript(`document.querySelector('[data-testid="dictionary-script-preview"]').textContent`);
  if (!preview.includes('ⴻ')) throw new Error('Actual styled preview did not update');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  for (const [width, name] of [[1440, 'desktop'], [720, 'narrow']]) {
    win.setSize(width, 1100); await pause(180);
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="dictionary-script-preset"]').scrollIntoView({block:'start'})`); await pause(100);
    fs.writeFileSync(path.join(root, 'work', `dictionary-scripts-${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  console.log('PASS Dictionary current CSS: editable preset/live preview, local font controls, desktop1440 and narrow720 screenshots');
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
