// Painted labels through the normal tools: place one with Point → Label, pick it
// with the Labels tool, turn it with its handle, set exact values, reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-labels-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server, win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-labels-qa', configureServer(instance) { instance.middlewares.use('/__world_labels_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_labels_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_labels_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const row = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const r=await db.generatedWorlds.get('${W}');return deserializeEdits(r.edits).filter(e=>e.kind==='label'||e.kind==='relabel');})()`);
  const send = event => win.webContents.sendInputEvent(event);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(400); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  // Place a label through the normal Point tool.
  await click('Pincel'); await click('Colocar'); await click('Rótulo');
  const nameInput = `[...document.querySelectorAll('input')].find(i=>i.placeholder==='Escribe el nombre…')`;
  await wait(nameInput, 'label text input');
  await js(`(()=>{const i=${nameInput};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Mar de las Brumas');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const rect = await canvasRect();
  const at = { x: Math.round(rect.x + rect.w * 0.5), y: Math.round(rect.y + rect.h * 0.45) };
  await tap(at.x, at.y);
  let edits; for (let i = 0; i < 60; i++) { edits = await row(); if (edits.some(e => e.kind === 'label')) break; await pause(150); }
  const placed = edits.find(e => e.kind === 'label');
  assert(placed && placed.text === 'Mar de las Brumas', `Label not placed: ${JSON.stringify(edits)}`);
  tests.push(`Point → Rótulo places "${placed.text}" at ${placed.x},${placed.y} with a trusted click`);
  // Labels tool: pick it with a trusted click; the inspector opens with its values.
  await click('Rótulos');
  await tap(at.x, at.y);
  await wait(`document.querySelector('[data-testid="label-editor"]')`, 'label editor');
  assert.equal(await js(`document.querySelector('[data-testid="label-text"]').value`), 'Mar de las Brumas');
  tests.push('The Labels tool selects the painted label on the map and opens its inspector');
  // Drag the amber handle a quarter turn: a relabel with the new angle.
  // The rotate knob (amber #ffd479) sits right of the label on its axis: read it from the canvas itself.
  const findKnob = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const r=c.getBoundingClientRect(),k=c.width/r.width;
    const x0=Math.round((${at.x}-r.x)*k),y0=Math.round((${at.y}-40-r.y)*k),w=Math.round(300*k),h=Math.round(80*k);const d=c.getContext('2d').getImageData(x0,y0,w,h).data;let sx=0,sy=0,n=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4,R=d[o],G=d[o+1],B=d[o+2];if(R>245&&G>200&&G<222&&B>105&&B<135){sx+=x;sy+=y;n++;}}
    return n?{x:r.x+(x0+sx/n)/k,y:r.y+(y0+sy/n)/k,n}:null;})()`);
  let best = null;
  for (let i = 0; i < 50 && !best; i++) { best = await findKnob(); if (!best) await pause(100); }
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'labels-selected-1440.png'), shot.toPNG());
  assert(best, 'Rotate handle not drawn');
  console.log(`HANDLE ${JSON.stringify(best)} LABEL ${JSON.stringify(at)}`);
  const from = { x: Math.round(best.x), y: Math.round(best.y) }, to = { x: Math.round(at.x + 4), y: Math.round(at.y + (best.x - at.x)) };
  send({ type: 'mouseMove', x: from.x, y: from.y }); await pause(60);
  send({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let s = 1; s <= 16; s++) { const p = s / 16; send({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * p), y: Math.round(from.y + (to.y - from.y) * p), button: 'left', modifiers: ['leftButtonDown'] }); await pause(20); }
  send({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  let relabel; for (let i = 0; i < 60; i++) { edits = await row(); relabel = edits.filter(e => e.kind === 'relabel').at(-1); if (relabel) break; await pause(150); }
  assert(relabel && typeof relabel.angle === 'number' && relabel.angle > 1 && relabel.angle < 1.8, `Rotate handle did not save a turn: ${JSON.stringify(relabel)}`);
  await pause(800); fs.writeFileSync(path.join(evidence, 'labels-rotated-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Dragging the amber handle turns the label ${Math.round(relabel.angle * 180 / Math.PI)}° and saves one relabel edit`);
  // Exact values in the inspector: straighten, then curve and spacing.
  await js(`document.querySelector('[data-testid="label-straighten"]').click()`);
  const range = (id, v) => js(`(()=>{const i=document.querySelector('[data-testid="label-${id}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'${v}');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(300);
  await range('curve', 60); await range('spacing', 40); await range('size', 26);
  let last; for (let i = 0; i < 80; i++) { edits = await row(); last = edits.filter(e => e.kind === 'relabel'); if (last.some(e => e.curve === 0.6) && last.some(e => e.size === 26)) break; await pause(150); }
  const merged = Object.assign({}, ...last);
  assert(merged.curve === 0.6 && merged.spacing === 0.4 && merged.size === 26 && merged.angle === 0, `Inspector values not saved: ${JSON.stringify(last)}`);
  await pause(1200); fs.writeFileSync(path.join(evidence, 'labels-curved-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('The inspector straightens it, then sets curve 60%, spacing 40% and size 26 px as saved edits');
  // Words typed without Enter are kept when the reader clicks away on the map.
  await js(`(()=>{const i=document.querySelector('[data-testid="label-text"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Mar de las Nieblas');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(200);
  await tap(Math.round(rect.x + rect.w * 0.25), Math.round(rect.y + rect.h * 0.55));
  let retitled; for (let i = 0; i < 60; i++) { edits = await row(); retitled = edits.find(e => e.kind === 'relabel' && e.text === 'Mar de las Nieblas'); if (retitled) break; await pause(150); }
  assert(retitled, `Typed words lost on clicking the map: ${JSON.stringify(edits.filter(e => e.kind === 'relabel'))}`);
  tests.push('Words typed in the inspector are saved when the reader clicks away on the map');
  // Reopen: the label keeps its shape and the inspector reads it back.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await click('Pincel'); await click('Rótulos'); await pause(600);
  // The reopened map draws (and so registers) its labels a moment after it appears: click again until picked.
  for (let i = 0; i < 20 && !(await js(`!!document.querySelector('[data-testid="label-editor"]')`)); i++) { await tap(at.x, at.y); await pause(400); }
  await wait(`document.querySelector('[data-testid="label-editor"]')`, 'label editor after reopening');
  const values = await js(`['curve','spacing','size'].map(id=>document.querySelector('[data-testid="label-'+id+'"]').value)`);
  assert.deepEqual(values, ['60', '40', '26']);
  tests.push('Reopening keeps the shape; picking the label again shows curve 60, spacing 40, size 26');
  // Roll a name: the dice beside the text, off for notes, a range name in the world's languages, placed with a click.
  await click('Colocar'); await click('Rótulo'); await wait(nameInput, 'label text again');
  await click('Nota');
  assert(await js(`document.querySelector('[data-testid="label-roll"]').disabled`), 'The dice should be off for a note');
  await click('Sierra');
  await js(`document.querySelector('[data-testid="label-roll"]').click()`);
  await wait(`/^(Montes|Sierra de|Picos de) \\S/.test(${nameInput}.value) && document.querySelector('[data-testid="label-roll-etym"]')`, 'rolled range name');
  const first = await js(`${nameInput}.value`), etym = await js(`document.querySelector('[data-testid="label-roll-etym"]').textContent`);
  await js(`document.querySelector('[data-testid="label-roll"]').click()`);
  await wait(`${nameInput}.value !== ${JSON.stringify(first)} && /^(Montes|Sierra de|Picos de) \\S/.test(${nameInput}.value)`, 'a second roll');
  const second = await js(`${nameInput}.value`);
  const spot = { x: Math.round(rect.x + rect.w * 0.3), y: Math.round(rect.y + rect.h * 0.62) };
  const area = { x: spot.x - 140, y: spot.y - 30, width: 280, height: 60 };
  const grab = async () => { win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(area); return (await win.webContents.capturePage(area)).toBitmap(); };
  send({ type: 'mouseMove', x: spot.x, y: spot.y }); await pause(400);
  const before = await grab();
  await tap(spot.x, spot.y);
  let rolledLabel; for (let i = 0; i < 60; i++) { rolledLabel = (await row()).find(e => e.kind === 'label' && e.text === second); if (rolledLabel) break; await pause(150); }
  assert(rolledLabel && rolledLabel.style === 'range', `Rolled label not placed: ${JSON.stringify(await row()).slice(-300)}`);
  await pause(1200);
  const drawn = await grab();
  fs.writeFileSync(path.join(evidence, 'labels-roll-area-before.png'), require('electron').nativeImage.createFromBitmap(before, { width: area.width, height: area.height }).toPNG());
  fs.writeFileSync(path.join(evidence, 'labels-roll-area-after.png'), require('electron').nativeImage.createFromBitmap(drawn, { width: area.width, height: area.height }).toPNG());
  let changed = 0; for (let i = 0; i < Math.min(before.length, drawn.length); i += 4) if (Math.abs(before[i] - drawn[i]) + Math.abs(before[i + 1] - drawn[i + 1]) + Math.abs(before[i + 2] - drawn[i + 2]) > 60) changed++;
  assert(changed > 300, `The rolled label is not drawn on the atlas (${changed} pixels changed)`);
  await js(`document.querySelector('[data-testid="label-roll"]').scrollIntoView({block:'center'})`);
  await pause(1500); win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'labels-roll-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Roll a name: off for a note; for a range it rolls "${first}" (${etym.trim()}), then "${second}", which a click places as a range label, drawn on the atlas (${changed} pixels changed)`);
  // The Carta draws the curved label too.
  await click('Carta'); await pause(3500);
  fs.writeFileSync(path.join(evidence, 'labels-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Carta view captured with the curved label');
  win.setContentSize(640, 900); await pause(1200);
  fs.writeFileSync(path.join(evidence, 'labels-640.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); try { if (win) fs.writeFileSync(path.join(evidence, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.log('DOM ' + await win.webContents.executeJavaScript(`JSON.stringify({editor:!!document.querySelector('[data-testid="label-editor"]'),empty:!!document.querySelector('[data-testid="label-editor-empty"]'),mode:[...document.querySelectorAll('button')].filter(b=>b.className.includes('amber')).map(b=>b.textContent.trim()).slice(0,6)})`)); } catch { /* evidence only */ } await server?.close(); app.exit(1); });
