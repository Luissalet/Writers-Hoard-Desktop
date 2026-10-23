// Timeline tags, filters and saved views through the normal engine: a tag
// added in the event form, the filter bar narrowing the swim lanes by tag and
// shape, a view saved and chosen again after reopening, the tag manager merging
// "Guerra" into "batalla", and an event kept out of the wiki. Isolated hidden
// Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-timeline-tags-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'timeline-tags-qa', configureServer(instance) { instance.middlewares.use('/__timeline_tags_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__timeline_tags_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/timeline-tags-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__timeline_tags_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__ttError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const q = id => `document.querySelector('[data-testid="${id}"]')`;
  const shown = () => js(`[...document.querySelectorAll('g[aria-label]')].map(g=>g.getAttribute('aria-label')).filter(l=>/^(La |El )/.test(l)).map(l=>l.split(/[,·(]/)[0].trim()).sort().join('|')`);
  const typeIn = (selector, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const rows = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return Object.fromEntries((await db.timelineEvents.where('projectId').equals('timeline-tags-preview').toArray()).map(e=>[e.title,{tags:e.tags??[],hide:!!e.hideFromWiki}]));})()`);
  const tests = [];
  await wait('window.__ttReady', 'preview');
  await wait(`document.querySelector('g[aria-label^="La partida"]') && ${q('timeline-filter')}`, 'lanes and filter bar');
  await pause(600);
  // A tag added in the event form; the event kept out of the wiki.
  await js(`(()=>{const g=document.querySelector('g[aria-label^="La partida"]');g.focus();g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await wait(`document.querySelector('[data-testid="event-tags"] input')`, 'event form');
  await typeIn('[data-testid="event-tags"] input', 'viaje');
  await js(`document.querySelector('[data-testid="event-tags"] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
  await js(`${q('event-hide-wiki')}.click()`);
  await pause(200);
  fs.writeFileSync(path.join(evidence, 'timeline-event-tags.png'), (await win.webContents.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Guardar').click()`);
  let now; for (let i = 0; i < 60; i++) { now = await rows(); if (now['La partida'].tags.join() === 'viaje') break; await pause(150); }
  assert(now['La partida'].tags.join() === 'viaje' && now['La partida'].hide, `Saved from the form: ${JSON.stringify(now['La partida'])}`);
  tests.push('Event form: "La partida" gets the tag "viaje" in the new Etiquetas field and is kept out of the wiki (timeline-event-tags.png)');
  // Filter by tag (case-insensitive) and by shape.
  await wait(q('timeline-filter-tag-guerra'), 'tag chips');
  await js(`${q('timeline-filter-tag-guerra')}.click()`);
  await wait(`${q('timeline-filter-count')}?.textContent.startsWith('2 de 5')`, 'filtered by guerra');
  const byTag = await shown();
  assert(byTag === 'El asedio|La batalla del vado', `Shown for #guerra: ${byTag}`);
  await js(`${q('timeline-filter-type-milestone')}.click()`);
  await wait(`${q('timeline-filter-count')}?.textContent.startsWith('1 de 5')`, 'and milestones');
  fs.writeFileSync(path.join(evidence, 'timeline-filtered.png'), (await win.webContents.capturePage()).toPNG());
  // Save it as a view, clear, reopen, choose it again.
  await js(`${q('timeline-view-new')}.click()`);
  await wait(q('timeline-view-name'), 'view name');
  await typeIn('[data-testid="timeline-view-name"]', 'Batallas clave');
  await js(`${q('timeline-view-save')}.click()`);
  await wait(`[...${q('timeline-view-select')}.options].some(o=>o.textContent==='Batallas clave')`, 'view saved');
  await js(`${q('timeline-filter-clear')}.click()`);
  await wait(`${q('timeline-filter-count')}?.textContent.startsWith('5 de 5')`, 'cleared');
  await js('location.reload()');
  await wait(`window.__ttReady && ${q('timeline-view-select')} && [...${q('timeline-view-select')}.options].some(o=>o.textContent==='Batallas clave')`, 'reopened with the view');
  await js(`(()=>{const s=${q('timeline-view-select')};const o=[...s.options].find(o=>o.textContent==='Batallas clave');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`${q('timeline-filter-count')}?.textContent.startsWith('1 de 5')`, 'view applied');
  assert(await shown() === 'La batalla del vado', 'The view shows the milestone of the war');
  tests.push(`Filter bar: #guerra (matching "Guerra" too) shows "${byTag.replace('|', '" and "')}", adding Hito leaves "La batalla del vado"; saved as "Batallas clave", cleared, and after reopening the view brings the same filter back (timeline-filtered.png)`);
  await js(`${q('timeline-filter-clear')}.click()`);
  // Merge "Guerra" into "batalla" from the tag manager.
  await js(`${q('timeline-tags-manage')}.click()`);
  await wait(q('timeline-tag-manager'), 'tag manager');
  await typeIn('[data-testid="timeline-tag-rename-guerra"]', 'batalla');
  await wait(`${q('timeline-tag-apply-guerra')}?.textContent==='Fusionar'`, 'merge offered');
  fs.writeFileSync(path.join(evidence, 'timeline-tag-manager.png'), (await win.webContents.capturePage()).toPNG());
  await js(`${q('timeline-tag-apply-guerra')}.click()`);
  for (let i = 0; i < 60; i++) { now = await rows(); if (now['El asedio'].tags.join() === 'batalla') break; await pause(150); }
  assert(now['El asedio'].tags.join() === 'batalla' && now['La batalla del vado'].tags.join() === 'batalla', `Merged: ${JSON.stringify(now)}`);
  await wait(`!${q('timeline-filter-tag-guerra')} && ${q('timeline-filter-tag-batalla')}?.textContent.includes('2')`, 'chips after the merge');
  tests.push('Tag manager: renaming "guerra" to "batalla" is offered as "Fusionar" and leaves both war events tagged only "batalla" (timeline-tag-manager.png)');
  const failed = await js('window.__ttError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
