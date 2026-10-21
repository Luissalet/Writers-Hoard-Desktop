const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wh-model-reader-'));
const output=process.env.MODEL_READER_EVIDENCE||temp;fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(temp,'profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  await (await import('../scripts/build-model-reader-runtime.mjs')).buildModelReaderRuntime();
  await esbuild.build({stdin:{contents:"import {testModelReader} from './tests/model-reader.browser.ts'; globalThis.IS_REACT_ACT_ENVIRONMENT=true; testModelReader().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});",resolveDir:root},bundle:true,platform:'browser',format:'iife',target:'chrome130',jsx:'automatic',outfile:path.join(temp,'test.js'),alias:{'@':path.join(root,'src')},loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.url':'"file:///model-reader-qa.js"'},logLevel:'warning'});
  const cssDir=path.join(root,'dist/assets'),css=fs.readdirSync(cssDir).filter(name=>/^main-.*\.css$/.test(name)).map(name=>'<link rel="stylesheet" href="'+require('node:url').pathToFileURL(path.join(cssDir,name)).href+'">').join('');
  fs.writeFileSync(path.join(temp,'test.html'),'<html><head><meta charset="utf-8">'+css+'</head><body><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const errors=[],requests=[];
  win.webContents.on('console-message',details=>{if(details.level==='error'){errors.push(details.message);console.error(details.message);}});
  win.webContents.session.enableNetworkEmulation({offline:true});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/i.test(details.url)){requests.push(details.url);callback({cancel:true});}else callback({});});
  await win.loadFile(path.join(temp,'test.html'));
  let result;for(let n=0;n<1200;n++){result=await win.webContents.executeJavaScript('window.__result??null');if(result)break;await delay(50);}
  if(!result?.ok)throw new Error(result?.error||'Source model Reader suite timed out');
  result.tests.forEach(test=>console.log('PASS '+test));
  const artifacts=await win.webContents.executeJavaScript('window.__modelReaderArtifacts');
  const evidence=[];
  for(const era of [false,true]){await win.webContents.executeJavaScript('__modelReaderShowNormal('+era+')');for(const [size,width,height]of [['desktop',1280,1000],['narrow',940,1000]]){win.setContentSize(width,height);await delay(180);fs.writeFileSync(path.join(output,'normal-reader-'+(era?'era':'base')+'-'+size+'.png'),(await win.webContents.capturePage()).toPNG());}}
  const js=code=>win.webContents.executeJavaScript(code);
  async function ready(){for(let n=0;n<200;n++){if(await js(`document.querySelector('[data-model-status]')?.textContent==='Model ready'`))return;await delay(30);}throw new Error('Standalone model not ready: '+await js(`document.querySelector('[data-model-status]')?.textContent`));}
  async function action(name){await js(`document.querySelector('[data-model-action="${name}"]').click()`);await delay(80);}
  async function bitmap(){const r=await js(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:Math.max(0,Math.ceil(r.x)),y:Math.max(0,Math.ceil(r.y)),width:Math.floor(r.width)-1,height:Math.floor(r.height)-1}})()`);return(await win.webContents.capturePage(r)).toBitmap();}
  const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  for(const artifact of artifacts){
    const file=path.join(output,artifact.name+'.html');fs.writeFileSync(file,artifact.html);await win.loadFile(file);
    await js(`document.querySelector('[data-wh-model-reader]').scrollIntoView({block:'center'})`);await ready();await delay(120);
    const embedded=await js(`JSON.parse(document.querySelector('template[data-wh-model-data]').content.textContent).dataUrl`);
    if(embedded!==artifact.dataUrl)throw new Error('Saved file GLB byte mismatch');
    const initial=hash(await bitmap());const orbit=await js(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...orbit});win.webContents.sendInputEvent({type:'mouseDown',...orbit,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:orbit.x+70,y:orbit.y+20,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:orbit.x+70,y:orbit.y+20,button:'left',clickCount:1});await delay(100);if(hash(await bitmap())===initial)throw new Error('Pointer orbit did not change geometry pixels');await action('reset');await action('rotate-left');const rotated=hash(await bitmap());if(rotated===initial)throw new Error('Rotate did not change genuine model pixels');
    await action('reset');if(hash(await bitmap())!==initial)throw new Error('Reset did not restore framing pixels');
    await action('play');const animationA=hash(await bitmap());await delay(400);const animationB=hash(await bitmap());if(animationA===animationB)throw new Error('Animation time did not change rendered geometry');await action('play');
    const paused=hash(await bitmap());await delay(200);if(hash(await bitmap())!==paused)throw new Error('Paused animation continued');
    await action('autorotate');const autoA=hash(await bitmap());await delay(300);if(hash(await bitmap())===autoA)throw new Error('Autorotation did not change model pixels');
    await js(`window.__modelFrames=0;window.__modelRAF=requestAnimationFrame;window.requestAnimationFrame=callback=>{window.__modelFrames++;return window.__modelRAF(callback)};document.querySelector('[data-wh-model-reader]').parentElement.hidden=true`);await delay(100);const stopped=await js('window.__modelFrames');await delay(180);if(await js('window.__modelFrames')!==stopped)throw new Error('Hidden model kept scheduling frames');
    await js(`document.querySelector('[data-wh-model-reader]').parentElement.hidden=false`);await delay(150);if(await js('window.__modelFrames')===stopped)throw new Error('Visible model did not resume');
    await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`);await delay(80);const background=await js('window.__modelFrames');await delay(160);if(await js('window.__modelFrames')!==background)throw new Error('Background document kept animating');
    await js(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);await action('autorotate');await action('reset');
    for(const [size,width,height]of [['desktop',1280,1000],['narrow',390,1100]]){
      win.setContentSize(width,height);await js(`document.querySelector('[data-wh-model-reader]').scrollIntoView({block:'center'})`);await delay(160);
      if(await js('document.documentElement.scrollWidth>innerWidth'))throw new Error(artifact.name+' '+size+' overflow');
      fs.writeFileSync(path.join(output,artifact.name+'-'+size+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    if(artifact.name==='reader-base'){
      await js(`document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}))`);await delay(40);
      if(!await js(`document.querySelector('[data-model-action="retry"]')&&!document.querySelector('canvas')`))throw new Error('Context loss not recoverable');
      await js(`window.__modelGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:window.__modelGetContext.call(this,kind,...args)};void 0`);await action('retry');
      if(!await js(`document.querySelector('[data-model-status]').textContent.includes('could not start WebGL')`))throw new Error('WebGL unavailable fallback absent');
      await js('HTMLCanvasElement.prototype.getContext=window.__modelGetContext;void 0');await action('retry');await ready();
    }
    await js(`window.__modelGL=document.querySelector('canvas').getContext('webgl2');document.querySelector('[data-wh-model-reader]').remove()`);await delay(80);
    if(!await js('window.__modelGL.isContextLost()'))throw new Error('Removed standalone model leaked context');
    const glb=Buffer.from(artifact.dataUrl.split(',')[1],'base64');
    evidence.push({file:artifact.name+'.html',glbBytes:glb.length,glbSha256:hash(glb),rotated:true,reset:true,animation:true,pause:true,autorotate:true,hiddenPause:true,documentPause:true,disposed:true});
    console.log('PASS standalone '+artifact.name+' orbit/reset/animation/visibility/dispose desktop+narrow');
  }
  if(requests.length)throw new Error('Unexpected HTTP requests: '+requests.join(','));
  const expectedErrors=errors.filter(message=>!message.includes('Error creating WebGL context'));
  if(expectedErrors.length)throw new Error('Unexpected console errors: '+expectedErrors.join('\n'));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({source:result.tests,artifacts:evidence,httpRequests:requests,expectedWebglFailure:errors},null,2));
  console.log('Evidence: '+output);win.destroy();app.exit(0);
}
main().catch(error=>{console.error(error.stack||error);app.exit(1);});
