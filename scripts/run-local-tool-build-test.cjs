// A real Vite transform of an isolated copied SDK and a freshly scaffolded
// local module. The application's installed directory remains empty.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'),temporary=sync.mkdtempSync(path.join(os.tmpdir(),'wh-sdk-build-'));
app.setPath('userData',path.join(temporary,'profile'));app.commandLine.appendSwitch('disable-gpu');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const {createLocalToolScaffold}=await import('./create-local-tool.mjs'),{build}=await import('vite');
  await fs.cp(path.join(root,'src/engines/local'),path.join(temporary,'src/engines/local'),{recursive:true});
  const generated=await createLocalToolScaffold({rootDir:temporary,namespace:'tests.compiled',name:'Compiled notebook'});
  const source=await fs.readFile(generated.modulePath,'utf8');await fs.writeFile(generated.modulePath,"Reflect.set(globalThis,'__syntheticSdkLoads',Number(Reflect.get(globalThis,'__syntheticSdkLoads')??0)+1);\n"+source);
  await fs.writeFile(path.join(temporary,'tsconfig.json'),JSON.stringify({compilerOptions:{jsx:'react-jsx',target:'ES2022',module:'ESNext'}}));
  await fs.writeFile(path.join(temporary,'index.html'),'<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  await fs.writeFile(path.join(temporary,'entry.tsx'),`
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {getEngine} from '@/engines/_registry';
const assert=(value,message)=>{if(!value)throw new Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
const P='isolated-sdk-build';
async function run(){
 await db.projects.put({id:P,title:'Isolated source fixture',description:'',mode:'custom',type:'standalone',status:'draft',color:'#000',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1});
 const {registerInstalledLocalTools}=await import('./src/engines/local/bootstrap');
 const registered=registerInstalledLocalTools();assert(registered.length===1&&Reflect.get(globalThis,'__syntheticSdkLoads')===1,'Real Vite eager glob did not load exactly the installed synthetic module');
 assert((await db.projects.get(P)).enabledEngines.join(',')==='codex','Registration enabled a project tool');
 const Component=getEngine('local-tool-tests.compiled')?.component;assert(Component,'Compiled local engine is missing');const root=createRoot(document.getElementById('root'));root.render(<Component projectId={P}/>);
 for(let i=0;i<100;i++){if(document.querySelector('textarea')&&!document.querySelector('textarea').disabled)break;await pause();}
 const input=document.querySelector('textarea');assert(input&&!input.disabled,'Actual scaffold did not load local state');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Actual compiled source works');input.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 [...document.querySelectorAll('button')].find(button=>button.textContent==='Save locally').click();
 let saved=false;for(let i=0;i<100;i++){if((await db.projects.get(P)).localToolStates?.['tests.compiled']?.data.notes==='Actual compiled source works'){saved=true;break;}await pause();}assert(saved,'Actual scaffold Save did not persist scoped data');
 assert(typeof Reflect.get(globalThis,'__sdkInjected')==='undefined','Unexpected script execution');root.unmount();await db.projects.delete(P);
 return ['SDK real Vite build: explicit generated module enters eager glob once; registration leaves project enablement unchanged','SDK real scaffold component: compiled UI reads and saves scoped state without a network service'];
}
run().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});
`);
  await build({configFile:false,root:temporary,base:'./',logLevel:'error',resolve:{alias:{'@':path.join(root,'src'),'react':path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom'),'lucide-react':path.join(root,'node_modules/lucide-react')}},build:{target:'es2022',outDir:path.join(temporary,'dist'),emptyOutDir:true}});
  await app.whenReady();const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}}),requests=[];
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>{requests.push(details.url);done({cancel:true});});
  await win.loadFile(path.join(temporary,'dist/index.html'));let result;
  for(let i=0;i<300;i++){result=await win.webContents.executeJavaScript('window.__result');if(result)break;await pause(100);}
  win.destroy();if(!result?.ok)throw new Error(result?.error||'SDK built UI timed out');if(requests.length)throw new Error('Unexpected network request: '+requests.join(','));for(const message of result.tests)console.log('PASS '+message);
  await pause(250);
}
main().then(async()=>{const absolute=path.resolve(temporary);if(!absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'wh-sdk-build-'))throw new Error('Unsafe test cleanup path');await fs.rm(absolute,{recursive:true,force:true}).catch(()=>{});app.quit();}).catch(error=>{console.error(error.stack||error);app.exit(1);});
