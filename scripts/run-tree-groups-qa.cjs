// Relationship trees: a person put in a new group from the node inspector, the
// group renamed and coloured, a second member; relationship names shown only on
// hover; a free node turned into a Codex card; saved, reopened and exported, and
// the same through wh_relation_tree_action. Isolated hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-tree-groups-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'tree-groups-qa', configureServer(instance) { instance.middlewares.use('/__tree_groups_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__tree_groups_qa', '<!doctype html><html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><body><div id="root"></div><script type="module" src="/tests/tree-groups-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1060, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__tree_groups_qa`);
  let stage = 'start';
  const js = async expression => { const out = await win.webContents.executeJavaScript(`(async()=>{try{return {v:await (${expression})};}catch(e){return {e:String(e&&e.stack||e)};}})()`); if (out && out.e) throw Error(`[${stage}] ${out.e}`); return out?.v; };
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__tgError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const q = id => `document.querySelector('[data-testid="${id}"]')`;
  const choose = (selector, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const typeIn = (selector, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const label = { ada: 'Ada del Estuario', blai: 'Blai del Bosque', noa: 'Noa del Estuario' };
  const pick = async id => { await js(`document.querySelector('.react-flow__node[data-id="${id}"]').click()`); await pause(250); await wait(`${q('tree-node-group')} && [...document.querySelectorAll('input[aria-label$=" · Inspector"]')].some(i=>i.value===${JSON.stringify(label[id])})`, `inspector for ${id}`); };
  const button = text => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button ${text}');b.click();})()`);
  const tests = [];
  await wait('window.__tgReady && document.querySelector(\'select[aria-label="Documento"] option[value="tree-groups-family"]\')', 'preview');
  await choose('select[aria-label="Documento"]', 'tree-groups-family');
  await wait('document.querySelector(\'.react-flow__node[data-id="ada"]\')', 'tree drawn');
  await pause(600);
  // Ada into a new group, renamed and coloured; Noa joins it.
  await pick('ada');
  await choose('[data-testid="tree-node-group"]', '__new');
  await wait(q('tree-group-editor'), 'group editor');
  await typeIn('[data-testid="tree-group-name"]', 'Casa del Estuario');
  await pause(150);
  await js(`${q('tree-group-color-3d85c6')}.click()`);
  await pause(150);
  const groupId = await js(`${q('tree-node-group')}.value`);
  await pick('noa');
  await choose('[data-testid="tree-node-group"]', groupId);
  await wait(`document.querySelector('[data-testid="tree-group-box"]')?.textContent==='Casa del Estuario'`, 'group box drawn');
  const box = await js(`(()=>{const b=document.querySelector('[data-testid="tree-group-box"]').getBoundingClientRect(),a=document.querySelector('.react-flow__node[data-id="ada"]').getBoundingClientRect(),n=document.querySelector('.react-flow__node[data-id="noa"]').getBoundingClientRect(),o=document.querySelector('.react-flow__node[data-id="blai"]').getBoundingClientRect();const inside=r=>r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom;return {ada:inside(a),noa:inside(n),blai:inside(o),color:getComputedStyle(document.querySelector('[data-testid="tree-group-box"]')).borderTopColor};})()`);
  assert(box.ada && box.noa && !box.blai && box.color === 'rgb(61, 133, 198)', `Group box round its members: ${JSON.stringify(box)}`);
  // Names only on hover.
  const before = await js(`[...document.querySelectorAll('[data-testid="tree-edge-label"]')].map(e=>e.textContent).sort().join('|')`);
  assert(before === 'Antigua alianza|Primogénita', `Names shown by default: ${before}`);
  await choose('[data-testid="tree-label-mode"]', 'hover');
  await wait(`!document.querySelector('[data-testid="tree-edge-label"]')`, 'names hidden until hover');
  // A free node becomes a card.
  await pick('blai');
  await js(`${q('tree-node-create-card')}.click()`);
  await wait(`!${q('tree-node-create-card')}`, 'card created');
  fs.writeFileSync(path.join(evidence, 'tree-groups.png'), (await win.webContents.capturePage()).toPNG());
  await button('Guardar árbol');
  let saved; for (let i = 0; i < 60; i++) { saved = await js('window.__readTree()'); if (saved.revision > 1) break; await pause(150); }
  const group = saved.groups?.[0], blai = saved.nodes.find(n => n.id === 'blai');
  assert(group?.name === 'Casa del Estuario' && group.color === '#3d85c6' && group.nodeIds.join() === 'ada,noa' && saved.labelMode === 'hover' && blai.codexEntryId, `Saved: ${JSON.stringify({ groups: saved.groups, labelMode: saved.labelMode, blai })}`);
  const card = await js(`(async()=>{const {db}=await import('/src/db/index.ts');return db.codexEntries.get(${JSON.stringify(blai.codexEntryId)});})()`);
  assert(card?.title === 'Blai del Bosque' && card.type === 'character', `Card: ${JSON.stringify(card)}`);
  tests.push('Tree editor: Ada goes into a new group from her inspector, renamed "Casa del Estuario" and coloured blue, Noa joins it, and a tinted box with the name is drawn round both (not round Blai); "Nombres de relación: Al pasar el ratón" hides the relationship names; "Crear ficha del Codex" turns the free node "Blai del Bosque" into a character card linked to it; all saved with the tree (tree-groups.png)');
  // Export and the bridge.
  const out = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const P='tree-groups-preview',T='tree-groups-family';
    const svg=(await runBridgeTool('wh_relation_tree_export',{projectId:P,treeId:T})).result.svg;
    const get=async()=>(await runBridgeTool('wh_relation_tree_get',{projectId:P,treeId:T})).result.tree;
    let t=await get();const bad=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'group-set',groupName:'Casa del Bosque',groupColor:'green',nodeIds:['blai']});
    const made=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'group-set',groupName:'Casa del Bosque',groupColor:'#6aa84f',nodeIds:['blai','noa']});
    t=await get();const shown=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'label-mode',labelMode:'hidden'});
    t=await get();const hiddenSvg=(await runBridgeTool('wh_relation_tree_export',{projectId:P,treeId:T})).result.svg;
    const free=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'node-card',nodeId:'blai'});
    const bosque=t.groups.find(g=>g.name==='Casa del Bosque');const removed=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'group-remove',groupId:bosque.id});
    t=await get();
    return {svg,hiddenSvg,bad:bad.ok?null:bad.error,made:made.ok,shown:shown.ok,free:free.ok?null:free.error,removed:removed.ok,groups:t.groups.map(g=>g.name+':'+g.nodeIds.join('+')),labelMode:t.labelMode,beforeRemove:null};})()`);
  assert(/Casa del Estuario/.test(out.svg) && /stroke="#3d85c6"/.test(out.svg) && /<title>Antigua alianza<\/title>/.test(out.svg) && !/>Antigua alianza<\/text>/.test(out.svg), 'Export: the group box and hover names as tooltips');
  assert(!/Antigua alianza/.test(out.hiddenSvg), 'Export with hidden names leaves them out');
  assert(/#rrggbb/.test(out.bad ?? '') && out.made && out.shown && /already linked/.test(out.free ?? '') && out.removed && out.groups.join() === 'Casa del Estuario:ada' && out.labelMode === 'hidden', `Bridge: ${JSON.stringify({ ...out, svg: undefined, hiddenSvg: undefined })}`);
  tests.push('Export: the group is a tinted box with its name and its members\' cards edged in its colour; "on hover" names become the line\'s tooltip and "hidden" leaves them out. Bridge: wh_relation_tree_action group-set (a bad colour refused; Noa moves to the new group, leaving her old one), label-mode, node-card (refused for a linked node) and group-remove');
  // Reopen.
  stage = 'reload'; win.webContents.reload(); await pause(500);
  await wait('window.__tgReady && document.querySelector(\'select[aria-label="Documento"] option[value="tree-groups-family"]\')', 'reloaded');
  await choose('select[aria-label="Documento"]', 'tree-groups-family');
  await wait(`document.querySelector('[data-testid="tree-group-box"]')?.textContent==='Casa del Estuario' && ${q('tree-label-mode')}?.value==='hidden'`, 'reopened with group and mode');
  fs.writeFileSync(path.join(evidence, 'tree-groups-reopened.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Reopened: the group box and the label mode are as saved (tree-groups-reopened.png)');
  // A variant: the two trees show as tabs over the editor.
  stage = 'variant';
  await button('Crear variante');
  await wait(`document.querySelectorAll('[data-testid="tree-variant-tabs"] [role="tab"]').length === 2`, 'variant tabs');
  const tabs = await js(`[...document.querySelectorAll('[data-testid="tree-variant-tabs"] [role="tab"]')].map(t=>t.textContent+(t.getAttribute('aria-selected')==='true'?'*':''))`);
  assert(tabs[0] === 'Las dos casas' && /variante\*$/.test(tabs[1]), `Tabs: ${tabs.join(' | ')}`);
  await wait(`document.querySelector('.react-flow__node[data-id="ada"]')`, 'variant drawn');
  await pause(600);
  // Shift+drag a box round Ada and Noa (not Blai), then remove both.
  stage = 'shift-drag';
  win.webContents.debugger.attach('1.3');
  const send = (method, params) => win.webContents.debugger.sendCommand(method, params);
  const rect = id => js(`(()=>{const r=document.querySelector('.react-flow__node[data-id="${id}"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
  const ada = await rect('ada'), noa = await rect('noa');
  const from = { x: Math.round(Math.min(ada.x, noa.x) - 20), y: Math.round(ada.y - 20) }, to = { x: Math.round(Math.max(ada.x + ada.w, noa.x + noa.w) + 20), y: Math.round(noa.y + noa.h + 20) };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
  for (let i = 1; i <= 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (to.x - from.x) * i / 12), y: Math.round(from.y + (to.y - from.y) * i / 12), button: 'left', buttons: 1, modifiers: 8 }); await pause(30); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await wait(`/Quitar 2/.test(${q('tree-delete-selection')}?.textContent ?? '')`, 'two selected');
  fs.writeFileSync(path.join(evidence, 'tree-multi-select.png'), (await win.webContents.capturePage()).toPNG());
  await js(`${q('tree-delete-selection')}.click()`);
  await pause(200);
  await wait(`document.querySelector('[role="dialog"]')`, 'confirm dialog');
  // The dialog's confirm button is its last one (after Cancel).
  await js(`[...document.querySelectorAll('[role="dialog"] button')].filter(b=>!b.getAttribute('aria-label')).pop().click()`);
  await wait(`!document.querySelector('.react-flow__node[data-id="ada"]') && !document.querySelector('.react-flow__node[data-id="noa"]') && document.querySelector('.react-flow__node[data-id="blai"]')`, 'two removed');
  tests.push('Variants and selection: "Crear variante" puts "Las dos casas" and its variant as tabs over the editor; in the variant, Shift+drag round Ada and Noa shows "Quitar 2", which removes both (Blai stays) (tree-multi-select.png)');
  stage = 'bridge nodes-remove';
  const removed = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const P='tree-groups-preview',T='tree-groups-family';
    const t=(await runBridgeTool('wh_relation_tree_get',{projectId:P,treeId:T})).result.tree;
    const r=await runBridgeTool('wh_relation_tree_action',{projectId:P,treeId:T,expectedRevision:t.revision,action:'nodes-remove',nodeIds:['blai','noa']});
    const after=(await runBridgeTool('wh_relation_tree_get',{projectId:P,treeId:T})).result.tree;
    return {ok:r.ok,error:r.error,nodes:after.nodes.map(n=>n.id),edges:after.edges.length};})()`);
  assert(removed.ok && removed.nodes.join() === 'ada' && removed.edges === 0, `Bridge nodes-remove: ${JSON.stringify(removed)}`);
  tests.push('Bridge: wh_relation_tree_action nodes-remove takes Blai and Noa out of the original tree at once, with their relationships');
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
