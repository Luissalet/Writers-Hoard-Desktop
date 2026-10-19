// Native owner and production service closure, source faults + frozen normal path.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=process.argv[2];
if(!run||!path.isAbsolute(run))throw Error('Pass a new absolute private QA directory');
await fs.mkdir(run,{recursive:false});
const entry=path.join(run,'service.cjs');
await build({entryPoints:[path.join(root,'electron/publishing/service.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',logLevel:'warning'});
const {PublishingService}=createRequire(import.meta.url)(entry);
process.env.HOARD_EVENTS='0';process.env.BORGES_EMBED='none';
const modules=process.argv.includes('--editorial-only')?['publishing']:['library','links','paperwork','publishing'];
const frozen=process.argv.includes('--frozen');
const observations=[];
for(const module of modules){
 const data=path.join(run,module);
 const service=new PublishingService({configFile:path.join(run,module+'.json'),dataDir:data,
  command:frozen?path.join(root,'publishing/runtime/writer-publishing-worker/writer-publishing-worker.exe'):path.join(root,'publishing/.venv/Scripts/python.exe'),
  args:frozen?[]:[path.join(root,'tests/fixtures/publishing_failed_close_worker.py')],cwd:path.join(root,'publishing')});
 try{
  const initial=await service.status();assert.equal(initial.running,false);assert.deepEqual(initial.enabled,[]);
  await service.setModule(module,true);const pid=(await service.status()).pid;assert.ok(pid);
  if(!frozen){
   for(const attempt of [1,2]){
    await assert.rejects(service.setModule(module,false));
    const state=await service.status();
    assert.equal(state.running,true);assert.equal(state.pid,pid);assert.ok(state.enabled.includes(module));
    assert.equal(state.modules.find(m=>m.id===module).state,'error');
    assert.equal(JSON.parse(await fs.readFile(path.join(data,module+'-close.json'))).attempts,attempt);
    await assert.rejects(service.setModule(module,true),/retained/);
    assert.equal(JSON.parse(await fs.readFile(path.join(data,module+'-close.json'))).attempts,attempt);
    await assert.rejects(service.request('GET','/'+module+'/api/health'),/OFF/);
   }
  }else{
   const tool={library:'library_collections',links:'list_links',paperwork:'docs_list',publishing:'gutenberg_publications'}[module];
   const result=await service.tool(tool,{});assert.equal(result.ok,true,JSON.stringify(result));
   if(module==='publishing'){
    const session=await service.tool('gutenberg_designcraft_raw_session',{session_id:'synthetic-frozen-close',actions:[
     {name:'new_document',arguments:{preset:'A4',pages:1,title:'Synthetic frozen close'}},
     {name:'inspect_document',arguments:{}}]});
    assert.equal(session.ok,true,JSON.stringify(session));
    assert.ok(session.result.results.every(row=>!row.is_error),JSON.stringify(session));
   }
  }
  await service.setModule(module,false);
  const final=await service.status();assert.equal(final.running,false);assert.deepEqual(final.enabled,[]);
  assert.throws(()=>process.kill(pid,0));
  if(!frozen)assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,module+'-close.json'))),{attempts:3,closed:true});
  observations.push({module,pid,failedOff:frozen?0:2,thirdClose:!frozen,nativeEditorialSession:frozen&&module==='publishing',closed:true,final});
 }finally{await service.close();}
}
if(!frozen){
 const data=path.join(run,'whole-close');
 const service=new PublishingService({configFile:path.join(run,'whole-close.json'),dataDir:data,
  command:path.join(root,'publishing/.venv/Scripts/python.exe'),args:[path.join(root,'tests/fixtures/publishing_failed_close_worker.py')],cwd:path.join(root,'publishing')});
 await service.setModule('paperwork',true);const pid=(await service.status()).pid;
 for(const attempt of [1,2]){
  await assert.rejects(service.close());const state=await service.status();
  assert.equal(state.pid,pid);assert.equal(state.running,true);
  assert.equal(state.modules.find(m=>m.id==='paperwork').state,'error');
  await assert.rejects(service.setModule('paperwork',true),/retained/);
  assert.equal(JSON.parse(await fs.readFile(path.join(data,'paperwork-close.json'))).attempts,attempt);
 }
 await service.close();assert.equal(service.running,false);assert.throws(()=>process.kill(pid,0));
 observations.push({case:'worker-shutdown',pid,failedClose:2,thirdClose:true,closed:true});
 const eofData=path.join(run,'eof');
 const child=spawn(path.join(root,'publishing/.venv/Scripts/python.exe'),[path.join(root,'tests/fixtures/publishing_failed_close_worker.py')],{cwd:path.join(root,'publishing'),windowsHide:true,stdio:['pipe','pipe','pipe'],env:process.env});
 const replies=new Map();createInterface({input:child.stdout}).on('line',line=>{const reply=JSON.parse(line);replies.get(reply.id)?.(reply);});
 const rpc=message=>new Promise(resolve=>{replies.set(message.id,resolve);child.stdin.write(JSON.stringify(message)+'\n');});
 assert.equal((await rpc({id:1,op:'init',dataDir:eofData})).ok,true);
 assert.equal((await rpc({id:2,op:'set',module:'paperwork',enabled:true})).ok,true);
 const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();assert.equal(await exited,0);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(eofData,'paperwork-close.json'))),{attempts:3,closed:true});
 observations.push({case:'eof-retry',pid:child.pid,failedClose:2,thirdClose:true,closed:true});
}
await fs.writeFile(path.join(run,'receipt.json'),JSON.stringify({mode:frozen?'frozen':'source-real-factories',observations},null,2));
console.log(JSON.stringify({status:'PASS',mode:frozen?'frozen':'source',cases:observations.length}));
