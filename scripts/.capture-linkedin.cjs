// Full Vite renderer, isolated profile, real project panels and actual stylesheet.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = path.resolve('release/linkedin-0.1.1'); fs.mkdirSync(directory,{recursive:true});
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wh-linkedin-')));
let server;
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`(async () => {
    const {db} = await import('/src/db/index.ts');
    const {useLocaleStore} = await import('/src/stores/localeStore.ts');
    await useLocaleStore.getState().setLocale('es');
    await db.projects.put({id:'editorial-ui',title:'Investigación del transporte local',description:'Fuentes, voces y contexto de un reportaje.',mode:'reporter',type:'standalone',color:'#b48b4e',status:'draft',enabledEngines:['writings','notes','scrapper'],engineOrder:['writings','notes','scrapper'],createdAt:1,updatedAt:1,
      editorialProfile:{enabled:true,voice:'Precisa, cercana y basada en detalles concretos.',audience:'Lectores del barrio.',rules:'Conservar las citas textuales y atribuir las declaraciones.',context:'Investigar los cambios de horario. Las hipótesis todavía no son hechos.',examples:'',revision:1}});
    await db.writings.put({id:'demo-writing',projectId:'editorial-ui',title:'Antes de que despierte el barrio',status:'draft',content:'<p>A las cinco y media, la parada de autobús todavía está a oscuras. Alguien mira el reloj; otra persona consulta un horario pegado detrás del cristal.</p><p>Este reportaje parte de una pregunta sencilla: ¿cómo cambia la vida de un barrio cuando cambia su primer autobús?</p><p>Para responder hay que reunir horarios, recorrer la línea y escuchar a quienes la utilizan. Las cifras cuentan una parte. El tiempo que alguien pasa esperando cuenta otra.</p><h2>Lo que falta por comprobar</h2><p>Comparar el horario anunciado con el servicio real. Pedir los datos de frecuencia. Hablar con trabajadores del turno de mañana y dejar constancia de qué procede de un documento y qué es un testimonio.</p>',synopsis:'Borrador de ejemplo: horarios, trayectos y vida cotidiana.',wordCount:120,tags:['movilidad','barrio'],createdAt:1,updatedAt:1});
    await db.citations.put({id:'editorial-source',projectId:'editorial-ui',title:'Acta pública del servicio de transporte',authors:['Ayuntamiento'],accessedAt:'2026-09-07',url:'https://example.com/acta',writingIds:[],tags:[],createdAt:1,updatedAt:1,researchEvidence:[{id:'editorial-evidence',statement:'El servicio empieza a las seis.',kind:'attribution',quote:'El primer servicio saldrá a las 06:00.',locator:'Página 3',status:'pending',notes:'Contrastar con el horario vigente.',createdAt:1,updatedAt:1}]});
    const {createWritingWorkflow,saveWritingWorkflow} = await import('/src/services/writingWorkflows.ts');
    const flow = await createWritingWorkflow('editorial-ui','reportage','Horarios y acceso al transporte','es');
    flow.steps[0].output = '¿Cómo afectan los nuevos horarios a quienes trabajan antes de las siete?';
    flow.materials = [{kind:'citation',id:'editorial-source'}];
    await saveWritingWorkflow('editorial-ui', flow);
  })()`);

  await win.loadURL(url+'#/project/editorial-ui/writings');
  await new Promise(r=>setTimeout(r,3500));
  console.log(await win.webContents.executeJavaScript('document.body.innerText.slice(0,1800)'));
  await win.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll('h3,h2,button')].find(e=>e.textContent.trim()==='Antes de que despierte el barrio');if(!el)throw new Error('Title missing');el.click()})()`);
  await new Promise(r=>setTimeout(r,1800));
  fs.writeFileSync(path.join(directory,'01-escritura.png'),(await win.webContents.capturePage()).toPNG());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS full renderer, three editorial panels, two widths, no console errors or document overflow');
  await server.close();
  app.exit(0);
}
main().catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });

