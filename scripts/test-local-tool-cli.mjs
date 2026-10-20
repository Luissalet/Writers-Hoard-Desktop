import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,mkdir,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {transform} from 'esbuild';
import {createLocalToolScaffold} from './create-local-tool.mjs';
const temporary=await mkdtemp(path.join(os.tmpdir(),'wh-sdk-cli-'));
try{
  const result=await createLocalToolScaffold({rootDir:temporary,namespace:'tests.notebook',name:'Notes "safe" </script>'}),source=await readFile(result.modulePath,'utf8');
  await transform(source,{loader:'tsx'});assert.equal(result.engineId,'local-tool-tests.notebook');assert.match(source,/defineLocalTool/);assert.doesNotMatch(source,/fetch\(|eval\(|iframe|dangerouslySetInnerHTML/);console.log('PASS SDK CLI: real runnable scaffold, escaped developer labels and typed SDK imports');
  await assert.rejects(()=>createLocalToolScaffold({rootDir:temporary,namespace:'tests.notebook',name:'Replacement'}));assert.equal(await readFile(result.modulePath,'utf8'),source);console.log('PASS SDK CLI: occupied destination is never overwritten');
  for(const namespace of ['../outside','author/escape','single','A.upper','__proto__.x','a.','a..b','a.'+'x'.repeat(100)])await assert.rejects(()=>createLocalToolScaffold({rootDir:temporary,namespace}));
  const other=await mkdtemp(path.join(temporary,'symlink-')),outside=path.join(temporary,'outside');await mkdir(outside);let checked=false;
  try{await symlink(outside,path.join(other,'src'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>createLocalToolScaffold({rootDir:other,namespace:'tests.escape'}));assert.deepEqual(await readdir(outside),[]);checked=true;}catch(error){if(!['EPERM','EACCES','ENOSYS'].includes(error.code))throw error;}
  console.log('PASS SDK CLI: traversal/namespace refusal'+(checked?' and actual symlink escape refusal':' (symlink creation unavailable on host)'));
  const installed=new URL('../src/engines/local/installed/',import.meta.url);assert(!(await readdir(installed)).some(file=>file!=='README.md'&&file!=='.gitkeep'));console.log('PASS SDK defaults: no installed source tool, no project activation');
}finally{const absolute=path.resolve(temporary);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'wh-sdk-cli-'));await rm(absolute,{recursive:true,force:true});}
