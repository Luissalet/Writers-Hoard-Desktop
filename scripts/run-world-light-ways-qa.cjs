// The map at an hour, the world's own ways of travelling, a port's sea trade
// and the party's marks, through the normal engine. Isolated hidden Electron
// profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-light-ways-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-light-ways-qa', configureServer(instance) { instance.middlewares.use('/__world_light_ways_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_light_ways_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_light_ways_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 900) => { for (let i = 0; i < tries; i++) { const state = await js(`(async()=>({ok:!!(await (${expression})),error:window.__lookError}))()`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')})||s.startsWith(${JSON.stringify(text + ' ▾')})||s.startsWith(${JSON.stringify(text + ' ▴')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const tests = [];
  const setSelect = (sel, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  // The mean colour of the middle of the map canvas.
  const mean = () => js(`(async()=>{await new Promise(r=>setTimeout(r,400));const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const x0=Math.floor(c.width*0.3),y0=Math.floor(c.height*0.3);const d=c.getContext('2d').getImageData(x0,y0,Math.floor(c.width*0.4),Math.floor(c.height*0.4)).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=16){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}return [r/n,g/n,b/n];})()`);
  await wait('window.__lookReady', 'preview'); await wait(button('Carta'), 'forged');
  await pause(1500);
  // The map at an hour.
  await wait(`document.querySelector('[data-testid="worldgen-map-hour"]')`, 'light menu');
  const day = await mean();
  await setSelect('[data-testid="worldgen-map-hour"]', 'night'); await pause(800);
  const night = await mean();
  fs.writeFileSync(path.join(evidence, 'map-night.png'), (await win.webContents.capturePage()).toPNG());
  await setSelect('[data-testid="worldgen-map-hour"]', 'dusk'); await pause(800);
  const dusk = await mean();
  fs.writeFileSync(path.join(evidence, 'map-dusk.png'), (await win.webContents.capturePage()).toPNG());
  const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  assert(lum(night) < lum(day) * 0.7 && night[2] > night[0], `Night ${night.map(Math.round)} against day ${day.map(Math.round)}`);
  assert(dusk[0] - dusk[2] > day[0] - day[2] + 10, `Dusk ${dusk.map(Math.round)} against day ${day.map(Math.round)}`);
  await setSelect('[data-testid="worldgen-map-hour"]', 'off');
  tests.push(`Luz del mapa: noche darkens and blues the map (${Math.round(lum(night))} against ${Math.round(lum(day))}), atardecer reddens it (map-night.png, map-dusk.png)`);
  // A journey with the world's own way: two towns, an itinerary, a flying griffin.
  const seeded = await js(`(async()=>{
    const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');
    let list; for(let i=0;i<60;i++){list=await runBridgeTool('wh_list_places',{worldId:'${W}',kind:'settlement',limit:60});if(list.ok&&!list.result.pending)break;await new Promise(r=>setTimeout(r,500));}
    const towns=list.result.places;
    for(const a of towns)for(const b of towns){if(a===b)continue;const plan=await runBridgeTool('wh_plan_journey',{worldId:'${W}',stops:[{place:a.key},{place:b.key}],mode:'foot'});
      if(plan.ok&&!plan.result.impossible&&plan.result.days>3){const {saveWorldJourney}=await import('/src/engines/worldgen/journeyOperations.ts');
        await saveWorldJourney('${W}','world-presentation-preview',{id:'qa-trip',name:'Camino del Estuario',stops:[{name:a.name,u:a.u,v:a.v},{name:b.name,u:b.u,v:b.v}],options:{mode:'foot',season:'summer'},recipeKey:'qa',createdAt:1,updatedAt:1});
        return {from:a.name,to:b.name,days:plan.result.days};}}
    return null;})()`);
  assert(seeded, 'No pair of towns with a land route');
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(button('Carta'), 'reopened');
  await click('Viaje');
  const savedSelect = `document.querySelector('select[aria-label="Abrir itinerario"]')`;
  await wait(savedSelect, 'saved itinerary select');
  await js(`(()=>{const s=${savedSelect};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'qa-trip');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const duration = `[...document.querySelectorAll('div')].find(e=>e.className.includes('text-lg')&&/jornada|hora|día/.test(e.textContent))?.textContent`;
  await wait(duration, 'route duration');
  const walking = await js(duration);
  await js(`document.querySelector('[data-testid="journey-close"]')?.click()`); await pause(400);
  await click('Ajustes de viaje de este mundo');
  await wait(`document.querySelector('[data-testid="journey-way-new"]')`, 'new way form');
  await js(`(()=>{const box=document.querySelector('[data-testid="journey-way-new"]');const i=box.querySelector('input:not([type])')||box.querySelector('input[type=text]')||box.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Grifo');i.dispatchEvent(new Event('input',{bubbles:true}));const fly=[...box.querySelectorAll('input[type=checkbox]')][0];fly.click();return true;})()`);
  await pause(200);
  await js(`[...document.querySelectorAll('[data-testid="journey-way-new"] button')].find(b=>b.textContent.trim()==='Añadir vía').click()`);
  await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='✈ Grifo')`, 'griffin chip');
  let row; for (let i = 0; i < 60; i++) { row = await js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('${W}');return r.travelProfile??null;})()`); if (row?.ways?.[0]?.name === 'Grifo') break; await pause(150); }
  assert(row?.ways?.[0]?.name === 'Grifo' && row.ways[0].flies === true, `Way saved: ${JSON.stringify(row)}`);
  await wait(`((d)=>!!d&&d!==${JSON.stringify(walking)})(${duration})`, 'the griffin changes the duration');
  const flying = await js(duration);
  fs.writeFileSync(path.join(evidence, 'travel-griffin.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Viaje → Vías propias: "Grifo" (vuela) is added, saved with the world and chosen; ${seeded.from} → ${seeded.to} reads "${flying}" instead of "${walking}" on foot`);
  // The journey's hour on the map: play to a night and choose the journey's light.
  await click('Mapa'); await pause(1200);
  await wait(`document.querySelector('[data-testid="journey-play"]')`, 'journey player');
  await js(`document.querySelector('[data-testid="journey-play"]').click()`); await pause(300);
  await js(`document.querySelector('[data-testid="journey-play"]').click()`);
  await js(`(()=>{const i=document.querySelector('[data-testid="journey-play-day"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0.85');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(600);
  const before = await mean();
  await setSelect('[data-testid="worldgen-map-hour"]', 'journey'); await pause(900);
  const journeyNight = await mean();
  fs.writeFileSync(path.join(evidence, 'journey-night-lantern.png'), (await win.webContents.capturePage()).toPNG());
  assert(lum(journeyNight) < lum(before) * 0.8, `The journey's night ${journeyNight.map(Math.round)} against ${before.map(Math.round)}`);
  await setSelect('[data-testid="worldgen-map-hour"]', 'off');
  tests.push('Luz: la hora del viaje follows the playback: at night on the road the map goes dark, with the party\'s lantern (journey-night-lantern.png)');
  // A port's sea trade in the trade lens.
  await click('Comercio');
  await wait(`document.querySelector('[data-testid="trade-places"] button')`, 'trade places');
  await js(`document.querySelector('[data-testid="trade-places"] button').click()`);
  await wait(`document.querySelector('[data-testid="trade-port"]')`, 'port box');
  for (let k = 0; k < 6; k++) await js(`document.querySelector('[data-testid="trade-next"]')?.click()`);
  await pause(600);
  const port = await js(`document.querySelector('[data-testid="trade-port"]').textContent`);
  assert(/puerto|sin puerto/.test(port), `Port box: ${port}`);
  fs.writeFileSync(path.join(evidence, 'trade-port.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Comercio: choosing a place shows whether it is a port and its sea trade so far ("${port.replace(/\s+/g, ' ').trim().slice(0, 140)}")`);
  // The party's marks among the story kinds.
  await click('Pincel'); await click('Sucesos');
  await wait(`document.querySelector('[data-testid="story-type-lantern"]')`, 'lantern kind');
  await js(`document.querySelector('[data-testid="story-type-lantern"]').click()`);
  assert(await js(`['story-type-sneaking','story-type-inside'].every(id=>!!document.querySelector('[data-testid="'+id+'"]'))`), 'Sneaking and inside kinds');
  tests.push('Sucesos: «A la luz del farol», «A hurtadillas» and «Dentro» are kinds of event to place');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
