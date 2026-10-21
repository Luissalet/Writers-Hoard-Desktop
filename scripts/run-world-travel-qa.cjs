// Travel pace and the world's travel physics through the normal Travel panel,
// in an isolated hidden Electron profile with the real journey worker.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-travel-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const W = 'world-presentation-preview-world';
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-travel-qa', configureServer(instance) { instance.middlewares.use('/__world_travel_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_travel_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = []; win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message.slice(0, 300)); });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_travel_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 900) => { for (let i = 0; i < tries; i++) { const state = await js(`(async()=>({ok:!!(await (${expression})),error:window.__lookError}))()`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')})||s.startsWith(${JSON.stringify(text + ' ▾')})||s.startsWith(${JSON.stringify(text + ' ▴')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const row = () => js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('${W}');return {pace:r.travelPace??null,profile:r.travelProfile??null,journeys:(r.journeys??[]).length};})()`);
  const tests = [];
  await wait('window.__lookReady', 'preview'); await wait(button('Carta'), 'forged');
  // Two towns on the same land, found with the normal place tool; saved as an itinerary.
  const seeded = await js(`(async()=>{
    const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');
    let list; for(let i=0;i<60;i++){list=await runBridgeTool('wh_list_places',{worldId:'${W}',kind:'settlement',limit:60});if(list.ok&&!list.result.pending)break;await new Promise(r=>setTimeout(r,500));}
    const towns=list.result.places;
    for(const a of towns)for(const b of towns){if(a===b)continue;const plan=await runBridgeTool('wh_plan_journey',{worldId:'${W}',stops:[{place:a.key},{place:b.key}],mode:'foot'});
      if(plan.ok&&!plan.result.impossible&&plan.result.days>4){const {saveWorldJourney}=await import('/src/engines/worldgen/journeyOperations.ts');
        await saveWorldJourney('${W}','world-presentation-preview',{id:'qa-trip',name:'Camino del Estuario',stops:[{name:a.name,u:a.u,v:a.v},{name:b.name,u:b.u,v:b.v}],options:{mode:'foot',season:'summer'},recipeKey:'qa',createdAt:1,updatedAt:1});
        return {from:a.name,to:b.name,days:plan.result.days};}}
    return null;})()`);
  assert(seeded, 'No pair of towns with a land route');
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(button('Carta'), 'reopened');
  await click('Viaje');
  const savedSelect = `document.querySelector('select[aria-label="Abrir itinerario"]')`;
  await wait(savedSelect, 'saved itinerary select');
  await js(`(()=>{const s=${savedSelect};const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'qa-trip');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const duration = `[...document.querySelectorAll('div')].find(e=>e.className.includes('text-lg')&&/jornada|hora|día/.test(e.textContent))?.textContent`;
  await wait(duration, 'route duration');
  const steadyText = await js(duration);
  await pause(2500); fs.writeFileSync(path.join(evidence, 'travel-opened-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Opening the saved itinerary in the Travel panel computes it: ${seeded.from} → ${seeded.to}, "${steadyText}"`);
  await click('Forzado');
  await wait(`((d)=>!!d&&d!==${JSON.stringify(steadyText)})(${duration})`, 'hard pace changes the duration');
  const hardText = await js(duration);
  let saved; for (let i = 0; i < 60; i++) { saved = await row(); if (saved.pace === 'hard') break; await pause(150); }
  assert.equal(saved.pace, 'hard', 'The world did not remember the pace');
  const rest = await js(`document.querySelector('[data-testid="journey-rest-days"]')?.textContent ?? ''`);
  const daysOf = text => Number((text.match(/(\d+)\s*jornada/) || [0, 0])[1]) + (/(\d+)\s*h\b/.test(text) ? Number(text.match(/(\d+)\s*h\b/)[1]) / 24 : 0);
  assert(daysOf(hardText) < daysOf(steadyText), `Hard pace (rest included) reads slower than steady: ${hardText} vs ${steadyText}`);
  tests.push(`Choosing Forzado shortens the whole journey, rest included, to "${hardText}"${rest ? ` (${rest})` : ''} and is saved as the world's usual pace`);
  // World physics: walking twice as fast.
  await click('Ajustes de viaje de este mundo');
  await wait(`document.querySelector('[data-testid="journey-travel-settings"]')`, 'settings');
  await js(`(()=>{const input=[...document.querySelectorAll('[data-testid="journey-travel-settings"] input[type=range]')].find(e=>e.getAttribute('aria-label')==='a pie');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'200');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`((d)=>!!d&&d!==${JSON.stringify(hardText)})(${duration})`, 'faster walking changes the duration');
  const fastText = await js(duration);
  for (let i = 0; i < 60; i++) { saved = await row(); if (saved.profile?.speed?.foot === 2) break; await pause(150); }
  assert.equal(saved.profile?.speed?.foot, 2, 'The world did not save its travel physics');
  tests.push(`Setting walking speed to 200% recomputes the route ("${fastText}") and saves the world's travel physics`);
  await pause(3000); fs.writeFileSync(path.join(evidence, 'travel-settings-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Reopen: the world's pace and physics come back.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(button('Carta'), 'reopened'); await click('Viaje');
  await wait(savedSelect, 'select again');
  const footSlider = `[...document.querySelectorAll('[data-testid="journey-travel-settings"] input[type=range]')].find(e=>e.getAttribute('aria-label')==='a pie').value`;
  // Opening the old itinerary plans it with its own snapshot and leaves the world alone.
  await js(`(()=>{const s=${savedSelect};const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'qa-trip');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(duration, 'recomputed after reopen');
  await click('Ajustes de viaje de este mundo');
  await wait(`document.querySelector('[data-testid="journey-trip-settings"]')`, 'trip settings note');
  await wait(`${footSlider}==='100'`, 'trip snapshot shown');
  await pause(1200);
  saved = await row();
  assert(saved.pace === 'hard' && saved.profile?.speed?.foot === 2, `Opening an itinerary rewrote the world: ${JSON.stringify(saved)}`);
  const tripText = await js(duration);
  assert.equal(tripText, steadyText, 'The old itinerary was not planned with the settings it was saved with');
  tests.push(`Opening the saved itinerary plans it with its own settings ("${tripText}") and leaves the world's pace and physics untouched`);
  await js(`document.querySelector('[data-testid="journey-close"]').click()`);
  await wait(`${footSlider}==='200'`, 'world settings after closing the trip');
  tests.push('Closing the itinerary goes back to the world\'s settings, restored after reopening the engine');
  // Play the journey: the banner leaves, spends nights where the planner put them, and arrives.
  await wait(`document.querySelector('[data-testid="journey-play"]')`, 'journey player');
  await js(`document.querySelector('[data-testid="journey-play"]').click()`);
  const caption = `document.querySelector('[data-testid="journey-play-caption"]')?.textContent ?? ''`;
  const seen = new Set();
  for (let i = 0; i < 80; i++) { const c = await js(caption); if (c) seen.add(c); if ([...seen].some(x => /Noche/.test(x)) && seen.size >= 3) break; await pause(100); }
  assert(seen.size >= 3 && [...seen].some(x => /Noche/.test(x)), `Playback did not reach a night: ${JSON.stringify([...seen])}`);
  await pause(400); fs.writeFileSync(path.join(evidence, 'journey-playing-1440.png'), (await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const i=document.querySelector('[data-testid="journey-play-day"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,i.max);i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`/Llegada/.test(${caption})`, 'arrival caption');
  tests.push(`Playing the journey moves the banner day by day and halts for the nights (${[...seen].join(' / ')}); the slider's end reads "${await js(caption)}"`);
  // The banner on the atlas (Mapa) itself, not only on the Carta: count its red on the map canvas.
  await click('Mapa'); await pause(1500);
  await js(`(()=>{const i=document.querySelector('[data-testid="journey-play-day"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,String(Number(i.max)*0.3));i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(1200);
  const red = await js(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if((Math.abs(d[i]-192)<8&&Math.abs(d[i+1]-57)<8&&Math.abs(d[i+2]-43)<8)||(Math.abs(d[i]-217)<8&&Math.abs(d[i+1]-164)<8&&Math.abs(d[i+2]-65)<8))n++;return n;})()`);
  assert(red > 10, `No travelling banner on the atlas (${red} banner pixels)`);
  tests.push(`The travelling banner is drawn on the atlas (Mapa) too (${red} banner pixels at 30% of the way)`);
  fs.writeFileSync(path.join(evidence, 'journey-atlas-banner-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Paint in as they travel: the route, seen within 40 km, from chapter 2.
  await wait(`document.querySelector('[data-testid="journey-reveal-go"]')`, 'route reveal');
  await js(`(()=>{const set=(sel,v)=>{const i=document.querySelector(sel);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));};set('[data-testid="journey-reveal-km"]','40');set('[data-testid="journey-reveal-chapter"]','2');})()`);
  await pause(200); await js(`document.querySelector('[data-testid="journey-reveal-go"]').click()`);
  let fogged; for (let i = 0; i < 80; i++) { fogged = await js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const r=await db.generatedWorlds.toArray();return r.flatMap(w=>deserializeEdits(w.edits||'[]')).filter(e=>e.kind==='fog');})()`); if (fogged.length) break; await pause(150); }
  assert(fogged.length === 1 && fogged[0].op === 'seen' && fogged[0].chapter === 2 && fogged[0].stroke.pts.length > 2, `Route not marked: ${JSON.stringify(fogged)}`);
  tests.push(`"Mark the route as seen" paints the reader's map along the route (${fogged[0].stroke.pts.length} points, ${Math.round(fogged[0].stroke.radius * 10) / 10} cells of sight) from chapter 2`);
  win.setContentSize(640, 900); await pause(1000);
  fs.writeFileSync(path.join(evidence, 'travel-settings-640.png'), (await win.webContents.capturePage()).toPNG());
  if (errors.length) console.log('CONSOLE ERRORS\n' + errors.slice(0, 8).join('\n'));
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
