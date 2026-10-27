// Reuses Native load/cleanup interfaces; always existing-Vite dev QA, never dist.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ORIGIN='http://127.0.0.1:63395',QA='/tests/local-runtime-packages-native/index.html';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(v=>{const p=path.join(dir,v.name);return v.isDirectory()?(v.name==='runs'?[]:walk(p)):[p];});
exports.collectPaths=root=>[...walk(path.join(root,'src')),...walk(path.join(root,'electron')),...walk(__dirname),...['package.json','package-lock.json','vite.config.ts','tsconfig.app.json','tsconfig.json','tsconfig.node.json','tests/local-app-host.native.cjs','tests/local-app-host.native.run.cjs','tests/local-runtime-format.mjs'].map(p=>path.join(root,p))];
exports.production={claim:'Dev entry, normal product loader. No production claim.'};exports.suppressKnownRemote=()=>false;
exports.loadQA=async win=>{await win.loadURL(ORIGIN+QA);for(let i=0;i<1200;i++){if(await win.webContents.executeJavaScript('window.__peer59Ready===true'))return;await new Promise(r=>setTimeout(r,25));}throw Error('Private peer entry not ready');};
exports.load=exports.loadQA;
exports.emergencyCleanup=async(win,root)=>{const p=path.join(process.env.RUNTIME59_SHARED_DIRECTORY,'TRANSFER.json'),value=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)).fixture:null;await exports.loadQA(win);if(value)return win.webContents.executeJavaScript('window.__peer59.cleanup('+JSON.stringify(value)+')');const tableCounts=await win.webContents.executeJavaScript('window.__runtime59QA.counts()');return{tableCounts,allTablesEmpty:Object.values(tableCounts).every(v=>v===0),noFixtureCreated:true};};
