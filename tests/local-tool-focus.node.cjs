// Public author contract: the fake records focus intentions, never a real shell.
const {build}=require('esbuild');
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=String.raw`
import assert from 'node:assert/strict';
import * as SDK from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
type State={notes:string};
const definition=SDK.defineLocalTool<State>({namespace:'tests.focus-author',name:{en:'Focus fixture',es:'Prueba de concentración'},description:{en:'Pure focus fixture.',es:'Prueba pura.'},initialState:{notes:''},validateState:(value):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:()=>null});
export async function run(){
 const fixtures={projects:[{id:'focus-author',updatedAt:1}]},host=createFakeLocalToolHost(definition,fixtures),client=host.createClient({projectId:'focus-author'});
 const before=await client.read();await client.save({notes:'Confirmed source baseline'},before.revision);
 const saved=await client.read();assert.equal(saved.data.notes,'Confirmed source baseline');await assert.rejects(()=>client.save({notes:'Stale'},before.revision),/conflict/);
 const business=host.inspect();assert.deepEqual(await client.read(),saved);assert.deepEqual(host.commands,[]);
 console.log('PASS ordinary fake Source read/save/stale-CAS before focus capability assertion');
 const focus=(host as unknown as {focusMode?:{getState():{available:boolean;active:boolean};set(value:boolean):void;toggle():void;subscribe(changed:()=>void):()=>void}}).focusMode;
 assert.ok(focus,'local_tool_focus_missing_after_positive_source_baseline');
 const initial=focus.getState();assert.deepEqual(initial,{available:false,active:false});assert.ok(Object.isFrozen(initial));assert.equal(focus.getState(),initial);
 let notices=0;const stop=focus.subscribe(()=>notices++);focus.set(true);focus.toggle();focus.set(false);stop();assert.equal(notices,0);assert.equal(focus.getState(),initial);
 assert.deepEqual(host.inspect(),business);assert.deepEqual(host.commands,[]);assert.deepEqual((host as any).focusModeCommands,[{action:'set',active:true},{action:'toggle'},{action:'set',active:false}]);
 assert.equal(typeof (SDK as any).useLocalToolFocusMode,'function');
 console.log('PASS public inert focus records intent without shell, business writes or notifications');
 const listeners=new Set<()=>void>();let state=Object.freeze({available:true,active:false});
 const port={getState:()=>state,set(active:boolean){if(state.active===active)return;state=Object.freeze({available:true,active});for(const changed of listeners)changed();},toggle(){this.set(!state.active);},subscribe(changed:()=>void){listeners.add(changed);return()=>{listeners.delete(changed);};}};
 const explicit=createFakeLocalToolHost(definition,fixtures,{focusMode:port} as any),explicitBefore=explicit.inspect();assert.equal((explicit as any).focusMode,port);
 const off=(explicit as any).focusMode.subscribe(()=>notices++);(explicit as any).focusMode.set(true);assert.equal(notices,1);assert.deepEqual((explicit as any).focusMode.getState(),{available:true,active:true});off();port.toggle();assert.equal(notices,1);assert.equal(listeners.size,0);
 assert.deepEqual(explicit.inspect(),explicitBefore);assert.deepEqual(host.inspect(),business);
 console.log('PASS explicit memory override and unsubscribe; no DOM/real shell claim');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'focus.author.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const emitted=new Set(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([,entry])=>entry.bytesInOutput>0).map(([file])=>file)));
 const forbidden=[...emitted].filter(file=>/src[\\/]db[\\/]|local[\\/](storage|registry|bootstrap)\.|workspaceFocus|MainLayout|\.css(?:\?raw)?$|node_modules[\\/]three[\\/]/.test(file));
 assert.deepEqual(forbidden,[],'Public author focus imported runtime/DB/CSS/Three');
 const saved=new Map();try{
  for(const name of ['fetch','indexedDB','window','document','localStorage','WebSocket']){saved.set(name,Object.getOwnPropertyDescriptor(global,name));Object.defineProperty(global,name,{configurable:true,get(){throw Error('Unexpected '+name+' in pure focus contract');}});}
  const filename=path.join(root,'focus-author.generated.cjs'),entry=new Module(filename,module);entry.filename=filename;entry.paths=module.paths;entry._compile(result.outputFiles[0].text,filename);await entry.exports.run();
  console.log('PASS public bundle without browser globals, storage or network');
 }finally{for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
