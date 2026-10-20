const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-conversation-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'conversation-preview-qa', configureServer(instance) {
    instance.middlewares.use('/__conversation_preview_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__conversation_preview_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/conversation-preview-fixture.tsx"></script></body></html>')); });
  } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1100, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__conversation_preview_qa`);
  for (let attempt = 0; attempt < 400; attempt++) { const state = await win.webContents.executeJavaScript('({ready:!!document.querySelector(\'[data-testid="conversation-open"]:not(:disabled)\'),error:window.__conversationError})'); if (state.error) throw new Error(state.error); if (state.ready) break; if (attempt === 399) throw new Error('Conversation scene preview timeout'); await pause(100); }
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="conversation-open"]').click()`);
  for (let attempt = 0; attempt < 200; attempt++) { if (await win.webContents.executeJavaScript(`!!document.querySelector('[data-testid="conversation-next"]')`)) break; await pause(100); if (attempt === 199) throw new Error('Conversation modal preview timeout'); }
  win.webContents.debugger.attach('1.3');
  const trustedClick = async selector => {
    const target = await win.webContents.executeJavaScript(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', buttons: 1, clickCount: 1 }); await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 }); await pause(80);
  };
  for (let i = 0; i < 5; i++) await trustedClick('[data-testid="conversation-next"]');
  if (!await win.webContents.executeJavaScript(`document.querySelector('[data-testid="conversation-count"]').textContent.includes('5/6')&&!!document.querySelector('[data-testid="conversation-turn-promise-a"]')`)) throw new Error('Trusted conversation stepping or simultaneous reveal failed');
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))'); await pause(500);
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work', 'conversation-preview-phone.png'), (await win.webContents.capturePage()).toPNG());
  await trustedClick('[data-testid="conversation-phone"]');
  await pause(250);
  fs.writeFileSync(path.join(root, 'work', 'conversation-preview-wide.png'), (await win.webContents.capturePage()).toPNG());
  await trustedClick('[data-testid="conversation-phone"]'); win.setSize(720, 1100); await pause(220);
  fs.writeFileSync(path.join(root, 'work', 'conversation-preview-narrow.png'), (await win.webContents.capturePage()).toPNG());
  const metrics = await win.webContents.executeJavaScript('({width:innerWidth,body:document.body.scrollWidth})'); if (metrics.body > metrics.width + 1) throw new Error('Conversation preview overflows the viewport');
  console.log('PASS Trusted conversation preview: scene open, five authored steps, simultaneous dialogue and phone/wide/narrow current-CSS screenshots');
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
