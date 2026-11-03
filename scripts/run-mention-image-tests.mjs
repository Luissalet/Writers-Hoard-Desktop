import {build,stop} from 'esbuild';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),label=process.argv[2];
if(!/^[a-z0-9-]+$/.test(label??''))throw Error('Fresh label required');
const require=createRequire(import.meta.url);const {viteCssTextPlugin}=require('./esbuild-vite-css.cjs');
const out=join(root,'_stage/mention-image2028/runs',label);mkdirSync(out,{recursive:true});
try{await build({stdin:{contents:`import {testCodexMentionImage} from './tests/codex-mention-image.browser.ts'; import {testCodexMentionImageIntegration} from './tests/codex-mention-image.integration.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT=true; (async()=>[...await testCodexMentionImageIntegration(),...await testCodexMentionImage()])().then(tests=>window.__result={ok:true,tests,cleanup:window.__mentionImageCleanup??null}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});`,resolveDir:root},bundle:true,platform:'browser',format:'iife',target:'chrome130',outfile:join(out,'test.js'),alias:{'@':join(root,'src')},loader:{'.css':'empty'},plugins:[viteCssTextPlugin()],jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.url':'"file:///mention-image-test.js"'},logLevel:'warning'});}finally{stop();}
writeFileSync(join(out,'test.html'),'<meta charset="utf-8"><body><script src="test.js"></script></body>');
writeFileSync(join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron'),fs=require('node:fs');app.setPath('userData',${JSON.stringify(join(out,'profile'))});app.commandLine.appendSwitch('use-angle','swiftshader');app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{let win,timer,result;try{win=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});await win.loadFile(${JSON.stringify(join(out,'test.html'))});result=await Promise.race([(async()=>{for(;;){const r=await win.webContents.executeJavaScript('window.__result??null');if(r)return r;await new Promise(r=>setTimeout(r,30));}})(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Timeout')),60000))]);}catch(error){result={ok:false,error:String(error.stack||error)}}finally{clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();result.windowDestroyed=!win||win.isDestroyed();fs.writeFileSync(${JSON.stringify(join(out,'RESULT.json'))},JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.ok?0:1)}});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[join(out,'main.cjs')],{cwd:root,env,windowsHide:true,stdio:'inherit'});
const code=await new Promise((res,rej)=>{child.on('error',rej);child.on('close',res)});
const result=JSON.parse(readFileSync(join(out,'RESULT.json'),'utf8'));process.exitCode=code===0&&result.ok&&result.windowDestroyed?0:1;
