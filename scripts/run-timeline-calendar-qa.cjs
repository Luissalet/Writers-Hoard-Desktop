// The timeline's Calendar view through the normal engine: October 2026 on the
// Gregorian calendar with its events, the storm spanning three days, a day's
// detail and a new event on it, the year at a glance, go-to-date, the date
// calculator, and the same month through wh_timeline_calendar. Isolated profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-timeline-calendar-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'timeline-calendar-qa', configureServer(instance) { instance.middlewares.use('/__timeline_calendar_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__timeline_calendar_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/timeline-calendar-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__timeline_calendar_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__tcError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const q = id => `document.querySelector('[data-testid="${id}"]')`;
  const typeIn = (selector, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const tests = [];
  await wait('window.__tcReady', 'preview');
  // Today is in October too, so wait for the events themselves, not the title.
  await wait(`${q('timeline-calendar')} && /octubre/i.test(${q('calendar-title')}?.textContent ?? '') && document.querySelector('[data-testid="calendar-day-3"] [data-testid="calendar-event"]')`, 'calendar opens on the first event month with its events');
  const october = await js(`({title:${q('calendar-title')}.textContent,storm:[21,22,23,24].map(d=>[...document.querySelectorAll('[data-testid="calendar-day-'+d+'"] [data-testid="calendar-event"]')].map(e=>e.textContent).join()),ship:[...document.querySelectorAll('[data-testid="calendar-day-3"] [data-testid="calendar-event"]')].map(e=>e.textContent).join(),firstCol:[...document.querySelectorAll('[data-testid="timeline-calendar"] .grid > span')].slice(0,7).map(s=>s.textContent).join('|')})`);
  assert(october.storm.slice(0, 3).every(t => t === 'La tormenta') && october.storm[3] === '' && october.ship === 'Llega el barco', `October: ${JSON.stringify(october)}`);
  fs.writeFileSync(path.join(evidence, 'calendar-month.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Calendario → ${october.title}: the week starts ${october.firstCol.split('|')[0]}; "Llega el barco" on the 3rd and "La tormenta" across the 21st to the 23rd (calendar-month.png)`);
  // A day's detail and a new event on it.
  await js(`${q('calendar-day-21')}.click()`);
  await wait(`/miércoles/i.test(${q('calendar-day-detail')}?.textContent ?? '')`, 'detail of the 21st');
  await typeIn('[data-testid="calendar-new-title"]', 'Se pierde el ancla');
  await js(`${q('calendar-new')}.click()`);
  let made; for (let i = 0; i < 60; i++) { made = await js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.timelineEvents.where('projectId').equals('timeline-calendar-preview').toArray()).find(e=>e.title==='Se pierde el ancla')??null;})()`); if (made) break; await pause(150); }
  assert(made && made.dateMode === 'calendar' && made.realDate === '2026-10-21', `New event: ${JSON.stringify(made)}`);
  await wait(`[...document.querySelectorAll('[data-testid="calendar-day-21"] [data-testid="calendar-event"]')].some(e=>e.textContent==='Se pierde el ancla')`, 'shown on the 21st');
  tests.push('A click on the 21st shows it is a miércoles with the storm; "Se pierde el ancla" written there becomes an event dated 2026-10-21 and appears on the day');
  // The year at a glance, then go to a date.
  await js(`${q('calendar-scale-year')}.click()`);
  await wait(`/2026/.test(${q('calendar-title')}.textContent) && document.querySelectorAll('[data-testid="timeline-calendar"] .grid-cols-1 > div').length === 12`, 'year view');
  fs.writeFileSync(path.join(evidence, 'calendar-year.png'), (await win.webContents.capturePage()).toPNG());
  await typeIn('[data-testid="calendar-goto"]', '12 noviembre 2026');
  await js(`${q('calendar-goto')}.form.requestSubmit()`);
  await wait(`/noviembre/i.test(${q('calendar-title')}.textContent) && [...document.querySelectorAll('[data-testid="calendar-day-12"] [data-testid="calendar-event"]')].some(e=>e.textContent==='El juicio')`, 'went to November');
  tests.push('"Año" shows the twelve months of 2026 (calendar-year.png); "Ir a 12 noviembre 2026" opens November with "El juicio" on the 12th');
  // The calculator.
  await js(`${q('calendar-calculator')}.open=true`);
  await typeIn('[data-testid="calc-a"]', '1 octubre 2026'); await typeIn('[data-testid="calc-b"]', '25 diciembre 2026'); await typeIn('[data-testid="calc-n"]', '100');
  await wait(`${q('calc-between')}.textContent==='85 días' && /9 enero 2027.*sábado/i.test(${q('calc-plus')}.textContent)`, 'calculator');
  fs.writeFileSync(path.join(evidence, 'calendar-calculator.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Date calculator: from 1 octubre 2026 to 25 diciembre 2026 is 85 días; 1 octubre + 100 días is "${await js(`${q('calc-plus')}.textContent`)}" (calendar-calculator.png)`);
  const bridge = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const m=await runBridgeTool('wh_timeline_calendar',{projectId:'timeline-calendar-preview',calendar:'earth',year:2026,month:10});const y=await runBridgeTool('wh_timeline_calendar',{projectId:'timeline-calendar-preview',calendar:'earth',year:2026});const w=await runBridgeTool('wh_timeline_calendar',{projectId:'timeline-calendar-preview',year:2026});return {d21:m.result.days[20],oct:y.result.months[9].events,nov:y.result.months[10].events,world:w.ok?null:w.error};})()`);
  assert(bridge.d21.weekday.toLowerCase() === 'miércoles' && bridge.d21.events.length === 2 && bridge.oct === 3 && bridge.nov === 1 && /no world calendar/.test(bridge.world), `Bridge: ${JSON.stringify(bridge)}`);
  tests.push('Bridge: wh_timeline_calendar gives the 21st of October as a miércoles with two events, the year with 3 events in October and 1 in November, and refuses the world calendar a project does not have');
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
