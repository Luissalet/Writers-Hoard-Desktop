// Full Vite renderer, isolated profile, real project panels and actual stylesheet.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-editorial-ui-'));
app.setPath('userData', path.join(directory, 'profile'));
let server;
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`(async () => {
    const {db} = await import('/src/db/index.ts');
    const {useLocaleStore} = await import('/src/stores/localeStore.ts');
    await useLocaleStore.getState().setLocale('es');
    await db.projects.put({id:'editorial-ui',title:'Investigación del transporte local',description:'Fuentes, voces y contexto de un reportaje.',mode:'reporter',type:'standalone',color:'#b48b4e',status:'draft',enabledEngines:['writings','notes','scrapper'],engineOrder:['writings','notes','scrapper'],createdAt:1,updatedAt:1,
      editorialProfile:{enabled:true,voice:'Precisa, cercana y basada en detalles concretos.',audience:'Lectores del barrio.',rules:'Conservar las citas textuales y atribuir las declaraciones.',context:'Investigar los cambios de horario. Las hipótesis todavía no son hechos.',examples:'',revision:1}});
    await db.citations.put({id:'editorial-source',projectId:'editorial-ui',title:'Acta pública del servicio de transporte',authors:['Ayuntamiento'],accessedAt:'2026-09-07',url:'https://example.com/acta',writingIds:[],tags:[],createdAt:1,updatedAt:1,researchEvidence:[{id:'editorial-evidence',statement:'El servicio empieza a las seis.',kind:'attribution',quote:'El primer servicio saldrá a las 06:00.',locator:'Página 3',status:'pending',notes:'Contrastar con el horario vigente.',createdAt:1,updatedAt:1}]});
    const {createWritingWorkflow,saveWritingWorkflow} = await import('/src/services/writingWorkflows.ts');
    const flow = await createWritingWorkflow('editorial-ui','reportage','Horarios y acceso al transporte','es');
    flow.steps[0].output = '¿Cómo afectan los nuevos horarios a quienes trabajan antes de las siete?';
    flow.materials = [{kind:'citation',id:'editorial-source'}];
    await saveWritingWorkflow('editorial-ui', flow);
  })()`);
  for (const width of [1280, 760]) {
    win.setContentSize(width, 1000);
    for (const panel of ['ai', 'research', 'workflows']) {
      await win.loadURL(`${url}#/project/editorial-ui/overview?panel=${panel}`);
      const deadline = Date.now() + 15000;
      const expected = { ai: 'Voz y contexto', research: 'Afirmaciones', workflows: 'Del material al texto' }[panel];
      while (!await win.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(expected)})`)) {
        if (Date.now() > deadline) throw new Error(`Missing panel ${panel}: ` + await win.webContents.executeJavaScript('document.body.innerText.slice(0,2000)'));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (panel === 'workflows') {
        await win.webContents.executeJavaScript(`(() => { const label = [...document.querySelectorAll('label')].find(row => row.textContent.includes('Continuar un proceso')); const select = label?.querySelector('select'); if (select?.options[1]) { select.value = select.options[1].value; select.dispatchEvent(new Event('change', {bubbles:true})); } })()`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      const overflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth');
      if (overflow) throw new Error(`Horizontal overflow ${width}/${panel}`);
      const file = path.join(directory, `${panel}-${width}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      console.log(`SCREENSHOT ${file}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS full renderer, three editorial panels, two widths, no console errors or document overflow');
  await server.close();
  app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
