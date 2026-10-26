// Run with Node. Uses an already-running Vite URL, a fresh private profile and
// external-network denial; starts no app/server and downloads no model weights.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const electron=require('electron');
if(typeof electron==='string'){
 const {spawn}=require('node:child_process'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'writers-entity-no-model-')),log=path.join(directory,'process.log'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,[__filename,'--output',directory],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>fs.appendFileSync(log,b));child.stderr.on('data',b=>fs.appendFileSync(log,b));
 console.log(JSON.stringify({pid:child.pid,directory,log,windowsHide:true}));
 const timer=setTimeout(()=>{fs.appendFileSync(log,'\nPARENT_WATCHDOG_300S\n');child.kill();},300000);
 child.once('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});
 child.once('close',(code,signal)=>{clearTimeout(timer);const file=path.join(directory,'RESULT.json'),result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{ok:false,error:'Missing child result'};console.log(JSON.stringify({code,signal,directory,ok:result.ok,result:result.result,error:result.error,requests:result.requests?.length,attribution:result.attribution}));process.exitCode=code===0&&signal===null&&result.ok?0:1;});
}else{
 const {app,BrowserWindow}=electron,index=process.argv.indexOf('--output'),directory=path.resolve(process.argv[index+1]||'');
 if(index<0||!directory.startsWith(path.join(os.tmpdir(),'writers-entity-no-model-'))||!fs.statSync(directory).isDirectory())throw Error('Expected launcher-owned temporary output');
 app.setPath('userData',path.join(directory,'profile'));app.disableHardwareAcceleration();
 const base=new URL(process.env.WH_TEST_BASE_URL||'http://127.0.0.1:63395');
 if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Expected existing loopback Vite URL');
 const requests=[],consoleMessages=[],phases=[];let win;
 const save=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
 const phase=value=>{phases.push(value);save('PHASE.json',{phase:value,phases,time:new Date().toISOString()});};
 function deadline(promise,label,ms=30000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' deadline')),ms);})]).finally(()=>clearTimeout(timer));}
 async function main(){
  phase('created');try{
   await deadline(app.whenReady(),'app-ready');
   win=new BrowserWindow({show:false,useContentSize:true,width:1280,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.removeMenu();
   win.webContents.on('console-message',details=>{const row={level:details.level,message:details.message};consoleMessages.push(row);fs.appendFileSync(path.join(directory,'CONSOLE.ndjson'),JSON.stringify(row)+'\n');});
   win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url),local=['http:','https:','ws:','wss:'].includes(url.protocol)&&url.hostname===base.hostname&&url.port===base.port,allowed=local||['blob:','data:'].includes(url.protocol);requests.push({url:details.url,type:details.resourceType,blocked:!allowed});callback({cancel:!allowed});});
   await deadline(win.loadURL(new URL('/tests/entity-detection-browser.no-model.html',base).href),'load-url',90000);
   const until=Date.now()+180000;
   while(Date.now()<until){const state=await deadline(win.webContents.executeJavaScript('({stage:window.__probeStage??null,result:window.__probeResult??null})'),'renderer-read');save('STATE.json',state);if(state.stage&&phases.at(-1)!==state.stage){phase(state.stage);console.log('STAGE '+state.stage);}if(state.result){if(!state.result.ok)throw Error(JSON.stringify(state.result));if(requests.some(row=>row.blocked))throw Error('External request during no-model test');save('RESULT.json',{...state.result,directory,baseURL:base.origin,requests,consoleMessages,phases});return;}await new Promise(resolve=>setTimeout(resolve,50));}
   throw Error('No-model renderer deadline');
  }catch(error){save('RESULT.json',{ok:false,error:error.stack||String(error),directory,requests,consoleMessages,phases});throw error;}
  finally{if(win&&!win.isDestroyed())win.destroy();}
 }
 main().then(()=>app.exit(0)).catch(error=>{console.error(error.stack||String(error));app.exit(1);});
}
