import {act,useState,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {createLocalToolClient} from '@/engines/local/storage';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {LocalToolUndoBoundary} from '@/engines/local/LocalToolUndoBoundary';
import iconNotebook from '@/engines/local/examples/iconNotebookDefinition';
import type {IconNotebookState} from '@/engines/local/examples/IconNotebook';
import type {LocalToolClient,LocalToolJson,LocalToolDefaultSnapshot,LocalToolDefaultResult} from '@/engines/local/sdk';

const pack='writer-map-symbols/1',castle=pack+':Castle',book=pack+':BookOpen',key='favorite-icon',getTool='wh_local_tool_default_get',updateTool='wh_local_tool_default_update';
type Client=LocalToolClient<IconNotebookState>;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const equal=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),message);
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
async function until(predicate:()=>boolean|Promise<boolean>,message:string){for(let i=0;i<300;i++){if(await predicate())return;await act(async()=>{await pause();});}throw Error(message);}
async function reject(run:()=>unknown,message:string){let failed=false;try{await run();}catch{failed=true;}check(failed,message);}
function element(){const value=document.getElementById('root');check(value,'Missing test root');return value;}
async function render(root:Root,node:ReactNode){await act(async()=>{root.render(node);await pause();});}
async function click(value:HTMLElement){await act(async()=>{value.click();await pause();});}
async function input(value:HTMLTextAreaElement,text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(value,text);value.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
function button(scope:ParentNode,label:string){const value=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);check(value,'Missing '+label);return value;}
function source(id:string){const value=[...element().querySelectorAll<HTMLElement>('[data-source-document-host]')].find(node=>node.dataset.sourceDocumentHost===id);check(value,'Missing Source '+id);return value;}
function notes(scope:ParentNode){const value=scope.querySelector<HTMLTextAreaElement>('textarea');check(value,'Missing notes');return value;}
function favorite(scope:ParentNode){const value=scope.querySelector<HTMLElement>('[aria-label="Shared favorite"]');check(value,'Missing shared favorite');return value;}
function defaults(client:Client){check(client.defaults,'Runtime defaults missing');return client.defaults;}
const present=(value:LocalToolJson)=>({present:true,value});
function snapshot(value:LocalToolDefaultSnapshot,projectId:string,key:string,entry:unknown){check(value.projectId===projectId&&value.namespace===iconNotebook.namespace&&value.key===key,'Wrong preference identity');check(value.revision===null||Number.isSafeInteger(value.revision)&&value.revision>=0,'Invalid revision');equal(value.entry,entry,'Wrong preference value/presence');}
function receipt(value:LocalToolDefaultResult){check(typeof value.receiptId==='string'&&!!value.receiptId,'Missing preference receipt');return value.receiptId;}
async function direct(name:string,args:Record<string,unknown>){const reply=await runBridgeTool(name,args);check(reply.ok,'Dispatcher failed '+JSON.stringify(reply));return reply.result;}
async function result(args:Record<string,unknown>){const value=await direct(updateTool,args) as LocalToolDefaultResult;check(value?.snapshot,'Missing preference result');return value;}
const business=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()]))),pending=()=>JSON.stringify(getPendingWritesSnapshot());
let registered=false;
async function fixture(label:string){
 if(!registered){registerLocalToolModules({'./installed/examples.icon-notebook/module.tsx':{default:iconNotebook}});registered=true;}
 const projectId='defaults-'+label+'-'+crypto.randomUUID(),controlId=projectId+'-control';
 const project=(id:string)=>({id,title:'QA defaults '+label,description:'Synthetic fixture',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['local-tool-'+iconNotebook.namespace],engineOrder:['local-tool-'+iconNotebook.namespace],worldEras:[{id:'past',name:'Past',description:'Synthetic era',revision:1,createdAt:1,updatedAt:1}],localToolStates:{'business.legacy':{revision:3,updatedAt:1,data:{notes:'Unrelated namespace'}}},createdAt:1,updatedAt:1});
 const cleanup=async()=>{await deleteProject(projectId);await deleteProject(controlId);};
 try{await db.projects.bulkPut([project(projectId),project(controlId)]);const a=await createSourceToolDocument({projectId},iconNotebook.namespace,'Defaults Source A'),b=await createSourceToolDocument({projectId},iconNotebook.namespace,'Defaults Source B');
  const client=(eraId?:string,documentId=a.id,readOnly=false)=>createLocalToolClient(projectId,iconNotebook,{documentId,eraId,readOnly});
  for(const [id,iconId,label]of [[a.id,castle,'A'],[b.id,book,'B']]){const current=client(undefined,id),before=await current.read();await current.save({version:1,iconId,notes:'Saved independent notes '+label},before.revision,before.document?.version);}
  return{projectId,controlId,aId:a.id,bId:b.id,client,cleanup};
 }catch(error){await cleanup();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const sources=(f:Fixture)=>Promise.all([f.client().read(),f.client(undefined,f.bId).read(),f.client('past').read(),f.client('past',f.bId).read()]);
async function preserved(f:Fixture){const project=await db.projects.get(f.projectId);check(project,'Missing project');const {updatedAt,localToolStates,...metadata}=project;void updatedAt;return{metadata,legacy:localToolStates?.['business.legacy']};}
async function outside(projectId:string){return Promise.all(db.tables.map(async table=>[table.name,(await table.toArray()).filter((row:Record<string,unknown>)=>!(table.name==='projects'&&row.id===projectId))]));}
async function mountPair(root:Root,f:Fixture,eraId?:string){await render(root,<MemoryRouter><div><LocalToolDocumentHost projectId={f.projectId} documentId={f.aId} eraId={eraId}/><LocalToolDocumentHost projectId={f.projectId} documentId={f.bId} eraId={eraId}/></div></MemoryRouter>);await until(()=>element().querySelectorAll('[data-source-document-host] textarea:not(:disabled)').length===2&&element().querySelectorAll('[aria-label="Shared favorite"]').length===2,'Normal Source pair not ready');}
const ready=(scope:ParentNode)=>until(()=>!button(favorite(scope),'Save favorite').disabled,'Favorite not ready');
const usable=(scope:ParentNode)=>until(()=>!button(favorite(scope),'Use favorite').disabled,'Favorite not usable');

export async function testLocalToolDefaultsContract(){
 const f=await fixture('contract');try{
  const a=f.client(),b=f.client(undefined,f.bId),era=f.client('past'),readonly=f.client(undefined,f.aId,true),da=defaults(a),dbb=defaults(b),de=defaults(era),dr=defaults(readonly),beforeSources=await sources(f);
  check(beforeSources[0].data.notes==='Saved independent notes A'&&beforeSources[1].data.notes==='Saved independent notes B','Real Source positive baseline failed');snapshot(await da.get('positive-kernel-read'),f.projectId,'positive-kernel-read',{present:false});equal(await sources(f),beforeSources,'Kernel read changed Source');
  console.log('PASS real Source A/B and runtime defaults positive before MCP capability assertion');
  const read=getBridgeTool(getTool);check(read,'local_tool_default_get_missing: readonly defaults MCP is absent');check(read.writes===false,'get must be readonly');const write=getBridgeTool(updateTool);check(write,'local_tool_default_update_missing');check(write.writes===true,'update must declare writes');for(const field of ['namespace','key']){check(Object.hasOwn(read.schema.properties,field),'get missing '+field);check(Object.hasOwn(write.schema.properties,field),'update missing '+field);}for(const field of ['action','value','expected','receiptId'])check(Object.hasOwn(write.schema.properties,field),'update missing '+field);equal((write.schema.properties.action as {enum:string[]}).enum,['set','undo','redo'],'Wrong actions');
  const beforeReads=await business(),ledger=pending(),url=location.href,common={projectId:f.projectId,namespace:iconNotebook.namespace};
  for(const name of ['positive-kernel-read',key]){const expected=await da.get(name);equal(await direct(getTool,{...common,key:name}),expected,'SDK/MCP get');equal(await a.callTool(getTool,{namespace:iconNotebook.namespace,key:name}),expected,'Scoped Base get');equal(await era.callTool(getTool,{namespace:iconNotebook.namespace,key:name}),expected,'Scoped era get');equal(await dr.get(name),expected,'Readonly get');}equal(await business(),beforeReads,'Reads wrote business');check(pending()===ledger&&location.href===url,'Reads changed pending/navigation');
  const metadata=await preserved(f),others=await outside(f.projectId);
  for(const [index,value]of [null,false,0,'',{nested:[null,false,0,'','id-looking','/path-looking']}].entries()){const name='json-'+index,saved=await result({...common,action:'set',key:name,value,expected:await da.get(name)});receipt(saved);snapshot(saved.snapshot,f.projectId,name,present(value));equal(await da.get(name),saved.snapshot,'MCP set/SDK get');equal(await dbb.get(name),saved.snapshot,'A/B');equal(await de.get(name),saved.snapshot,'Base/era');}
  const name='cross-receipt',first=await result({...common,action:'set',key:name,value:null,expected:await da.get(name)}),undone=await dbb.undo(name,receipt(first));snapshot(undone.snapshot,f.projectId,name,{present:false});const redone=await result({...common,eraId:'past',action:'redo',key:name,receiptId:receipt(undone)});snapshot(redone.snapshot,f.projectId,name,present(null));const sdkSaved=await de.set(name,'SDK choice',await de.get(name)),mcpUndone=await result({...common,action:'undo',key:name,receiptId:receipt(sdkSaved)});snapshot(mcpUndone.snapshot,f.projectId,name,present(null));const sdkRedone=await da.redo(name,receipt(mcpUndone));snapshot(sdkRedone.snapshot,f.projectId,name,present('SDK choice'));
  const stale=await da.get('mcp-conflict'),winner=await dbb.set('mcp-conflict','Remote winner',stale),beforeConflict=await business();check(!(await runBridgeTool(updateTool,{...common,action:'set',key:'mcp-conflict',value:'Stale proposal',expected:stale})).ok,'Stale MCP succeeded');equal(await business(),beforeConflict,'Conflict wrote');equal(await da.get('mcp-conflict'),winner.snapshot,'Remote winner lost');snapshot((await result({...common,action:'set',key:'mcp-conflict',value:'Fresh proposal',expected:await da.get('mcp-conflict')})).snapshot,f.projectId,'mcp-conflict',present('Fresh proposal'));
  const readonlyBefore=await business();await reject(async()=>dr.set(name,'Readonly',await dr.get(name)),'Readonly set succeeded');await reject(()=>dr.undo(name,receipt(sdkRedone)),'Readonly undo succeeded');await reject(async()=>readonly.callTool(updateTool,{namespace:iconNotebook.namespace,action:'set',key:name,value:'Readonly',expected:await dr.get(name) as unknown as LocalToolJson}),'Readonly callTool succeeded');equal(await business(),readonlyBefore,'Readonly rejection wrote');
  for(const args of [{...common},{...common,key:'invalid',action:'set',value:'No baseline'},{...common,key:'invalid',action:'unknown'}]){const before=await business();check(!(await runBridgeTool(updateTool,args)).ok,'Invalid update succeeded');equal(await business(),before,'Invalid update wrote');}
  for(const args of [{namespace:iconNotebook.namespace},{namespace:iconNotebook.namespace,key:{}}])await reject(()=>a.callTool(getTool,args),'Invalid scoped key succeeded');
  equal(await sources(f),beforeSources,'Preferences changed Source notes/data/version');equal(await preserved(f),metadata,'Preferences changed metadata/legacy namespace');equal(await outside(f.projectId),others,'Preferences changed another row/table');check(location.href===url,'Preferences navigated');return['real SDK/MCP JSON, scoped Base/era, cross-channel receipts, conflicts and readonly preserve Source'];
 }finally{await f.cleanup();}
}

export async function testLocalToolDefaultsSource(){
 const f=await fixture('source'),root=createRoot(element());useLocaleStore.setState({locale:'en',loaded:true});try{
  const control=await db.projects.get(f.controlId);
  for(const eraId of [undefined,'past']){
   await render(root,<p>Closing previous Sources before preparing context</p>);const a=f.client(eraId),b=f.client(eraId,f.bId),da=defaults(a),dbb=defaults(b);
   for(const [client,iconId]of [[a,castle],[b,book]]as [Client,string][]){const before=await client.read();await client.save({...before.data,iconId},before.revision,before.document?.version);}await da.set(key,book,await da.get(key));await mountPair(root,f,eraId);await ready(source(f.aId));await ready(source(f.bId));await usable(source(f.bId));
   const draftA='Unsaved A '+(eraId??'Base'),draftB='Unsaved B '+(eraId??'Base');await input(notes(source(f.aId)),draftA);await input(notes(source(f.bId)),draftB);const beforeA=await a.read(),beforeB=await b.read();check(beforeA.data.iconId===castle&&beforeB.data.iconId===book,'Favorite mount auto-applied icon');
   await click(button(favorite(source(f.aId)),'Save favorite'));await until(async()=>{const value=await dbb.get(key);return value.entry.present&&value.entry.value===castle;},'Save favorite did not share');await usable(source(f.bId));equal(await a.read(),beforeA,'Favorite saved A');equal(await b.read(),beforeB,'Favorite changed B');check(notes(source(f.aId)).value===draftA&&notes(source(f.bId)).value===draftB,'Favorite lost draft');check(!button(favorite(source(f.aId)),'Undo favorite').disabled,'Favorite lacks Undo');
   await click(button(favorite(source(f.bId)),'Use favorite'));await until(async()=>(await b.read()).data.iconId===castle,'Use favorite did not apply');const usedB=await b.read();equal(usedB.data,{...beforeB.data,iconId:castle},'Use changed beyond icon');check(usedB.revision===beforeB.revision!+1,'Use not one Source action');check(notes(source(f.bId)).value===draftB,'Use lost draft');equal(await a.read(),beforeA,'Use B changed A');
   await click(button(favorite(source(f.aId)),'Undo favorite'));await until(async()=>{const value=await da.get(key);return value.entry.present&&value.entry.value===book;},'Favorite Undo failed');equal(await a.read(),beforeA,'Preference Undo changed A');equal(await b.read(),usedB,'Preference Undo changed icon');check(notes(source(f.aId)).value===draftA&&notes(source(f.bId)).value===draftB,'Undo lost drafts');
   await click(button(favorite(source(f.aId)),'Redo favorite'));await until(async()=>{const value=await da.get(key);return value.entry.present&&value.entry.value===castle;},'Favorite Redo failed');equal(await a.read(),beforeA,'Redo changed A');equal(await b.read(),usedB,'Redo changed B');
   const unknown='future:UnknownFavorite';await da.set(key,unknown,await da.get(key));await until(()=>button(favorite(source(f.bId)),'Use favorite').disabled&&/unavailable/i.test(favorite(source(f.bId)).textContent??''),'Unknown still usable/no feedback');const settled=await business(),unknownSnapshot=await da.get(key);snapshot(unknownSnapshot,f.projectId,key,present(unknown));await act(async()=>{await pause();});equal(await business(),settled,'Unknown caused write');equal(await a.read(),beforeA,'Unknown changed A');equal(await b.read(),usedB,'Unknown changed B');check(notes(source(f.aId)).value===draftA&&notes(source(f.bId)).value===draftB,'Unknown lost drafts');
   await click(button(source(f.bId),'Save notes'));await until(async()=>(await b.read()).data.notes===draftB,'Explicit Save notes broken');check((await b.read()).data.iconId===castle,'Save notes changed icon');equal(await da.get(key),unknownSnapshot,'Save notes changed preference');
  }
  equal(await db.projects.get(f.controlId),control,'Source flow changed control');return['normal Source A/B Base/era Save/Use/Undo/Redo share favorite while independent notes drafts and explicit Save notes survive'];
 }finally{await act(async()=>root.unmount());await f.cleanup();}
}

export async function testLocalToolDefaultsConflict(){
 const f=await fixture('conflict'),root=createRoot(element());useLocaleStore.setState({locale:'en',loaded:true});let release:()=>void=()=>{};try{
  const client=f.client(),service=defaults(client);await service.set(key,book,await service.get(key));let enter!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let hold=true;
  const delayed={...service,set:async(name:string,value:LocalToolJson,expected:LocalToolDefaultSnapshot)=>{if(hold){hold=false;enter();await gate;}return service.set(name,value,expected);}},wrapped={...client,defaults:delayed},Component=iconNotebook.component;
  await render(root,<MemoryRouter><LocalToolUndoBoundary><Component projectId={f.projectId} client={wrapped} context={{view:'editor',canEdit:true,scope:{projectId:f.projectId},document:{id:f.aId,namespace:iconNotebook.namespace,title:'Defaults A'}}}/></LocalToolUndoBoundary></MemoryRouter>);await until(()=>!!element().querySelector('textarea:not(:disabled)'),'Conflict Source not ready');await ready(element());const draft='Pending notes survive conflict';await input(notes(element()),draft);const sourceBefore=await client.read();
  await click(button(favorite(element()),'Save favorite'));await entered;check(button(favorite(element()),'Save favorite').disabled,'Missing busy state');const remote=await service.set(key,pack+':Circle',await service.get(key));release();await until(()=>[...favorite(element()).querySelectorAll('[role="alert"]')].some(node=>/favorite/i.test(node.textContent??'')),'Conflict/error not shown');equal(await service.get(key),remote.snapshot,'Conflict lost remote winner');equal(await client.read(),sourceBefore,'Conflict changed Source');check(notes(element()).value===draft,'Conflict lost draft');
  await click(button(favorite(element()),'Reload favorite'));await ready(element());equal(await service.get(key),remote.snapshot,'Reload silently wrote proposal');equal(await client.read(),sourceBefore,'Reload changed Source');check(notes(element()).value===draft,'Reload lost draft');
  await click(button(favorite(element()),'Retry saving favorite'));await until(async()=>{const value=await service.get(key);return value.entry.present&&value.entry.value===castle;},'Explicit fresh retry failed');equal(await client.read(),sourceBefore,'Retry changed Source');check(notes(element()).value===draft,'Retry lost draft');
  await click(button(favorite(element()),'Undo favorite'));await until(async()=>{const value=await service.get(key);return value.entry.present&&value.entry.value===pack+':Circle';},'Recovery Undo lost remote preimage');equal(await client.read(),sourceBefore,'Undo changed Source');check(notes(element()).value===draft,'Undo lost draft');return['delayed public client produces real conflict; remote winner/draft persist, Reload only reads and explicit Retry/Undo recover'];
 }finally{release();await act(async()=>root.unmount());await f.cleanup();}
}
export async function testLocalToolDefaultsAll(){return[...await testLocalToolDefaultsContract(),...await testLocalToolDefaultsSource(),...await testLocalToolDefaultsConflict()];}

/** Browser-only QA fixture; product hosts and service implementations remain unmodified. */
export function mountLocalToolDefaultsPreview(target:HTMLElement){
 const root=createRoot(target);
 function Preview(){const [current,setCurrent]=useState<Fixture>(),[era,setEra]=useState<string>(),[busy,setBusy]=useState(false),[status,setStatus]=useState('Fixture sintética SDK1528'),[proof,setProof]=useState<unknown>();
  const clear=async()=>{const old=current;flushSync(()=>setCurrent(undefined));if(old)await old.cleanup();setProof(undefined);setStatus('Fixture propia eliminada');};
  const task=async(run:()=>Promise<void>)=>{setBusy(true);try{await run();}catch(error){setStatus(String(error));}finally{setBusy(false);}};
  const prepare=async(past:boolean)=>{await clear();const next=await fixture('brave');setEra(past?'past':undefined);setCurrent(next);setStatus('Dos cuadernos propios preparados');};
  const query=async()=>{check(current,'Prepara una fixture');const a=current.client(era),b=current.client(era,current.bId),before=await sources(current),sdk=await defaults(a).get(key),mcp=await a.callTool(getTool,{namespace:iconNotebook.namespace,key}),drafts=[...target.querySelectorAll('textarea')].map(node=>node.value);setProof({projectId:current.projectId,controlId:current.controlId,scope:era??'Base',sdk,mcp,same:JSON.stringify(sdk)===JSON.stringify(mcp),shared:JSON.stringify(sdk)===JSON.stringify(await defaults(b).get(key)),sourceExact:JSON.stringify(before)===JSON.stringify(await sources(current)),drafts});};
  return <MemoryRouter><div className="min-w-0 space-y-4 p-4 text-text-primary"><h1 className="font-display text-xl">QA SDK1528 · Favorito compartido</h1><div className="flex flex-wrap gap-2">{[['Preparar Base',()=>prepare(false)],['Preparar época',()=>prepare(true)],['Consultar SDK y MCP',query],['Limpiar',clear]].map(([label,run])=><button key={String(label)} type="button" className="min-h-10 rounded-lg border border-border px-3" disabled={busy} onClick={()=>void task(run as ()=>Promise<void>)}>{String(label)}</button>)}</div><p role="status">{status}</p>{current&&<div className="grid min-w-0 gap-4 lg:grid-cols-2"><LocalToolDocumentHost key={current.aId+era} projectId={current.projectId} documentId={current.aId} eraId={era}/><LocalToolDocumentHost key={current.bId+era} projectId={current.projectId} documentId={current.bId} eraId={era}/></div>}<pre className="whitespace-pre-wrap break-words">{JSON.stringify(proof,null,2)}</pre></div></MemoryRouter>;
 }
 root.render(<Preview/>);return()=>root.unmount();
}
