const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-graph-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
async function main() {
  const { createServer } = await import('vite'), { default: react } = await import('@vitejs/plugin-react'), { default: tailwind } = await import('@tailwindcss/vite');
  server = await createServer({ configFile: false, root, cacheDir: path.join(temp, 'vite-cache'), resolve: { alias: { '@': path.join(root, 'src') } }, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [react(), tailwind(), { name: 'world-graph-qa', configureServer(instance) {
    instance.middlewares.use('/__world_graph_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_graph_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-graph-preview.tsx"></script></body></html>')); });
  } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1680, height: 1220, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  win.webContents.on('render-process-gone', (_event, detail) => { console.error(detail); app.exit(1); });
  let loadTimer;
  try { await Promise.race([win.loadURL(`${server.resolvedUrls.local[0]}__world_graph_qa`), new Promise((_resolve, reject) => { loadTimer = setTimeout(() => reject(new Error('Isolated graph preview load timeout')), 60000); })]); }
  finally { clearTimeout(loadTimer); }
  for (let attempt = 0; attempt < 400; attempt++) {
    const state = await win.webContents.executeJavaScript('({ready:window.__graphReady,error:window.__graphError,worker:window.__graphWorker,pointers:window.__graphPointerWorker})');
    if (state.error) throw new Error(state.error);
    if (state.ready && state.worker && state.pointers) break;
    if (attempt === 399) throw new Error('Graph/worker preview timeout');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="world-graph-workspace"]\').scrollIntoView({block:"start"}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 350));
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work', 'world-graph-preview.png'), (await win.webContents.capturePage()).toPNG());
  const node = await win.webContents.executeJavaScript('(()=>{const el=document.querySelector(\'[data-testid="world-graph-node-nora"]\'),r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,transform:el.closest(".react-flow__node").style.transform,viewport:document.querySelector(".react-flow__viewport").style.transform}})()');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: node.x, y: node.y });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: node.x, y: node.y, button: 'left', buttons: 1, clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 70));
  // The first movement crosses React Flow's drag threshold; a second movement
  // is the actual drag (the same sequence a physical mouse produces).
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: node.x + 4, y: node.y + 3, button: 'left', buttons: 1 });
  await new Promise(resolve => setTimeout(resolve, 70));
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: node.x + 42, y: node.y + 25, button: 'left', buttons: 1 });
  await new Promise(resolve => setTimeout(resolve, 70));
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: node.x + 42, y: node.y + 25, button: 'left', buttons: 0, clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const layout = await win.webContents.executeJavaScript('window.__readGraphLayout()');
  if (!layout?.positions?.nora || !Number.isFinite(layout.positions.nora.x)) throw new Error('Trusted graph node drag did not persist its manual position');
  const moved = await win.webContents.executeJavaScript('(()=>{const el=document.querySelector(\'[data-testid="world-graph-node-nora"]\'),r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,transform:el.closest(".react-flow__node").style.transform,viewport:document.querySelector(".react-flow__viewport").style.transform}})()');
  if (Math.hypot(moved.x - node.x, moved.y - node.y) < 15) throw new Error(`Trusted graph drag stored a position without visually moving the card: ${JSON.stringify({node,moved,layout})}`);
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="world-graph-node-nora"]\').click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(root, 'work', 'world-graph-card-inspector.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid^="world-graph-connection-mention"]\').click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(root, 'work', 'world-graph-evidence.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(720, 1000);
  await win.webContents.executeJavaScript('window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 500));
  // Fit View fits to the size the graph last measured: wait until the narrow layout has settled.
  { let last = -1, steady = 0; for (let i = 0; i < 50 && steady < 3; i++) { const w = await win.webContents.executeJavaScript('innerWidth<=720?Math.round(document.querySelector(".react-flow")?.getBoundingClientRect().width??-1):-2'); steady = w > 0 && w === last ? steady + 1 : 0; last = w; await new Promise(resolve => setTimeout(resolve, 100)); } }
  await win.webContents.executeJavaScript('document.querySelector(\'button[aria-label="Ajustar a la vista"]\').scrollIntoView({block:"center"});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const pressFit = async () => { const fit = await win.webContents.executeJavaScript('(()=>{const button=document.querySelector(\'button[aria-label="Ajustar a la vista"]\');window.__fitClicks=window.__fitClicks??0;if(!button.dataset.qaCount){button.dataset.qaCount="1";button.addEventListener("click",()=>window.__fitClicks++);}const r=button.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,disabled:button.disabled,hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,500)}})()');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fit.x, y: fit.y });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: fit.x, y: fit.y, button: 'left', buttons: 1, clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 60));
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fit.x, y: fit.y, button: 'left', buttons: 0, clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 300));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); return fit; };
  let fit = await pressFit();
  // Fit View may animate: give it a moment to settle before judging what is in view.
  const measureNarrow = () => win.webContents.executeJavaScript('(()=>{const box=document.querySelector(\'[data-testid="world-graph-canvas"]\').getBoundingClientRect();const cards=[...document.querySelectorAll(\'.react-flow__node [data-testid^="world-graph-node-"]\')];return{total:cards.length,visible:cards.filter(card=>{const r=card.getBoundingClientRect();return r.right>box.left&&r.left<box.right&&r.bottom>box.top&&r.top<box.bottom}).length,overflow:document.documentElement.scrollWidth>innerWidth}})()');
  let narrow = await measureNarrow();
  for (let i = 0; i < 30 && narrow.total && (narrow.visible !== narrow.total || narrow.overflow); i++) { await new Promise(resolve => setTimeout(resolve, 100)); narrow = await measureNarrow(); }
  // Under a loaded machine the graph can still be measuring its new size on the first press; a reader would press again.
  let fitPresses = 1;
  if (narrow.total && (narrow.visible !== narrow.total || narrow.overflow)) { await new Promise(resolve => setTimeout(resolve, 600)); fit = await pressFit(); fitPresses = 2; narrow = await measureNarrow();
    for (let i = 0; i < 30 && narrow.total && (narrow.visible !== narrow.total || narrow.overflow); i++) { await new Promise(resolve => setTimeout(resolve, 100)); narrow = await measureNarrow(); }
  }
  if (!narrow.total || narrow.visible !== narrow.total || narrow.overflow) { const details=await win.webContents.executeJavaScript('({clicks:window.__fitClicks,viewport:document.querySelector(".react-flow__viewport").style.transform,nodes:[...document.querySelectorAll(".react-flow__node")].map(n=>({transform:n.style.transform,visibility:n.style.visibility}))})');fs.writeFileSync(path.join(root, 'work', 'world-graph-fit-failure.png'), (await win.webContents.capturePage()).toPNG()); throw new Error(`Narrow Fit View failed: ${JSON.stringify({ ...narrow, fit, details })}`); }
  if (JSON.stringify(await win.webContents.executeJavaScript('window.__readGraphLayout()')) !== JSON.stringify(layout)) throw new Error('Fit View changed stored manual node positions');
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="world-graph-canvas"]\').scrollIntoView({block:"center"});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(root, 'work', 'world-graph-narrow.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS Real graph worker resolves scoped semantic links/live blocks; trusted drag persists; native narrow Fit View reveals every node without rewriting manual positions (Fit View pressed ' + fitPresses + (fitPresses > 1 ? ' times: the first press came while the graph was still measuring its narrow size' : ' time') + ')');
  console.log(`PASS Graph screenshots: ${path.join(root, 'work', 'world-graph-preview.png')}`);
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
