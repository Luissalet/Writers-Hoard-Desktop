const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-freehand-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'board-freehand-qa', configureServer(instance) {
    instance.middlewares.use('/__board_freehand_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__board_freehand_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/board-freehand-preview.tsx"></script></body></html>')); });
  } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1680, height: 1100, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  win.webContents.on('render-process-gone', (_event, detail) => { console.error(detail); app.exit(1); });
  await Promise.race([win.loadURL(`${server.resolvedUrls.local[0]}__board_freehand_qa`), pause(60000).then(() => { throw new Error('Board capture page load timed out'); })]);
  for (let attempt = 0; attempt < 400; attempt++) { const state = await win.webContents.executeJavaScript('({ready:window.__boardReady,error:window.__boardError})'); if (state.error) throw new Error(state.error); if (state.ready) break; if (attempt === 399) throw new Error('Board preview timeout'); await pause(100); }
  win.webContents.debugger.attach('1.3');
  const send = args => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', args);
  const rect = await win.webContents.executeJavaScript('(()=>{const r=document.querySelector(\'[data-testid="board-freehand-canvas"]\').getBoundingClientRect();return{x:r.x,y:r.y}})()');
  const draw = async points => {
    await send({ type: 'mouseMoved', x: rect.x + points[0][0], y: rect.y + points[0][1] }); await pause(30);
    await send({ type: 'mousePressed', x: rect.x + points[0][0], y: rect.y + points[0][1], button: 'left', buttons: 1, clickCount: 1 });
    for (const [x, y] of points.slice(1)) { await send({ type: 'mouseMoved', x: rect.x + x, y: rect.y + y, button: 'left', buttons: 1 }); await pause(8); }
    const last = points[points.length - 1]; await send({ type: 'mouseReleased', x: rect.x + last[0], y: rect.y + last[1], button: 'left', buttons: 0, clickCount: 1 }); await pause(450);
  };
  await draw(Array.from({ length: 49 }, (_, i) => [405 + Math.cos(i * Math.PI / 24) * 180, 315 + Math.sin(i * Math.PI / 24) * 125]));
  await draw([[585, 380], [650, 450], [700, 485], [680, 450], [700, 485], [660, 475]]);
  const strokes = await win.webContents.executeJavaScript('window.__readBoardStrokes()');
  if (strokes.length !== 2 || strokes.some(node => !node.freehand?.points.length || node.kind !== 'shape')) { fs.mkdirSync(path.join(root, 'work'), { recursive: true }); fs.writeFileSync(path.join(root, 'work', 'board-freehand-failure.png'), (await win.webContents.capturePage()).toPNG()); throw new Error(`Trusted pointer drawing failed to save both strokes: ${JSON.stringify({strokes,rect})}`); }
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work', 'board-freehand-preview.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="board-freehand-done"]\').click()'); await pause(100);
  const before = [...strokes].sort((a, b) => b.createdAt - a.createdAt)[0], target = await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-testid="board-stroke-${before.id}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send({ type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 }); await pause(50);
  await send({ type: 'mouseMoved', x: target.x + 4, y: target.y + 3, button: 'left', buttons: 1 }); await pause(50);
  await send({ type: 'mouseMoved', x: target.x + 52, y: target.y + 24, button: 'left', buttons: 1 }); await pause(50);
  await send({ type: 'mouseReleased', x: target.x + 52, y: target.y + 24, button: 'left', buttons: 0, clickCount: 1 }); await pause(450);
  const moved = (await win.webContents.executeJavaScript('window.__readBoardStrokes()')).find(node => node.id === before.id);
  if (!moved || moved.position.x === before.position.x) throw new Error('Freehand stroke did not move/persist through the existing node drag flow');
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="board-undo"]\').click()'); await pause(450);
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="board-undo"]\').click()'); await pause(450);
  if ((await win.webContents.executeJavaScript('window.__readBoardStrokes()')).length !== 1) throw new Error('Undo did not remove the completed stroke as one command');
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="board-redo"]\').click()'); await pause(450);
  if ((await win.webContents.executeJavaScript('window.__readBoardStrokes()')).length !== 2) throw new Error('Redo did not recover stroke');
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="board-freehand-toggle"]\').click()'); await pause(80);
  await send({ type: 'mousePressed', x: rect.x + 170, y: rect.y + 520, button: 'left', buttons: 1, clickCount: 1 });
  await send({ type: 'mouseMoved', x: rect.x + 230, y: rect.y + 550, button: 'left', buttons: 1 });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pause(80);
  await send({ type: 'mouseReleased', x: rect.x + 230, y: rect.y + 550, button: 'left', buttons: 0, clickCount: 1 }); await pause(450);
  if ((await win.webContents.executeJavaScript('window.__readBoardStrokes()')).length !== 2 || await win.webContents.executeJavaScript('!!document.querySelector(\'[data-testid="board-freehand-canvas"]\')')) throw new Error('Escape failed to cancel only the unfinished stroke');
  console.log('PASS Trusted Board pencil: two saved vector strokes, existing move flow, whole-stroke undo/redo and Escape cancellation');
  win.setContentSize(720, 1000);
  await win.webContents.executeJavaScript('window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(root, 'work', 'board-freehand-narrow.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`PASS Board screenshot: ${path.join(root, 'work', 'board-freehand-preview.png')}`);
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
