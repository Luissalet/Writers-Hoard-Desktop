import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build, stop } from 'esbuild';

// Hidden Chromium with page-focus emulation; never focuses a visible OS window.
// The private profile and deferred start keep the user's library untouched.
const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'wh-editor-table-context-'));
const require = createRequire(import.meta.url);
const { viteCssTextPlugin } = require('./esbuild-vite-css.cjs');
try {
  await build({
    stdin: {
      contents: `import {testEditorTableContext as run} from './tests/editor-table-context.browser.tsx';
        globalThis.IS_REACT_ACT_ENVIRONMENT=true;
        window.__startTableTest=()=>run().then(tests=>window.__result={ok:true,tests,cleanup:window.__tableContextCleanup??null})
          .catch(error=>window.__result={ok:false,error:error.stack||String(error),cleanup:window.__tableContextCleanup??null});`,
      resolveDir: root,
    },
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic',
    outfile: join(directory, 'test.js'), alias: { '@': join(root, 'src') },
    loader: { '.css': 'empty' }, plugins: [viteCssTextPlugin()],
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///editor-table-context.js"' },
    logLevel: 'warning',
  });
} finally { stop(); }
writeFileSync(join(directory, 'test.html'), '<!doctype html><meta charset="utf-8"><script src="test.js"></script>');
writeFileSync(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron'),fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.commandLine.appendSwitch('use-angle','swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let win,result={ok:false},timer;
 try{
  win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message)});
  const execute=async()=>{
   await win.loadFile(${JSON.stringify(join(directory, 'test.html'))});
   win.webContents.debugger.attach('1.3');
   await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
   if(!await win.webContents.executeJavaScript('document.hasFocus()'))throw Error('Offscreen page-focus health failed; test not started');
   await win.webContents.executeJavaScript('void window.__startTableTest()');
   for(;;){
    const value=await win.webContents.executeJavaScript('window.__result??null');
    if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,40));
   }
  };
  result=await Promise.race([execute(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Table context tests timed out after90s')),90000)})]);
 }catch(error){result={ok:false,error:error.stack||String(error)}}
 finally{
  clearTimeout(timer);
  result.focusSetup='Hidden Electron/CDP page-focus emulation; synthetic keyboard, no OS focus or physical input claim';
  if(win&&!win.isDestroyed())win.destroy();
  result.windowDestroyed=!win||win.isDestroyed();
  fs.writeFileSync(${JSON.stringify(join(directory, 'result.json'))},JSON.stringify(result,null,2));
  if(result.ok)for(const test of result.tests)console.log('PASS '+test);
  else console.error(result.error);
  console.log('TABLE_CONTEXT_RESULT '+JSON.stringify(result));
  app.exit(result.ok?0:1);
 }
}).catch(error=>{console.error(error.stack||String(error));app.exit(1)});
`);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [join(directory, 'main.cjs')], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit' });
const timeout = setTimeout(() => { child.kill(); }, 110000);
try {
  const code = await new Promise((resolveChild, reject) => { child.on('error', reject); child.on('close', resolveChild); });
  const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
  process.exitCode = code === 0 && result.ok && result.windowDestroyed ? 0 : 1;
} finally { clearTimeout(timeout); }
