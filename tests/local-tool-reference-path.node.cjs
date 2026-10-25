const {build}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=`
import assert from 'node:assert/strict';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import fixture from './tests/fixtures/local-tools/author-kit';
import {authorFixtures,AUTHOR_PROJECT as P} from './tests/fixtures/local-tools/author-data';
export async function run(){
 const ref={kind:'codex' as const,documentId:'author-card'},scope={projectId:P},era={...scope,eraId:'future'};
 const fixtures=authorFixtures(),paths=[{...scope,kind:'codex' as const,id:ref.documentId,path:'/fixture/base/card'},{...era,kind:'codex' as const,id:ref.documentId,path:'/fixture/era/card?era=future'}];
 fixtures.referencePaths=paths;
 const original=structuredClone(fixtures),host=createFakeLocalToolHost(fixture,fixtures),before=host.inspect(),base=host.createClient(scope,true),future=host.createClient(era,true);
 // Explicit fixture strings describe author test data, not a canonical route builder.
 paths[0].path='/mutated-after-construction';
 const old={reference:ref,available:true,title:'Harbor guide',provenance:'base'};
 assert.deepEqual(await base.refs.resolve(ref),old);
 assert.deepEqual(await base.refs.resolve(ref,{}),old);
 assert.deepEqual(await base.refs.resolve(ref,{includePath:false}),old);
 assert.deepEqual(await base.refs.resolve(ref,{includePath:true}),{...old,path:'/fixture/base/card'});
 assert.deepEqual(await future.refs.resolve(ref,{includePath:true}),{reference:ref,available:true,title:'Future guide',provenance:'variant',path:'/fixture/era/card?era=future'});
 assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);
 console.log('PASS readonly Base and era opt-in use cloned explicit path fixtures; old shapes and whole business state remain exact');
 const plain=createFakeLocalToolHost(fixture,authorFixtures()),plainBefore=plain.inspect();
 assert.deepEqual(await plain.createClient(scope,true).refs.resolve(ref,{includePath:true}),{...old,path:null});
 // A Base fixture must not leak into a different era with valid metadata.
 const baseOnly=authorFixtures();baseOnly.referencePaths=[original.referencePaths![0]];
 assert.equal((await createFakeLocalToolHost(fixture,baseOnly).createClient(era,true).refs.resolve(ref,{includePath:true})).path,null);
 assert.deepEqual(plain.inspect(),plainBefore);assert.deepEqual(plain.commands,[]);
 console.log('PASS unconfigured paths return null and Base fixture paths do not leak into another effective scope');
 const calls:unknown[][]=[],portHost=createFakeLocalToolHost(fixture,original,{referencePath:async(...args)=>{calls.push(args);return '/explicit/port';}}),portBefore=portHost.inspect(),port=portHost.createClient(era,true);
 await port.refs.resolve(ref);await port.refs.resolve(ref,{});await port.refs.resolve(ref,{includePath:false});assert.deepEqual(calls,[]);
 assert.deepEqual(await port.refs.resolve(ref,{includePath:true}),{reference:ref,available:true,title:'Future guide',provenance:'variant',path:'/explicit/port'});
 assert.deepEqual(calls,[['codex','author-card',era]]);
 for(const id of ['missing','foreign-card'])assert.deepEqual(await port.refs.resolve({kind:'codex',documentId:id},{includePath:true}),{reference:{kind:'codex',documentId:id},available:false,title:id,path:null});
 assert.equal(calls.length,1);assert.deepEqual(portHost.inspect(),portBefore);assert.deepEqual(portHost.commands,[]);
 assert.deepEqual(original.referencePaths,[{...scope,kind:'codex',id:ref.documentId,path:'/fixture/base/card'},{...era,kind:'codex',id:ref.documentId,path:'/fixture/era/card?era=future'}]);
 console.log('PASS explicit port is opt-in and scoped; absent and foreign documents never call it or navigate');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'local-tool-reference-path.node.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const forbidden=Object.keys(result.metafile.inputs).filter(file=>/src\/db\/|worldEras\/(store|adapters|assets)\.|local\/(storage|registry|bootstrap)\.|aiBridge\/(dispatch|manifest)\./.test(file));
 if(forbidden.length)throw Error('Reference fake imported application/database: '+forbidden.join(','));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-reference-path-node-')),file=path.join(directory,'test.cjs');
 try{
  fs.writeFileSync(file,result.outputFiles[0].contents);
  global.fetch=()=>{throw Error('Unexpected network');};Object.defineProperty(global,'indexedDB',{get:()=>{throw Error('Unexpected IndexedDB');}});
  await require(file).run();console.log('PASS pure Node author host excludes application/DB imports, network and IndexedDB');
 }finally{fs.rmSync(file,{force:true});fs.rmdirSync(directory);}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
