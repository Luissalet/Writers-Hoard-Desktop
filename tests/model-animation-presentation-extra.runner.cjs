const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),esbuild=require('esbuild');
const {viteCssTextPlugin}=require('../scripts/esbuild-vite-css.cjs');
app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-model-clips-extra-'));
app.setPath('userData',path.join(directory,'profile'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const mode=process.argv[2]??'all';if(!['all','edge','portable','reader'].includes(mode))throw Error('Use all, edge, portable or reader');
 // Generate the normal, ignored standalone runtime before esbuild embeds it.
 await(await import('../scripts/build-model-reader-runtime.mjs')).buildModelReaderRuntime();
 console.log('Current reader runtime sha256='+hash(fs.readFileSync(path.join(root,'src/engines/model-viewer/runtime.generated.txt'))));
 const{build}=await import('vite'),{default:tailwind}=await import('@tailwindcss/vite');
 const built=await build({configFile:false,root,plugins:[tailwind()],logLevel:'error',build:{write:false,minify:false,rollupOptions:{input:path.join(root,'src/index.css')}}});
 const css=built.output.find(item=>item.type==='asset'&&item.fileName.endsWith('.css'));if(!css)throw Error('No current compiled CSS');fs.writeFileSync(path.join(directory,'test.css'),css.source);
 await esbuild.build({stdin:{contents:`
 import{testModelAnimationPresentationEdges}from'./tests/model-animation-presentation-edge.browser.tsx';
 import{testModelAnimationPresentationPortability}from'./tests/model-animation-presentation-portability.browser.ts';
 import{testModelAnimationPresentationReader}from'./tests/model-animation-presentation-reader.browser.ts';
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const request=async(value)=>{
   if(window.__extraRequest)throw Error('Overlapping harness request');
   const token=crypto.randomUUID();window.__extraRequest={...value,token};const until=Date.now()+20000;
   while(Date.now()<until){if(window.__extraAck?.token===token){const reply=window.__extraAck;delete window.__extraAck;return reply.value;}await new Promise(done=>setTimeout(done,20));}
   throw Error('Harness request timed out');
 };
 window.__modelClipsExtraCapture=(name,rect)=>request({kind:'capture',name,rect});
 window.__modelClipsExtraViewport=(width,height)=>request({kind:'viewport',width,height});
 const suites={edge:testModelAnimationPresentationEdges,portable:testModelAnimationPresentationPortability,reader:testModelAnimationPresentationReader};
 (async()=>{const results=[];for(const[name,run]of Object.entries(suites)){if(${JSON.stringify(mode)}!=='all'&&${JSON.stringify(mode)}!==name)continue;console.log('START '+name);const tests=await run();for(const text of tests)console.log('PASS '+name+': '+text);results.push({name,tests});}window.__result={ok:true,results};})().catch(error=>window.__result={ok:false,error:error.stack||String(error)});
 `,resolveDir:root},bundle:true,platform:'browser',format:'iife',target:'chrome130',jsx:'automatic',outfile:path.join(directory,'test.js'),alias:{'@':path.join(root,'src')},loader:{'.css':'empty','.txt':'text'},plugins:[viteCssTextPlugin()],define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.url':'"file:///model-clips-extra.js"'},logLevel:'warning'});
 fs.writeFileSync(path.join(directory,'test.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
 await app.whenReady();const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.setContentSize(1280,1000);
 const requests=[];win.webContents.session.enableNetworkEmulation({offline:true});
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/i.test(details.url)){requests.push(details.url);callback({cancel:true});}else callback({});});
 win.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);else if(/^(START|PASS) /.test(details.message))console.log(details.message);});
 win.webContents.on('render-process-gone',(_event,details)=>{console.error('Renderer exited '+details.reason);app.exit(1);});
 console.log('Artifacts: '+directory);await win.loadFile(path.join(directory,'test.html'));
 const captures=[],deadline=Date.now()+240000;let outcome;
 while(Date.now()<deadline){
   const state=await win.webContents.executeJavaScript('({request:window.__extraRequest??null,result:window.__result??null})');
   if(state.request){const request=state.request;let value;
     if(request.kind==='viewport'){
       if(!Number.isInteger(request.width)||request.width<320||request.width>1920||request.height!==1000)throw Error('Invalid viewport request');
       win.setContentSize(request.width,request.height);await win.webContents.executeJavaScript('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');value={width:request.width,height:request.height};
     }else if(request.kind==='capture'){
       if(!/^[a-z0-9-]+$/.test(request.name))throw Error('Invalid capture name');
       await win.webContents.executeJavaScript('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
       const dom=await win.webContents.executeJavaScript(`(()=>{
         const root=document.getElementById('root'),select=root?.querySelector('[data-testid="model-animation"]'),input=root?.querySelector('[aria-label="Animation label"]');
         return{viewport:{width:innerWidth,height:innerHeight},ready:!!root?.textContent.includes('Model ready'),loading:!!root?.textContent.includes('Loading model'),selectedSourceIndex:select?Number(select.value):null,options:select?[...select.options].map(item=>({index:Number(item.value),label:item.textContent})):[],form:{label:input?.value??null,disabled:input?.disabled??null,alerts:[...root?.querySelectorAll('[role="alert"]')??[]].map(item=>item.textContent)},canvases:[...root?.querySelectorAll('canvas')??[]].map(item=>({width:item.width,height:item.height})),frames:[...document.querySelectorAll('iframe')].map(frame=>({ready:frame.contentDocument?.querySelector('[data-model-status]')?.textContent,selected:frame.contentDocument?.querySelector('[data-model-action="animation"]')?.value}))};
       })()`);
       const image=await win.webContents.capturePage(request.rect),png=image.toPNG(),bitmap=image.toBitmap();let markerPixels=0;
       for(let i=0;i<bitmap.length;i+=4){const b=bitmap[i],g=bitmap[i+1],r=bitmap[i+2];if(r>130&&r>g*1.35&&g>b*1.1)markerPixels++;}
       value={sha256:hash(png),...image.getSize(),markerPixels};fs.writeFileSync(path.join(directory,request.name+'.png'),png);fs.writeFileSync(path.join(directory,request.name+'.json'),JSON.stringify({name:request.name,kind:request.rect?'crop':'full',rect:request.rect??null,dom,receipt:value},null,2)+'\n');captures.push({name:request.name,dom,...value});console.log('CAPTURE '+request.name+' '+JSON.stringify({dom,...value}));
     }else throw Error('Unknown harness request');
     await win.webContents.executeJavaScript('delete window.__extraRequest;window.__extraAck='+JSON.stringify({token:request.token,value}));
   }
   if(state.result){outcome=state.result;break;}await delay(25);
 }
 fs.writeFileSync(path.join(directory,'outcome.json'),JSON.stringify({mode,outcome:outcome??null,captures,httpRequests:requests},null,2)+'\n');
 if(!outcome?.ok)throw Error(outcome?.error??'Extra clips suite timed out');if(requests.length)throw Error('Unexpected HTTP requests: '+requests.join(','));
 console.log('Completed '+outcome.results.length+' extra suites');app.exit(0);
}
main().catch(error=>{console.error(error.stack||error);app.exit(1);});
