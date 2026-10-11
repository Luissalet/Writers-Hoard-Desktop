import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// Offscreen Chromium supplies real layout and animation frames while keeping
// the user's desktop untouched. A fresh profile never opens their IndexedDB.
const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'wh-editor-advanced-'));
await build({
  stdin: { contents: `import {testAdvancedEditor as run} from './tests/editor-advanced.browser.tsx'; globalThis.IS_REACT_ACT_ENVIRONMENT=true; run().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});`, resolveDir: root },
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic',
  outfile: join(directory, 'test.js'), alias: { '@': join(root, 'src') }, loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///editor-advanced.js"' },
  logLevel: 'warning',
});
writeFileSync(join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="test.js"></script></body></html>');
writeFileSync(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message)});
 win.webContents.on('render-process-gone',(_event,details)=>{console.error('Renderer exited: '+details.reason);app.exit(1)});
 await win.loadFile(${JSON.stringify(join(directory, 'test.html'))});
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  const result=await win.webContents.executeJavaScript('window.__result??null');
  if(result){if(!result.ok)throw Error(result.error);for(const test of result.tests)console.log('PASS '+test);app.exit(0);return;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Advanced editor tests timed out');
}).catch(error=>{console.error(error.stack||String(error));app.exit(1)});
`);
const require = createRequire(import.meta.url);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [join(directory, 'main.cjs')], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit' });
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 150000);
await new Promise((resolveChild, reject) => { child.on('error', reject); child.on('exit', code => { process.exitCode = code ?? 1; resolveChild(); }); });
clearTimeout(timeout);
