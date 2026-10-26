// Run with Node; each case gets a fresh hidden Electron profile and an actual child exit code.
if(!process.versions.electron){const {spawn}=require('node:child_process'),electron=require('electron');(async()=>{for(const mode of process.argv.length>2?process.argv.slice(2):['contract','ui','advanced','worker','portable']){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(electron,[__filename,mode],{env,windowsHide:true,stdio:'inherit'});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(signal?1:code));});if(code!==0){process.exitCode=1;return;}}})().catch(error=>{console.error(error);process.exitCode=1;});}else{
// Shipping HTTP scale regression. Existing Vite only; starts no application server.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const mode=process.argv[2]||'contract';assert(['contract','ui','advanced','worker','portable'].includes(mode));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'writers-scale-author-'));
app.setPath('userData',path.join(directory,'profile'));app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.on('window-all-closed',()=>{});
const target=new URL('/tests/worldgen-scale-http.html',process.env.WH_TEST_BASE_URL||'http://127.0.0.1:63395');target.searchParams.set('case',mode);
const receipt={directory,mode,url:target.href,requests:[],console:[],attribution:'Shipping scale regression: actual dispatcher/normal WorldgenEngine via existing Vite in fresh private Electron profile. No mocked handler/terrain/onGenerate or app server. This is not Root Brave QA.'};let win;

const write=()=>fs.writeFileSync(path.join(directory,'RESULT.json'),JSON.stringify(receipt,null,2));
let timer;const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Actual harness deadline')),180000);});
async function main(){await app.whenReady();win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});win.removeMenu();
 win.webContents.session.webRequest.onBeforeRequest((details,done)=>{const url=new URL(details.url),allowed=['data:','blob:'].includes(url.protocol)||(['http:','ws:'].includes(url.protocol)&&url.hostname===target.hostname&&url.port===target.port);receipt.requests.push({url:url.origin+url.pathname,type:details.resourceType,blocked:!allowed});done({cancel:!allowed});});
 win.webContents.on('console-message',details=>{receipt.console.push({level:details.level,message:details.message});});
 await win.loadURL(target.href);
 while(true){const result=await win.webContents.executeJavaScript('window.__result??null');if(result){receipt.result=result;receipt.ok=result.ok;receipt.body=await win.webContents.executeJavaScript('document.body.innerText.slice(0,5000)');break;}await new Promise(resolve=>setTimeout(resolve,100));}
 // Tests cleanup in finally; query all main QA tables only in this own empty profile.
 receipt.cleanup=await win.webContents.executeJavaScript(`(async()=>{const {db}=await import('/src/db');const names=['projects','generatedWorlds','worldWaypoints','writings','codexEntries','worldEraVariants','worldEraAssets','documentArchives','documentHistory'];const counts={};for(const name of names)counts[name]=await db.table(name).count();return{ownEmptyProfile:true,counts};})()`);
 assert(Object.values(receipt.cleanup.counts).every(value=>value===0),'Own fixture cleanup failed');
}
Promise.race([main(),limit]).catch(error=>{receipt.ok=false;receipt.harnessError=error.stack;}).then(()=>{clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();receipt.windowDestroyed=!win||win.isDestroyed();write();console.log(JSON.stringify({directory,mode,ok:receipt.ok,result:receipt.result,harnessError:receipt.harnessError,cleanup:receipt.cleanup,blocked:receipt.requests.filter(row=>row.blocked).length}));app.exit(receipt.ok?0:1);});

}
