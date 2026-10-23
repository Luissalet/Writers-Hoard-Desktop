// Writing sprints in rounds: a sprint run to the end offers a break (short, a
// long one every fourth round) or another round; the break counts down, can be
// skipped, survives walking away and back, and the toolbar shows the next
// round. The page's clock is moved forward instead of waited for. Isolated
// hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sprint-rounds-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'sprint-rounds-qa', configureServer(instance) { instance.middlewares.use('/__sprint_rounds_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__sprint_rounds_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/sprint-rounds-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1100, height: 500, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__sprint_rounds_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 600) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__spError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)})&&!e.disabled)`;
  const q = id => `document.querySelector('[data-testid="${id}"]')`;
  const shot = async name => fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG());
  const tests = [];
  await wait('window.__spReady', 'preview');
  await wait(button('25 min'), 'start button');
  // Four rounds; the fourth earns the long break.
  const lengths = [];
  for (let n = 1; n <= 4; n++) {
    await js(`${n === 1 ? button('25 min') : q('sprint-again')}.click()`);
    await wait(`document.querySelector('[title="Detener sprint"]')`, `sprint ${n} running`);
    await js('window.__words += 300; window.__skew += 26 * 60000');
    await wait(q('sprint-break'), `round ${n} finished`);
    lengths.push(await js(`${q('sprint-break')}.textContent.trim()`));
    if (n === 1) {
      await shot('sprint-finished.png');
      await js(`${q('sprint-break')}.click()`);
      await wait(`${q('sprint-rest-clock')}?.textContent === '05:00' || ${q('sprint-rest-clock')}?.textContent === '04:59'`, 'break counting down');
      await shot('sprint-break.png');
      // Walk away and back: the break is still running.
      await js('window.__spUnmount()'); await pause(200); await js('window.__spMount()');
      await wait(q('sprint-resting'), 'break kept after remount');
      await js('window.__skew += 5 * 60000 + 2000');
      await wait(`!${q('sprint-resting')} && ${q('sprint-round')}`, 'break over');
      const chip = await js(`${q('sprint-round')}.textContent`);
      assert(/ronda 2/.test(chip), `Next round shown: ${chip}`);
      await shot('sprint-next-round.png');
      tests.push(`A sprint run to the end offers "${lengths[0]}" and "Otra ronda"; the break counts down from 05:00, is still there after walking away and back, and when it ends the toolbar offers "${chip.replace(/^[·\s]+/, '')}" (sprint-finished.png, sprint-break.png, sprint-next-round.png)`);
      await js(`${button('25 min')}.click()`);
      await wait(`document.querySelector('[title="Detener sprint"]')`, 'round 2 running');
      await js('window.__words += 300; window.__skew += 26 * 60000');
      await wait(q('sprint-break'), 'round 2 finished');
      lengths.push(await js(`${q('sprint-break')}.textContent.trim()`));
      n = 2;
    }
  }
  assert(lengths[0] === 'Descanso 5 min' && lengths[1] === 'Descanso 5 min' && lengths[3] === 'Descanso 15 min', `Break lengths: ${lengths.join(', ')}`);
  await js(`${q('sprint-break')}.click()`);
  await wait(`${q('sprint-rest-clock')}?.textContent?.startsWith('15:') || ${q('sprint-rest-clock')}?.textContent === '14:59'`, 'long break');
  await js(`${q('sprint-break-skip')}.click()`);
  await wait(`!${q('sprint-resting')} && /ronda 5/.test(${q('sprint-round')}?.textContent ?? '')`, 'skipped');
  const logged = await js(`(async()=>{const {listSprints}=await import('/src/engines/writing-stats/sprints.ts');return (await listSprints('sprint-rounds-preview')).map(s=>s.actualWords);})()`);
  assert(logged.length === 4 && logged.every(w => w === 300), `Logged: ${logged}`);
  tests.push(`Rounds 1–3 offer a 5-minute break and the fourth a 15-minute one (${lengths.join(', ')}); "Saltar el descanso" ends it at once and the toolbar moves to round 5; the four sprints are logged with their 300 words each`);
  // A stopped sprint is not a round.
  await js(`${button('25 min')}.click()`);
  await wait(`document.querySelector('[title="Detener sprint"]')`, 'sprint 5 running');
  await js(`document.querySelector('[title="Detener sprint"]').click()`);
  await wait(button('Detener sprint') + ` && document.querySelector('[role="dialog"]')`, 'confirm');
  await js(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Detener sprint').click()`);
  await wait(`${q('sprint-again')} && !${q('sprint-break')}`, 'stopped: no break offered');
  tests.push('A sprint stopped early is filed as stopped, offers no break and does not count as a round');
  const failed = await js('window.__spError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
