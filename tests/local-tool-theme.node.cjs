// Explicit pure author-host theme fixture; no upstream signature or real UI claim.
const {build}=require('esbuild');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=String.raw`
import assert from 'node:assert/strict';
import * as SDK from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import type {LocalToolJson} from '@/engines/local/sdk';
type State={version:1;notes:string};
const keys=['--color-deep','--color-surface','--color-elevated','--color-border','--color-border-hover','--color-text-primary','--color-text-muted','--color-text-dim','--color-accent-gold'] as const;
interface Snapshot{projectId:string;eraId?:string;mode:'dark'|'light';tokens:Readonly<Record<typeof keys[number],string>>}
interface Port{get():Promise<Snapshot>;subscribe(changed:()=>void):()=>void}
function service(client:unknown){const port=(client as {readonly theme?:Port}).theme;assert.ok(port,'local_tool_theme_missing_after_positive_fake_source: explicit theme fixture not exposed');assert.equal(typeof port.get,'function');assert.equal(typeof port.subscribe,'function');return port;}
const definition=SDK.defineLocalTool<State>({namespace:'tests.theme-author',name:{en:'Theme author fixture',es:'Prueba de autor'},description:{en:'Pure author theme contract.',es:'Contrato puro de tema.'},document:{defaultTitle:{en:'Notebook',es:'Cuaderno'}},initialState:{version:1,notes:''},codec:{version:1,fields:{notes:{kind:'prose'}}},validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1&&typeof value.notes==='string',component:()=>null});
const fixtures=()=>({projects:[{id:'theme-author-world',updatedAt:1,sourceToolDocuments:['A','B'].map(id=>({id,namespace:definition.namespace,title:id,revision:1,createdAt:1,updatedAt:1,data:{version:1,notes:'Saved '+id} as State,codec:definition.codec}))}]});
export async function run(){
 const input=fixtures(),original=structuredClone(input),listeners=new Set<()=>void>();let calls=0;
 let current:Snapshot={projectId:'theme-author-world',mode:'dark',tokens:Object.fromEntries(keys.map(key=>[key,'#17191a'])) as Record<typeof keys[number],string>};
 // This fixture owns its values and makes detached snapshots; the product must
 // expose the supplied port without manufacturing an application/DOM default.
 const port:Port={get:async()=>{calls++;return structuredClone(current);},subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}};
 const overrides={locale:'en',theme:port},host=createFakeLocalToolHost(definition,input,overrides),scope={projectId:current.projectId},a=host.createClient(scope,false,'A'),b=host.createClient(scope,false,'B');
 const firstA=await a.read(),firstB=await b.read();assert.equal(firstA.data.notes,'Saved A');assert.equal(firstB.data.notes,'Saved B');
 await a.save({...firstA.data,notes:'Confirmed A'},firstA.revision,firstA.document?.version);const afterA=host.inspect();await assert.rejects(()=>a.save({...firstA.data,notes:'Stale A'},firstA.revision,firstA.document?.version),/conflict/);assert.deepEqual(host.inspect(),afterA);assert.deepEqual(await b.read(),firstB);
 await b.save({...firstB.data,notes:'Confirmed B'},firstB.revision,firstB.document?.version);assert.equal((await a.read()).data.notes,'Confirmed A');assert.equal((await b.read()).data.notes,'Confirmed B');assert.deepEqual(input,original);assert.deepEqual(host.commands,[]);
 console.log('PASS FAKE author-host Source A/B read/save/CAS and independent notes before optional theme assertion; no actual Source UI claim');
 const theme=service(a),other=service(b),before=host.inspect(),saved=[await a.read(),await b.read()];let notices=0;
 const stop=theme.subscribe(()=>{notices++;});assert.equal(typeof stop,'function');const first=await theme.get();assert.deepEqual(first,current);assert.deepEqual(Object.keys(first.tokens).sort(),[...keys].sort());Reflect.set(first.tokens,'--color-deep','#ff00ff');assert.deepEqual(await other.get(),current);assert.deepEqual(host.inspect(),before);assert.equal(notices,0);assert.deepEqual(host.commands,[]);
 console.log('PASS explicit detached theme fixture is public across fake Source clients; reads/subscriptions preserve all business and original fixture input');
 current={...current,mode:'light',tokens:Object.fromEntries(keys.map(key=>[key,'#eeeeee'])) as Record<typeof keys[number],string>};for(const changed of listeners)changed();assert.equal(notices,1);assert.deepEqual(await theme.get(),current);stop();for(const changed of listeners)changed();assert.equal(notices,1);assert.equal(listeners.size,0);
 const absent=createFakeLocalToolHost(definition,fixtures()).createClient(scope);assert.equal((absent as unknown as {theme?:Port}).theme,undefined,'Fake without explicit theme must remain optional, not import CSS defaults');
 const readonly=host.createClient(scope,true,'A');assert.deepEqual(await service(readonly).get(),current);assert.deepEqual([await a.read(),await b.read()],saved);assert.deepEqual(host.inspect(),before);assert.deepEqual(input,original);assert.deepEqual(host.commands,[]);assert.ok(calls>=4);
 assert.equal(typeof (SDK as unknown as {useLocalToolTheme?:unknown}).useLocalToolTheme,'function','Pure public hook export absent');assert.equal(typeof (SDK as unknown as {LocalToolAppliedThemeProvider?:unknown}).LocalToolAppliedThemeProvider,'function','Pure applied-theme Provider export absent');
 console.log('PASS explicit fixture change/unsubscribe, readonly access, absent old host and pure hook/Provider public exports; no renderer resolution claim');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'local-tool-theme.author-contract.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const emitted=new Set(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([,entry])=>entry.bytesInOutput>0).map(([file])=>file)));
 const forbidden=[...emitted].filter(file=>/src[\\/]db[\\/]|worldEras[\\/](store|adapters|assets)\.|local[\\/](storage|registry|bootstrap)\.|aiBridge[\\/](dispatch|manifest)\.|workspaceAppearance[\\/](store|style|useWorkspaceAppearance)\.|\.css(?:\?raw)?$|\?raw/.test(file));
 if(forbidden.length)throw Error('Theme author bundle emitted application/DB/CSS: '+forbidden.join(','));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-theme-author-')),file=path.join(directory,'author.cjs'),saved=new Map();
 try{fs.writeFileSync(file,result.outputFiles[0].contents);for(const name of ['fetch','indexedDB','window','document','localStorage','WebSocket']){saved.set(name,Object.getOwnPropertyDescriptor(global,name));Object.defineProperty(global,name,{configurable:true,get(){throw Error('Unexpected '+name+' in pure theme author contract');}});}await require(file).run();console.log('PASS emitted public author bundle needs no application, DB, CSS/raw, browser globals or network');}
 finally{for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(directory);}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
