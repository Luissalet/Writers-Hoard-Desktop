// Board: one click on a side of a selected idea makes a new idea like it there,
// joined to it — right, then below the new one; kept after reopening; and the
// same through wh_board_canvas_action quick-connect. Isolated hidden profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-board-quick-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'board-quick-qa', configureServer(instance) { instance.middlewares.use('/__board_quick_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__board_quick_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/board-quick-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__board_quick_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__bqError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  win.webContents.debugger.attach('1.3');
  const send = args => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', args);
  const clickAt = async (x, y) => { await send({ type: 'mouseMoved', x, y }); await pause(40); await send({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await pause(40); await send({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await pause(350); };
  const centre = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const tests = [];
  await wait('window.__bqReady && document.querySelector(\'.react-flow__node[data-id="bq-origin"]\')', 'board');
  await pause(800);
  let p = await centre('.react-flow__node[data-id="bq-origin"]');
  await clickAt(p.x, p.y);
  await wait(`document.querySelector('[data-testid="board-quick-right"]')`, 'side buttons on the selected idea');
  fs.writeFileSync(path.join(evidence, 'board-quick-sides.png'), (await win.webContents.capturePage()).toPNG());
  p = await centre('[data-testid="board-quick-right"]');
  await clickAt(p.x, p.y);
  let board; for (let i = 0; i < 60; i++) { board = await js('window.__readBoard()'); if (board.nodes.length === 2) break; await pause(150); }
  const origin = board.nodes.find(n => n.id === 'bq-origin'), first = board.nodes.find(n => n.id !== 'bq-origin');
  assert(first && first.kind === 'shape' && first.shape === 'hexagon' && first.color === '#3d85c6' && first.position.x >= origin.position.x + origin.size.width + 40 && Math.abs(first.position.y - origin.position.y) < 1, `A hexagon to the right: ${JSON.stringify(first)}`);
  const edge = board.edges[0];
  assert(board.edges.length === 1 && edge.sources[0].id === 'bq-origin' && edge.sources[0].side === 'right' && edge.targets[0].id === first.id && edge.targets[0].side === 'left', `Joined right to left: ${JSON.stringify(board.edges)}`);
  // The new idea is selected: its own side buttons, below.
  await wait(`document.querySelector('.react-flow__node[data-id="${first.id}"].selected') && document.querySelector('[data-testid="board-quick-bottom"]')`, 'new idea selected');
  p = await centre('[data-testid="board-quick-bottom"]');
  await clickAt(p.x, p.y);
  for (let i = 0; i < 60; i++) { board = await js('window.__readBoard()'); if (board.nodes.length === 3) break; await pause(150); }
  const second = board.nodes.find(n => n.id !== 'bq-origin' && n.id !== first.id);
  assert(second && second.position.y >= first.position.y + first.size.height + 40 && Math.abs(second.position.x - first.position.x) < 1 && board.edges.length === 2, `Below the new one: ${JSON.stringify(second)}`);
  fs.writeFileSync(path.join(evidence, 'board-quick-made.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Board: a selected hexagon shows a + on each side; the right one makes a hexagon of the same colour and size to its right, joined right-to-left, and selects it; its + below makes a third one under it (board-quick-sides.png, board-quick-made.png)');
  await js('location.reload()');
  await pause(1500);
  try {
    await wait('window.__bqReady && document.querySelectorAll(".react-flow__node").length === 3 && document.querySelectorAll("[data-board-edge-id]").length === 2', 'reopened with the three ideas and two links', 200);
  } catch (error) {
    const seen = await js('({nodes:document.querySelectorAll(".react-flow__node").length,edges:document.querySelectorAll("[data-board-edge-id]").length,paths:document.querySelectorAll(".react-flow__edge-path, .react-flow__edges path").length,ids:[...document.querySelectorAll(".react-flow__node")].map(n=>n.dataset.id)})');
    const stored = await js('window.__readBoard().then(b=>({nodes:b.nodes.length,edges:b.edges.length}))');
    throw Error(`${error.message}: ${JSON.stringify({ seen, stored })}`);
  }
  fs.writeFileSync(path.join(evidence, 'board-quick-reopened.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Reopened: the three ideas and the two links are there');
  const out = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const a={projectId:'board-quick-preview',boardId:'board-quick-preview-board'};
    const bad=await runBridgeTool('wh_board_canvas_action',{...a,action:'quick-connect',nodeId:'bq-origin',side:'diagonal'});
    const made=await runBridgeTool('wh_board_canvas_action',{...a,action:'quick-connect',nodeId:'bq-origin',side:'top',title:'El tesorero'});
    const got=(await runBridgeTool('wh_board_canvas_get',a)).result;const added=got.nodes.find(n=>n.title==='El tesorero');const origin=got.nodes.find(n=>n.id==='bq-origin');
    const undo=await runBridgeTool('wh_board_canvas_undo',{projectId:a.projectId,receiptId:made.result.receiptId});const after=(await runBridgeTool('wh_board_canvas_get',a)).result;
    return {bad:bad.ok?null:bad.error,made:made.ok,above:!!added&&added.position.y+added.size.height<=origin.position.y-40,linked:got.edges.some(e=>e.targets[0].id===added?.id&&e.sources[0].side==='top'),undone:undo.ok&&!after.nodes.some(n=>n.title==='El tesorero')};})()`);
  assert(/top, right, bottom or left/.test(out.bad ?? '') && out.made && out.above && out.linked && out.undone, `Bridge: ${JSON.stringify(out)}`);
  tests.push('Bridge: wh_board_canvas_action quick-connect puts "El tesorero" above the hexagon, joined from its top (an unknown side is refused), and wh_board_canvas_undo takes it away');
  // Outlines: dashed and sketched, drawn on the canvas.
  const outline = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const a={projectId:'board-quick-preview',boardId:'board-quick-preview-board'};
    const bad=await runBridgeTool('wh_board_canvas_action',{...a,action:'border',nodeId:'bq-origin',border:'wavy'});
    const ok=await runBridgeTool('wh_board_canvas_action',{...a,action:'border',nodeId:'bq-origin',border:'sketch'});
    const got=(await runBridgeTool('wh_board_canvas_get',a)).result;return {bad:bad.ok?null:bad.error,ok:ok.ok,border:got.nodes.find(n=>n.id==='bq-origin').border};})()`);
  assert(/solid, dashed or sketch/.test(outline.bad ?? '') && outline.ok && outline.border === 'sketch', `Border via bridge: ${JSON.stringify(outline)}`);
  await wait(`document.querySelector('.react-flow__node[data-id="bq-origin"] [data-board-border="sketch"] filter feDisplacementMap')`, 'sketched outline drawn');
  fs.writeFileSync(path.join(evidence, 'board-sketch-border.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Outline: wh_board_canvas_action border sets the hexagon to "sketch" (an unknown outline refused) and the canvas draws it hand-traced with a displacement filter (board-sketch-border.png)');
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
