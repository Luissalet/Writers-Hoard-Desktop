const {build}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=`
import assert from 'node:assert/strict';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import fixture from './tests/fixtures/local-tools/author-kit';
import {authorFixtures,AUTHOR_PROJECT as P} from './tests/fixtures/local-tools/author-data';
export async function run(){
 const calls:unknown[][]=[],host=createFakeLocalToolHost(fixture,authorFixtures(),{navigate:async(...args)=>{calls.push(args);}}),scope={projectId:P},client=host.createClient(scope,true),before=host.inspect();
 const old={kind:'navigate',scope,documentKind:'codex',documentId:'author-card'};
 await client.openDocument('codex','author-card');
 await client.openDocument('codex','author-card',{});
 await client.refs.open({kind:'codex',documentId:'author-card'});
 assert.deepEqual(host.commands,[old,old,old]);
 assert.deepEqual(calls,[['codex','author-card',scope],['codex','author-card',scope],['codex','author-card',scope]]);
 console.log('PASS legacy no-options, empty options and refs.open retain exact command keys and three callback arguments');
 await client.openDocument('codex','author-card',{placement:'beside'});
 assert.deepEqual(host.commands.at(-1),{...old,placement:'beside'});
 assert.deepEqual(calls.at(-1),['codex','author-card',scope,{placement:'beside'}]);
 const era={...scope,eraId:'future'},future=host.createClient(era,true);
 assert.equal((await future.world.read('codex','author-card'))?.document.root.title,'Future guide');
 await future.openDocument('codex','author-card',{placement:'beside'});
 assert.deepEqual(host.commands.at(-1),{...old,scope:era,placement:'beside'});
 assert.deepEqual(calls.at(-1),['codex','author-card',era,{placement:'beside'}]);
 assert.deepEqual(host.inspect(),before);
 console.log('PASS explicit beside records scoped placement in readonly Base and effective era without changing business snapshots');
 const count=host.commands.length,callbackCount=calls.length;
 await assert.rejects(()=>client.openDocument('codex','missing',{placement:'beside'}),/world_document_missing/);
 await assert.rejects(()=>client.openDocument('codex','foreign-card',{placement:'beside'}),/world_document_missing/);
 assert.equal(host.commands.length,count);assert.equal(calls.length,callbackCount);
 assert.deepEqual(host.inspect(),before);
 console.log('PASS absent and foreign fixtures reject without recording or dispatching navigation');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'local-tool-beside.node.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const forbidden=Object.keys(result.metafile.inputs).filter(file=>/src\/db\/|worldEras\/(store|adapters|assets)\.|local\/(storage|registry|bootstrap)\.|aiBridge\/(dispatch|manifest)\./.test(file));
 if(forbidden.length)throw Error('Placement fake imported application/database: '+forbidden.join(','));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-beside-node-')),file=path.join(directory,'test.cjs');fs.writeFileSync(file,result.outputFiles[0].contents);
 global.fetch=()=>{throw Error('Unexpected network');};Object.defineProperty(global,'indexedDB',{get:()=>{throw Error('Unexpected IndexedDB');}});
 await require(file).run();console.log('PASS pure Node author host: application/DB imports, network and IndexedDB excluded');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
