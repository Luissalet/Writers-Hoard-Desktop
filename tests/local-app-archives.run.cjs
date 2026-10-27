'use strict';
// Four normal Source archive JSON controls; no mounted Host/Surface attribution.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),label=process.argv[2];
if(!/^[a-z][a-z0-9-]{0,63}$/.test(label||''))throw Error('Use a fresh own label.');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'writers-app-archives-'+label+'-'));
const files=[...fs.readdirSync(path.join(root,'src/engines/local/apps')).filter(name=>/\.(ts|tsx)$/.test(name)).map(name=>'src/engines/local/apps/'+name),...['sdk.ts','registry.tsx','bootstrap.ts','definitions.ts','releases.ts','bridge.ts','manifest.ts','documents/LocalToolDocumentHost.tsx','documents/SourceToolWorkspace.tsx','assetBrowser.ts'].map(name=>'src/engines/local/'+name),'src/engines/writings/readerSource.ts','src/services/worldWikiExport.ts','src/db/operations.ts','src/engines/local/documents/archivePortability.ts','tests/local-app-archives.browser.ts','tests/local-app-archives.run.cjs','scripts/run-focused-browser-tests.cjs'];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const inputs=files.map(file=>({path:file,sha256:hash(file)})),startUtc=new Date().toISOString();
fs.writeFileSync(path.join(output,'INPUTS.json'),JSON.stringify(inputs,null,2));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require(path.join(root,'node_modules/electron')),['scripts/run-focused-browser-tests.cjs','tests/local-app-archives.browser.ts','testLocalAppArchives','60000'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
child.on('error',error=>{stderr+='\n'+String(error);});
child.on('close',(code,signal)=>{
 fs.writeFileSync(path.join(output,'stdout.log'),stdout);fs.writeFileSync(path.join(output,'stderr.log'),stderr);
 const after=inputs.map(row=>({...row,afterSha256:hash(row.path)})),same=after.every(row=>row.sha256===row.afterSha256);
 const result={label,startUtc,endUtc:new Date().toISOString(),childPid:child.pid,childExitCode:code,signal,sourceUnchanged:same,guard:'SDK files listed in INPUTS only; no full-repository attribution',ok:code===0&&same,cases:4,attribution:'Source archive JSON clone, legacy absence, invalid-scope rejection and outer rollback; no mounted UI, Native or Brave',output};
 fs.writeFileSync(path.join(output,'SOURCE-AFTER.json'),JSON.stringify(after,null,2));fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
});
