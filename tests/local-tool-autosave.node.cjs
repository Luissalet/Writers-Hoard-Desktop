// The regular area command uses real IndexedDB/Source in a new hidden Electron profile.
const cp=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=cp.spawnSync(require('electron'),['scripts/run-focused-browser-tests.cjs','tests/local-tool-autosave.browser.ts','testAutosaveSource','60000'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
assert.equal(result.error,undefined);assert.equal(result.status,0,'Autosave Source controls failed');assert(!result.signal);assert((result.stdout.match(/^PASS /gm)??[]).length>=53,'The agreed Source controls must execute');
