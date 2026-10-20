const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-project-workspace-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'project-workspace-qa', configureServer(instance) {
    instance.middlewares.use('/__project_workspace_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__project_workspace_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/project-workspace-preview.tsx"></script></body></html>')); });
  } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1680, height: 1100, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__project_workspace_qa`);
  for (let attempt = 0; attempt < 400; attempt++) { const state = await win.webContents.executeJavaScript('({ready:!!document.querySelector(\'[data-testid="workspace-primary"] .ProseMirror\'),error:window.__workspaceError})'); if (state.error) throw new Error(state.error); if (state.ready) break; if (attempt === 399) throw new Error('Workspace preview timeout'); await pause(100); }
  await win.webContents.executeJavaScript(`window.__primaryEditor=document.querySelector('[data-testid="workspace-primary"] .ProseMirror').editor;document.querySelector('[data-testid="workspace-open"]').click()`); await pause(450);
  await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('[data-testid="workspace-engine-choice"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(c,'dictionary');c.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(70);
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="workspace-add-tab"]').click()`); await pause(450);
  if (!await win.webContents.executeJavaScript(`document.querySelector('[data-testid="workspace-primary"] .ProseMirror').editor===window.__primaryEditor&&document.querySelectorAll('[role="tab"]').length===2`)) throw new Error('Opening companion tools remounted the main document');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  for (const [width, name] of [[1680, 'desktop'], [1440, 'compact'], [720, 'narrow']]) {
    win.setSize(width, 1100); await pause(250);
    if (width === 720) await win.webContents.executeJavaScript(`document.querySelector('[data-testid="workspace-secondary"]').scrollIntoView({block:'start'})`);
    const metrics = await win.webContents.executeJavaScript(`({width:innerWidth,body:document.body.scrollWidth,main:!!document.querySelector('.app-sidebar'),pane:!!document.querySelector('[data-testid="workspace-secondary"]')})`);
    if (metrics.body > metrics.width + 1 || !metrics.main || !metrics.pane) throw new Error(`Workspace overflow or hidden engine controls: ${JSON.stringify(metrics)}`);
    fs.writeFileSync(path.join(root, 'work', `project-workspace-${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  console.log('PASS Project workspace current CSS: live primary editor preserved, companion tabs, persistent global engine controls and responsive1680/1440/720 screenshots');
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
