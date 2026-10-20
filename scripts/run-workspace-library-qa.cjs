const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-library-qa-'));
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'workspace-library-qa', configureServer(instance) { instance.middlewares.use('/__library_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__library_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/workspace-library-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1100, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__library_qa`);
  const wait = async expression => { for (let attempt = 0; attempt < 500; attempt++) { const state = await win.webContents.executeJavaScript(`({ready:!!(${expression}),error:window.__libraryError})`); if (state.error) throw new Error(state.error); if (state.ready) return; await pause(100); } throw new Error(`Timeout: ${expression}`); };
  await wait(`document.querySelector('[data-testid="workspace-primary"] .ProseMirror')`); win.webContents.debugger.attach('1.3');
  const click = async selector => { const target = await win.webContents.executeJavaScript(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing target');element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', buttons: 1, clickCount: 1 }); await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 }); await pause(200); };
  const screenshot = async name => { await win.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))'); await pause(300); const metrics = await win.webContents.executeJavaScript('({width:innerWidth,body:document.body.scrollWidth})'); if (metrics.body > metrics.width + 1) throw new Error(`Viewport overflow ${JSON.stringify(metrics)}`); fs.mkdirSync(path.join(root, 'work'), { recursive: true }); fs.writeFileSync(path.join(root, 'work', name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await click('[data-project-soundtrack] summary');
  await win.webContents.executeJavaScript(`(()=>{const select=document.querySelector('[data-project-soundtrack] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'workspace-library-preview-media');select.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(`document.querySelector('[data-project-soundtrack] audio')?.readyState>=1`);
  if (!await win.webContents.executeJavaScript(`document.querySelector('[data-project-soundtrack] audio').paused`)) throw new Error('Ambience auto-started');
  await screenshot('project-ambience-desktop'); win.setSize(720, 1100); await screenshot('project-ambience-narrow');
  win.setSize(1440, 1100); await click('[data-project-soundtrack] summary'); await click('[data-testid="workspace-library-open"]'); await wait(`document.querySelectorAll('[data-library-document]').length===12`);
  await screenshot('workspace-library-desktop'); win.setSize(720, 1100); await screenshot('workspace-library-narrow');
  win.setSize(1440, 1100); await click('[data-library-folder="coast"]'); await screenshot('workspace-library-folder');
  await click('[data-library-open="beside"]'); await wait(`document.querySelector('[data-testid="workspace-secondary"]')&&!document.querySelector('[data-testid="workspace-library"]')`);
  if (!await win.webContents.executeJavaScript(`!!document.querySelector('[data-testid="workspace-primary"] .ProseMirror')&&!!document.querySelector('[data-project-soundtrack] audio')&&document.querySelector('[data-project-soundtrack] audio').paused`)) throw new Error('Opening library companion lost original writing or audio player');
  await wait(`document.querySelector('[role="dialog"]')?.textContent?.includes('La ciudad conserva sus cartas.')`);
  await screenshot('workspace-library-companion');
  await wait(`document.querySelector('[role="dialog"]')`);
  await click('[role="dialog"] button[aria-label="Cerrar"]');
  await wait(`!document.querySelector('[role="dialog"]')`);
  for (const [width, name] of [[1440, 'desktop'], [720, 'narrow']]) {
    win.setSize(width, 1100); await pause(250);
    if (width === 720) await win.webContents.executeJavaScript(`document.querySelector('[data-testid="workspace-secondary"]').scrollIntoView({block:'start'})`);
    await screenshot(`workspace-current-${name}`);
    fs.mkdirSync(path.join(root, '.impeccable', 'review'), { recursive: true });
    fs.copyFileSync(path.join(root, 'work', `workspace-current-${name}.png`), path.join(root, '.impeccable', 'review', `workspace-${name}.png`));
  }
  console.log('PASS Current-CSS library + local ambience: twelve mixed documents, nested folder, trusted companion opening, retained main editor/player, no autoplay and 1440/720 screenshots');
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
