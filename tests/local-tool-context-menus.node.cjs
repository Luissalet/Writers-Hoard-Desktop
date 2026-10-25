const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const Module=require('node:module');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..');

async function main(){
 const result=await build({stdin:{contents:"export * from './src/engines/local/sdk';export {createFakeLocalToolHost} from './src/engines/local/testing';export {default as actualDefinition} from './src/engines/local/installed/examples.context-counter/module';",resolveDir:root},bundle:true,platform:'node',format:'cjs',target:'node22',jsx:'automatic',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const forbidden=Object.keys(result.metafile.inputs).filter(file=>/src\/db\/|stores\/localeStore|worldEras\/(store|adapters|assets)\.|local\/(storage|registry|bootstrap|LocalToolContextMenuHost|LocalToolTutorialHost)\.|components\/tutorial|react-dom|aiBridge\/(dispatch|manifest)\./.test(file.replaceAll('\\','/')));
 assert.deepEqual(forbidden,[],'Public context-menu graph imports application, database or presenter');
 for(const name of ['window','document','indexedDB','HTMLElement','Element','Node'])Object.defineProperty(global,name,{configurable:true,get(){throw Error('DOM/database forbidden: '+name);}});
 global.fetch=()=>{throw Error('Network forbidden');};
 const filename=path.join(root,'context-menus-pure.cjs'),loaded=new Module(filename,module);
 loaded.filename=filename;loaded.paths=Module._nodeModulePaths(root);loaded._compile(result.outputFiles[0].text,filename);const api=loaded.exports;
 let prevented=0,stopped=0,selected=0;
 const trigger={currentTarget:null,type:'contextmenu',clientX:1,clientY:2,preventDefault(){prevented++;},stopPropagation(){stopped++;}};
 const entries=[{kind:'label',label:'Own count'},{kind:'item',id:'increment',label:'Increment',onSelect(){selected++;}},{kind:'separator'},{kind:'item',id:'reset',label:'Reset',disabled:true,variant:'destructive',onSelect(){selected++;}}];
 const fallback=api.useLocalToolContextMenu();assert.equal(fallback.open(trigger,entries,{label:'Actions'}),false);fallback.close();
 assert.deepEqual([prevented,stopped,selected],[0,0,0]);
 const recording=api.createRecordingLocalToolContextMenu();assert.equal(recording.port.open(trigger,entries,{label:'Actions'}),false);
 assert.equal(recording.requests.length,1);const captured=JSON.stringify(recording.requests);
 entries[0].label='Mutated';entries[1].id='changed';entries[1].label='Changed';entries[3].disabled=false;entries.push({kind:'separator'});
 assert.equal(JSON.stringify(recording.requests),captured,'Recording retained mutable author entries');
 const request=recording.requests[0];assert.equal(request.label,'Actions');assert.equal(request.entries[1].id,'increment');assert.equal(request.entries[3].disabled,true);
 function noLive(value){assert.notEqual(typeof value,'function','Recording retained a callback');if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){assert(!['event','currentTarget','onSelect','target','ownerDocument'].includes(key),'Recording retained live data: '+key);noLive(child);}}
 noLive(recording.requests);recording.port.close();assert.deepEqual([prevented,stopped,selected],[0,0,0]);
 console.log('PASS Public SDK/fallback imports without DOM, DB, presenter or network; unavailable port leaves events and actions untouched');
 console.log('PASS Recorder retains detached menu metadata without callbacks, event or DOM; requests do not claim presentation');
 const host=api.createFakeLocalToolHost(api.actualDefinition,{projects:[{id:'context-pure',updatedAt:1}]}),before=JSON.stringify(host.inspect());
 assert.equal(api.useLocalToolContextMenu({contextMenu:host.contextMenu}),host.contextMenu);
 assert.equal(host.contextMenu.open(trigger,entries,{label:'Own actions'}),false);host.contextMenu.close();
 assert.equal(host.contextMenuRequests.length,1);noLive(host.contextMenuRequests);assert.equal(JSON.stringify(host.inspect()),before);assert.deepEqual([prevented,stopped,selected],[0,0,0]);
 console.log('PASS Actual example fake exposes inert contextMenu/contextMenuRequests without changing fixture memory');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'wh-context-menu-pack-'));
 try{
  const output=path.join(temporary,'counter.local-tool.json'),cli=path.join(root,'scripts/local-tool-packages.mjs'),source=path.join(root,'src/engines/local/installed/examples.context-counter');
  const packed=spawnSync(process.execPath,[cli,'pack','--source',source,'--output',output],{cwd:root,encoding:'utf8'});assert.equal(packed.status,0,packed.stderr||packed.stdout);
  const checked=spawnSync(process.execPath,[cli,'check','--package',output],{cwd:root,encoding:'utf8'});assert.equal(checked.status,0,checked.stderr||checked.stdout);
  const content=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(content.manifest.namespace,api.actualDefinition.namespace);assert.deepEqual(content.manifest.files.map(row=>row.path),['module.tsx']);assert.equal(Object.keys(content.files).length,1);
  console.log('PASS Official package CLI packs and validates the actual source manifest: '+content.manifest.contentHash+' (no installation claim)');
 }finally{const target=path.resolve(temporary);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep+'wh-context-menu-pack-'));await fs.rm(target,{recursive:true,force:true});}
 const author=await import(pathToFileURL(path.join(root,'scripts/test-local-tool.mjs')).href);
 for(const message of await author.testLocalToolSource({namespace:'examples.context-counter'}))console.log('PASS '+message);
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
