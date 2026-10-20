const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const root = path.resolve(__dirname, '..'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-vvd-world-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
let server;
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', watch: null }, plugins: [{ name: 'world-qa', configureServer(instance) { instance.middlewares.use('/__vvd_world_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__vvd_world_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-world-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = []; win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await win.loadURL(`${server.resolvedUrls.local[0]}__vvd_world_qa`);
  for (let i = 0; i < 200; i++) { const state = await win.webContents.executeJavaScript('({ready:window.__worldPreviewReady,error:window.__worldPreviewError})'); if (state.error) throw Error(state.error); if (state.ready) break; if (i === 199) throw Error('Preview did not load'); await new Promise(resolve => setTimeout(resolve, 100)); }
  const requested = process.argv.slice(2);
  for (const surface of requested.length ? requested : ['dictionary', 'tables', 'media', 'wiki', 'editor', 'reading', 'presentation']) {
    await win.webContents.executeJavaScript(`window.__worldPreviewSelect(${JSON.stringify(surface)})`);
    const expected = surface === 'reading' ? '[data-reading-face]' : surface === 'presentation' ? '.wh-reader-studio-cover' : `[data-preview-surface="${surface}"]`;
    for (let attempt = 0; attempt < 120; attempt++) { if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(expected)}))`)) break; if (attempt === 119) throw Error(`Missing requested ${surface} surface`); await new Promise(resolve => setTimeout(resolve, 100)); }
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    if (surface === 'wiki') { await win.webContents.executeJavaScript('document.querySelector("details").open = true'); }
    if (surface === 'links') {
      await win.webContents.executeJavaScript(`(()=>{document.querySelector('[data-editor-document-tools] > summary').click();document.querySelector('[data-codex-block-controls] button').click();})()`);
      await new Promise(resolve => setTimeout(resolve, 120));
      await win.webContents.executeJavaScript(`(()=>{const mode=document.querySelector('[data-codex-block-controls] select');mode.value='text';mode.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    for (const width of [1440, 720]) {
      win.setSize(width, 1000); await new Promise(resolve => setTimeout(resolve, 200));
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      if (await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth + 1')) throw Error(`${surface} horizontal page overflow at ${width}`);
      fs.writeFileSync(path.join(temp, `${surface}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      if (surface === 'presentation') {
        await win.webContents.executeJavaScript(`(()=>{const summary=[...document.querySelectorAll('summary')].find(node=>node.textContent==='Ambientación local');summary.parentElement.open=true;summary.scrollIntoView({block:'start'});})()`);
        await new Promise(resolve => setTimeout(resolve, 180));
        fs.writeFileSync(path.join(temp, `soundtrack-${width}.png`), (await win.webContents.capturePage()).toPNG());
        const normal = await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('button[type="submit"]'),s=getComputedStyle(b);b.scrollIntoView({block:'center'});return{color:s.color,background:s.backgroundColor,disabled:b.disabled}})()`);
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const target = await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('button[type="submit"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target });
        await new Promise(resolve => setTimeout(resolve, 150));
        const hover = await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('button[type="submit"]'),s=getComputedStyle(b);return{color:s.color,background:s.backgroundColor,hover:b.matches(':hover')}})()`);
        if (normal.disabled || !hover.hover) throw Error('Expected enabled primary action and actual native hover');
        console.log('Primary action contrast colors ' + JSON.stringify({width,normal,hover}));
        fs.writeFileSync(path.join(temp, `soundtrack-hover-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await win.webContents.executeJavaScript(`document.querySelector('form').closest('[class*="overflow"]').scrollTop=0`);
      }
    }
  }
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`PASS Current-CSS desktop/narrow dictionary, tables, media, wiki, integrated editor, reader and presentation: ${temp}`);
  win.destroy(); await server.close(); app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); if (server) await server.close(); app.exit(1); });
