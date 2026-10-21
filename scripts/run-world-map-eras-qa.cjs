// Map eras linked to timeline moments through the normal map history panel,
// in an isolated hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-eras-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const P = 'map-eras-preview', M = 'map-eras-preview-atlas';
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-eras-qa', configureServer(instance) { instance.middlewares.use('/__map_eras_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_eras_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-map-eras-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = []; win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message.slice(0, 300)); });
  await win.loadURL(`${server.resolvedUrls.local[0]}__map_eras_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`(async()=>({ok:!!(await (${expression})),error:window.__erasError}))()`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const q = id => `document.querySelector('[data-testid="${id}"]')`;
  const choose = (id, value) => js(`(()=>{const s=${q(id)};const set=Object.getOwnPropertyDescriptor(s instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event(s instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  const options = () => js(`[...${q('map-version-select')}.options].map(o=>o.textContent.trim())`);
  const versions = () => js(`(async()=>{const m=await (await import('/src/db/index.ts')).db.worldMaps.get('${M}');return (m.versions??[]).map(v=>({id:v.id,name:v.name,event:v.timelineEventId??null}));})()`);
  const shot = async name => { await pause(700); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const tests = [];
  await wait('window.__erasReady', 'preview');
  await wait(q('map-version-select'), 'era select');
  const initial = await options();
  const founding = initial.findIndex(t => t.includes('La fundación')), war = initial.findIndex(t => t.includes('Tras la guerra'));
  assert(founding >= 0 && war > founding, `Eras not in calendar order: ${JSON.stringify(initial)}`);
  tests.push(`The history lists eras in the world calendar's order, not in saved order: ${JSON.stringify(initial)}`);
  // Capture the present as an era standing for the flood, through the normal form.
  await js(`${q('map-version-new')}.click()`);
  await wait(q('map-version-event'), 'event picker');
  const eventOptions = await js(`[...${q('map-version-event')}.options].map(o=>o.textContent.trim())`);
  assert(eventOptions.some(t => t.includes('La gran riada') && /260/.test(t)), `Event picker lacks calendar dates: ${JSON.stringify(eventOptions)}`);
  await choose('map-version-name', 'Tras la riada');
  await choose('map-version-event', `${P}-flood`);
  await shot('eras-capture-form-1440.png');
  await js(`${q('map-version-capture')}.click()`);
  let rows; for (let i = 0; i < 60; i++) { rows = await versions(); if (rows.length === 3) break; await pause(150); }
  const flood = rows.find(v => v.name === 'Tras la riada');
  assert(flood && flood.event === `${P}-flood`, `Capture did not link: ${JSON.stringify(rows)}`);
  await wait(`[...${q('map-version-select')}.options].length===${initial.length + 1}`, 'new era listed');
  const after = await options();
  const order = ['La fundación', 'Tras la riada', 'Tras la guerra'].map(name => after.findIndex(t => t.includes(name)));
  assert(order[0] < order[1] && order[1] < order[2], `New era not placed by its moment: ${JSON.stringify(after)}`);
  tests.push('Saving the present as an era linked to "La gran riada" stores the link and slots it between the founding and the war');
  // Play through history: each step shows a moment, then it returns to the present.
  await js(`${q('map-version-play')}.click()`);
  const seen = new Set();
  for (let i = 0; i < 80; i++) { const moment = await js(`${q('map-version-moment')}?.textContent??''`); if (moment) seen.add(moment); if (seen.size >= 2 && i === 12) await shot('eras-playing-1440.png'); if (!(await js(`!!${q('map-version-current')}`)) && seen.size >= 3) break; await pause(150); }
  assert(seen.size >= 3, `Playback did not walk the eras: ${JSON.stringify([...seen])}`);
  await wait(`!${q('map-version-current')}`, 'playback returns to the present');
  tests.push(`Play walks through the eras in order (${[...seen].join(' → ')}) and returns to the present`);
  // Reopen: the link and the order survive, and an era shows the moment it stands for.
  await js('window.__erasUnmount()'); await pause(200); await js('window.__erasMount()');
  await wait(q('map-version-select'), 'reopened');
  assert.deepEqual(await options(), after);
  await choose('map-version-select', flood.id);
  await wait(q('map-version-linked'), 'linked note');
  const linked = await js(`${q('map-version-linked')}.textContent`);
  assert(linked.includes('La gran riada'), linked);
  await shot('eras-linked-1440.png');
  tests.push(`Reopening keeps order and link; the era reads "${linked.trim()}"`);
  // Deleting the event leaves the era visible as an orphan.
  await js(`(async()=>{const {db}=await import('/src/db/index.ts');await db.timelineEvents.delete('${P}-flood');const {notifyDataChanged}=await import('/src/engines/_shared/dataChanged.ts');notifyDataChanged({source:'other',projectId:'${P}'});})()`);
  await wait(q('map-version-orphan'), 'orphan note');
  const kept = await js(`${q('map-version-moment')}?.textContent??''`);
  assert(/260/.test(kept), `The era lost its date with the event: ${kept}`);
  tests.push(`Deleting the timeline event keeps the era, marks the missing moment and still reads "${kept.trim()}"`);
  win.setContentSize(640, 900); await shot('eras-linked-640.png');
  if (errors.length) console.log('CONSOLE ERRORS\n' + errors.slice(0, 8).join('\n'));
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
