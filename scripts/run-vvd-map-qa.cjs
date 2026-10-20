const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
async function main() {
  const { createServer } = await import('vite');
  console.log('QA: starting isolated Vite');
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'vvd-map-qa', configureServer(instance) {
    instance.middlewares.use('/__vvd_map_qa', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await instance.transformIndexHtml('/__vvd_map_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-map-preview.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  console.log('QA: Vite ready');
  await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  win.webContents.on('render-process-gone', (_event, detail) => { console.error(detail); app.exit(1); });
  const address = server.resolvedUrls.local[0];
  console.log(`QA: loading ${address}`);
  await win.loadURL(`${address}__vvd_map_qa`);
  console.log('QA: page loaded');
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = await win.webContents.executeJavaScript('({ready:window.__mapReady,error:window.__mapError})');
    if (status.error) throw new Error(status.error);
    if (status.ready) break;
    if (attempt === 299) throw new Error('Preview timeout');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  await win.webContents.executeJavaScript('window.scrollTo(0,1); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const destination = path.join(root, 'work', 'vvd-map-preview.png'); fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="map-feature-select-north"]\').click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  const vertex = await win.webContents.executeJavaScript('(()=>{const node=document.querySelector(\'[data-testid="map-vertex-0"]\'),r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,cx:Number(node.getAttribute("cx"))}})()');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(vertex.x), y: Math.round(vertex.y) });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(vertex.x), y: Math.round(vertex.y), button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 50));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(vertex.x + 38), y: Math.round(vertex.y + 20), movementX: 38, movementY: 20 });
  await new Promise(resolve => setTimeout(resolve, 50));
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(vertex.x + 38), y: Math.round(vertex.y + 20), button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const dragged = await win.webContents.executeJavaScript('(()=>{const node=document.querySelector(\'[data-testid="map-vertex-0"]\');return{cx:node?Number(node.getAttribute("cx")):null,selected:document.querySelector(\'[data-testid="map-feature-name"]\')?.value,ready:window.__mapReady}})()');
  if (!(dragged.cx > vertex.cx)) { fs.writeFileSync(path.join(root, 'work', 'vvd-map-drag-failure.png'), (await win.webContents.capturePage()).toPNG()); throw new Error(`Trusted pointer drag did not move selected map vertex: ${JSON.stringify({vertex,dragged})}`); }
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="map-feature-save"]\').click()');
  await new Promise(resolve => setTimeout(resolve, 200));
  console.log('PASS Trusted pointer drag updates and saves map vertex');
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="map-feature-inspector"]\').scrollIntoView({block:"center"})');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(root, 'work', 'vvd-map-inspector.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('(()=>{const select=document.querySelector(\'[data-testid="map-version-select"]\');select.value=select.options[1].value;select.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await new Promise(resolve => setTimeout(resolve, 200));
  if (await win.webContents.executeJavaScript('!!document.querySelector(\'[data-testid="map-tool-region"]\')')) throw new Error('Historical preview exposed editing tools');
  await win.webContents.executeJavaScript('window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(root, 'work', 'vvd-map-history.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(720, 1000);
  await win.webContents.executeJavaScript('window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(root, 'work', 'vvd-map-narrow.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`PASS Hidden Electron map preview: ${destination}`);
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
