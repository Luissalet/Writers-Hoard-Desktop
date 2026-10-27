// Adapt the retained shipping Native transport in TMP; never change its original bytes.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXPECTED='e955de469ad1a578f0a8a39116228ed92a04eed6f39bfcbd9e35a4aa07751e14';
exports.prepare=function(root,output){
 const original=path.join(root,'tests/local-app-host.native.cjs'),bytes=fs.readFileSync(original);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==EXPECTED)throw Error('Retained Native harness changed; review adapter before use');
 let source=bytes.toString('utf8');
 function replace(before,after){if(source.split(before).length!==2)throw Error('Native reuse anchor not unique: '+before.slice(0,70));source=source.replace(before,after);}
 replace("require('esbuild')","require("+JSON.stringify(path.join(root,'node_modules/esbuild'))+")");
 replace("const root=path.resolve(__dirname,'..'),label=process.argv[2];","const root="+JSON.stringify(root)+",label=process.argv[2];");
 replace("const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-local-app-native-'+label+'-'));","const directory=process.env.RUNTIME59_PHASE_DIRECTORY; const custom=require("+JSON.stringify(path.join(__dirname,'production.cjs'))+"); const phase=process.env.RUNTIME59_PHASE; if(!['prepare','resume'].includes(phase)||!path.isAbsolute(directory))throw Error('Explicit runtime59 private phase required');");
 replace("app.setPath('userData', path.join(directory, 'profile'));","app.setPath('userData', process.env.RUNTIME59_PROFILE);");
 const start=source.indexOf('const collectPaths=()=>'),end=source.indexOf('\nconst sourcePaths=',start);if(start<0||end<0)throw Error('Native paths anchor absent');
 source=source.slice(0,start)+`const collectPaths=()=>custom.collectPaths(root).sort();`+source.slice(end);
 const dStart=source.indexOf('async function drive(){'),dEnd=source.indexOf('\n(async()=>{',dStart);if(dStart<0||dEnd<0)throw Error('Native driver anchor absent');
 source=source.slice(0,dStart)+`async function drive(){
  try{const outcome=await require(${JSON.stringify(path.join(__dirname,'driver.cjs'))}).drive({root,win,phase,directory,keys,bridge,replies,transcript,checks,production:custom.production,
   startServer:async()=>{await bridge.startAiBridge({version:'private-runtime59-native',hasWindow:()=>true});serverStarted=true;},
   openAdapter:adapter,recordCall:()=>toolCalls++,loadQA:()=>custom.loadQA(win)});
   cleanupReport=outcome.cleanup;rendererCleanup=true;await win.webContents.executeJavaScript('window.__result={ok:true};0');
  }catch(error){failure=scrub(error.stack||error);await win.webContents.executeJavaScript('window.__result='+JSON.stringify({ok:false,error:failure})+';0').catch(()=>{});throw error;}
 }
`+source.slice(dEnd);
 replace("await win.loadURL(new URL('/tests/local-app-host.native.html','http://127.0.0.1:63395').href);","await custom.load(win,{root,phase,directory});");
 replace("win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;","win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(custom.suppressKnownRemote(details)){callback({cancel:true});return;}let allowed=false;");
 const cleanupStart=source.indexOf(' if(win&&!win.isDestroyed()&&!rendererCleanup)'),cleanupEnd=source.indexOf('\n for(const session',cleanupStart);
 if(cleanupStart<0||cleanupEnd<0)throw Error('Native cleanup anchor absent');
 source=source.slice(0,cleanupStart)+` if(win&&!win.isDestroyed()&&!rendererCleanup)try{cleanupReport=await custom.emergencyCleanup(win,root);rendererCleanup=true;}catch(error){errors.push('Renderer cleanup: '+scrub(error));}`+source.slice(cleanupEnd);
 replace("attribution:'Two real MCP stdio keys/Native executor/IPC, private renderer on existing Vite63395. No Brave/downloaded file/global parity claim.'","phase,attribution:phase==='resume'?'Private fresh dev loader/Source Host with two-key shipping Native; no production/Main/Browser claim.':'Two-key shipping Native transport on existing Vite63395; prepare phase deliberately preserves own data for fresh-process resume.'");
 // Original failure path is still recorded and all EOF/revocation/IPC/source guards remain.
 fs.writeFileSync(output,source);return{original,originalSha256:EXPECTED,adaptedSha256:crypto.createHash('sha256').update(source).digest('hex')};
};
