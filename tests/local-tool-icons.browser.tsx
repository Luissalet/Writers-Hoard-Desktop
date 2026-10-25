import {act,useLayoutEffect,useState,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {LocalToolIcon,createLocalToolIcons,defineLocalTool,type LocalToolClient,type LocalToolIconDescriptor,type LocalToolIcons,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {sourceDocumentPreview,renderLocalToolPreview} from '@/engines/local/documents/preview';
import iconNotebook from '@/engines/local/examples/iconNotebookDefinition';
import type {IconNotebookState} from '@/engines/local/examples/IconNotebook';
import {drawPlaceCatalogIcon} from '@/engines/worldgen/cartography/placeIcon';
import {createOwnedBlockClient} from '@/engines/local/blocks/client';
import {createLocalToolBlockEnvelope,type LocalToolOwnedBlockDefinition,type LocalToolWorldBlockProps} from '@/engines/local/blocks/definitions';
import type {LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const equal=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(a)===JSON.stringify(b),message);
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(predicate:()=>boolean|Promise<boolean>,message:string){for(let attempt=0;attempt<300;attempt++){if(await predicate())return;await act(async()=>{await pause();});}throw Error(message);}
function host(){const element=document.getElementById('root');check(element,'Missing test root');return element;}
function button(label:string,within:ParentNode=host()){const value=[...within.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);check(value,'Missing button '+label);return value;}
async function click(value:HTMLElement){await act(async()=>{value.click();await pause();});}
async function input(value:HTMLInputElement|HTMLTextAreaElement,text:string){await act(async()=>{Object.getOwnPropertyDescriptor(value instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(value,text);value.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
const allBusiness=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
const pack='writer-map-symbols/1';
let registered=false;
const clients=new Map<string,LocalToolClient<IconNotebookState>>();
function register(){if(registered)return;const Original=iconNotebook.component;function Observe(props:LocalToolProps<IconNotebookState>){useLayoutEffect(()=>{if(props.client.documentId)clients.set(props.client.documentId,props.client);return()=>{if(props.client.documentId&&clients.get(props.client.documentId)===props.client)clients.delete(props.client.documentId);};},[props.client]);return <Original {...props}/>;}registerLocalToolModules({'./installed/examples.icon-notebook/module.tsx':{default:defineLocalTool({...iconNotebook,component:Observe})}});registered=true;}
async function fixture(label:string){
 register();const projectId='icons-'+label+'-'+crypto.randomUUID(),controlId=projectId+'-control';
 const project=(id:string)=>({id,title:'QA SDK icons '+label,description:'Synthetic author fixture',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['local-tool-'+iconNotebook.namespace],engineOrder:['local-tool-'+iconNotebook.namespace],worldEras:[{id:'past',name:'Past',description:'Synthetic era',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 await db.projects.bulkPut([project(projectId),project(controlId)]);
 const source=await createSourceToolDocument({projectId},iconNotebook.namespace,'QA icon notebook'),other=await createSourceToolDocument({projectId},iconNotebook.namespace,'Untouched sibling');
 const client=(eraId?:string,documentId=source.id)=>createLocalToolClient(projectId,iconNotebook,{documentId,eraId});
 const initial=await client().read();await client().save({version:1,iconId:pack+':BookOpen',notes:'Saved notes <literal>'},initial.revision,initial.document?.version);
 return{projectId,controlId,sourceId:source.id,otherId:other.id,client,cleanup:async()=>{await deleteProject(projectId);await deleteProject(controlId);}};
}

export async function testLocalToolIconsContract(){
 const f=await fixture('contract');try{
  const client=f.client(),before=await allBusiness(),ledger=JSON.stringify(getPendingWritesSnapshot()),url=location.href;
  check(client.icons,'Real client icons missing');const icons=client.icons,descriptor=await icons.get('Castle');check(descriptor,'Real Castle unavailable');
  const large=2**54;equal(await icons.search('',{offset:large}),{items:[],total:1688},'Large finite offset acquired an invented safe-integer maximum');check((await icons.search('',{limit:large})).items.length===1688,'Large finite limit was restricted');
  check(getBridgeTool('wh_local_tool_icons')?.writes===false,'Icon manifest must be readonly');
  for(const args of [{action:'packs'},{action:'get',id:'Castle'},{action:'search',query:'castle'},{action:'get',id:'other:Castle'},{action:'search',offset:large,limit:large}]){
   const result=await runBridgeTool('wh_local_tool_icons',args);check(result.ok,'Direct MCP query failed '+JSON.stringify(result));
   const scoped=await runBridgeTool('wh_local_tool_icons',{...args,projectId:'not-a-real-project',eraId:'not-a-real-era'});check(scoped.ok,'Static catalogue acquired project lookup');equal(result.result,scoped.result,'Optional scope changed static catalogue');
   equal(await client.callTool('wh_local_tool_icons',args),result.result,'SDK callTool injected scope is not accepted');
   equal(await f.client('past').callTool('wh_local_tool_icons',args),result.result,'Era callTool catalogue differs');
  }
  equal(await icons.get('Wand2'),await icons.get('WandSparkles'),'Alias differs');
  equal(await allBusiness(),before,'Icon queries changed business data');equal(JSON.stringify(getPendingWritesSnapshot()),ledger,'Icon queries flushed/changed ledger');check(location.href===url,'Icon query navigated');
  return['real SDK, direct readonly MCP and scoped callTool share metadata without DB writes/navigation; finite large pagination remains allowed'];
 }finally{await f.cleanup();}
}

function pixels(canvas:HTMLCanvasElement){const ctx=canvas.getContext('2d');check(ctx,'No real Canvas2D');return [...ctx.getImageData(0,0,canvas.width,canvas.height).data];}
function reference(name:string,size:number,color:string,ratio:number){const canvas=document.createElement('canvas');canvas.width=Math.round(size*ratio);canvas.height=Math.round(size*ratio);const ctx=canvas.getContext('2d');check(ctx,'Reference Canvas2D missing');ctx.scale(ratio,ratio);ctx.translate(size/2,size/2);check(drawPlaceCatalogIcon(ctx,{catalogIcon:{catalog:pack,name},color},size/2),'Existing painter failed');return pixels(canvas);}
function painted(){const canvas=host().querySelector<HTMLCanvasElement>('canvas');return canvas&&canvas.style.display==='block'?canvas:undefined;}
async function render(root:Root,node:ReactNode){await act(async()=>{root.render(node);await pause();});}
function WorldView({client}:LocalToolWorldBlockProps){return <LocalToolIcon client={client} icon="Castle" label="World symbol"/>;}

export async function testLocalToolIconsCanvas(){
 const root=createRoot(host()),icons=createLocalToolIcons(),client={icons};try{
  for(const name of ['Castle','AlarmClock','Drumstick','ChartScatter','Wand2'])for(const size of [24,96]){
   await render(root,<LocalToolIcon client={client} icon={name} size={size} color="#d5b575" label={name}/>);await until(()=>!!painted(),'Real icon did not paint '+name);const canvas=painted()!;equal(pixels(canvas),reference(name==='Wand2'?'WandSparkles':name,size,'#d5b575',window.devicePixelRatio||1),'Canvas differs from production painter '+name);
  }
  await render(root,<LocalToolIcon client={client} icon="unknown:Castle" size={24} color="#d5b575" label="Fallback symbol"/>);await until(()=>!!painted(),'Default fallback did not paint');equal(pixels(painted()!),reference('BookOpen',24,'#d5b575',window.devicePixelRatio||1),'Unknown did not use BookOpen');
  await render(root,<LocalToolIcon client={{}} icon="Castle" label="Old host symbol"/>);check(!painted()&&host().querySelector('svg')&&host().querySelector('[role="img"]')?.getAttribute('aria-label')==='Old host symbol','Old host did not degrade accessibly');
  const rejected:LocalToolIcons={...icons,get:async()=>{throw Error('synthetic icon provider failure');}};await render(root,<LocalToolIcon client={{icons:rejected}} icon="Castle" label="Failure symbol"/>);await act(async()=>{await pause();});check(!painted()&&host().querySelector('svg'),'Rejected provider did not remain neutral');
  const pending:{resolve:(value:LocalToolIconDescriptor|null)=>void}[]=[];
  const delayed:LocalToolIcons={...icons,get:()=>new Promise(resolve=>pending.push({resolve}))};const first={icons:delayed},second={icons:delayed};
  await render(root,<LocalToolIcon client={first} icon="Castle" label="Retarget"/>);check(pending.length===1,'First binding missing');
  await render(root,<LocalToolIcon client={second} icon="Castle" label="Retarget"/>);check(Number(pending.length)===2,'Same-service different client did not get a fresh binding');
  await act(async()=>{pending[0].resolve(await icons.get('Castle'));await pause();});check(!painted(),'Old client response painted after retarget');
  await act(async()=>{pending[1].resolve(await icons.get('Castle'));await pause();});await until(()=>!!painted(),'Current binding did not paint');
  await render(root,<LocalToolIcon client={client} icon="Missing" fallback="Missing" label="No known fallback"/>);await act(async()=>{await pause();});check(!painted()&&host().querySelector('svg'),'Unavailable explicit fallback did not stay neutral');
  const late:{resolve?:(value:LocalToolIconDescriptor|null)=>void}={};await render(root,<LocalToolIcon client={{icons:{...icons,get:()=>new Promise(resolve=>{late.resolve=resolve;})}}} icon="Castle"/>);await render(root,<p>Unmounted icon</p>);await act(async()=>{late.resolve?.(await icons.get('Castle'));await pause();});check(!host().querySelector('canvas'),'Unmounted binding recreated its canvas');
  return['real Canvas matches the production painter for ten size/shape cases; fallback, old host, rejection, same-service client retarget and unmount are safe'];
 }finally{await act(async()=>root.unmount());}
}

export async function testLocalToolIconsBlockClients(){
 const f=await fixture('blocks');const root=createRoot(host());try{
  const before=await allBusiness(),world=createLocalToolClient(f.projectId,iconNotebook,{readOnly:true});
  await render(root,<WorldView projectId={f.projectId} client={world}/>);await until(()=>!!painted(),'World readonly icon unavailable');check(await world.icons?.get('Castle'),'World metadata unavailable');
  let refused=false;try{await world.save(iconNotebook.initialState,null);}catch{refused=true;}check(refused,'World readonly client gained writes');
  const owned:LocalToolOwnedBlockDefinition<IconNotebookState>={key:'icon-owned',name:{en:'Owned',es:'Propio'},scope:'host',initialState:iconNotebook.initialState,codec:iconNotebook.codec!,validateState:iconNotebook.validateState,component:iconNotebook.component};
  let envelope=createLocalToolBlockEnvelope(iconNotebook.namespace,owned,'own-icon-block') as LocalToolOwnedBlockEnvelope,commits=0;
  const ownedClient=createOwnedBlockClient({projectId:f.projectId},iconNotebook,owned,{kind:'codex',documentId:'synthetic-owner'},{identity:'icon-owned-test',read:()=>structuredClone(envelope),subscribe:()=>()=>{},commit:async(_before,next)=>{commits++;envelope=next;}});
  await render(root,<LocalToolIcon client={ownedClient} icon="Castle" label="Owned symbol"/>);await until(()=>!!painted(),'Owned icon unavailable');equal(await ownedClient.icons?.get('Castle'),await world.icons?.get('Castle'),'Owned and world catalogue differ');check(commits===0,'Metadata committed the owned envelope');equal(await allBusiness(),before,'Block catalogue reads changed DB');
  return['World Pick accepts public icon component without casts; readonly world and normal Owned client share the catalogue without commits'];
 }finally{await act(async()=>root.unmount());await f.cleanup();}
}

function notes(){const value=host().querySelector<HTMLTextAreaElement>('textarea');check(value,'Source notes missing');return value;}
function search(){const value=host().querySelector<HTMLInputElement>('input[type="search"]');check(value,'Source search missing');return value;}
async function sourceReady(){await until(()=>!!host().querySelector('textarea:not(:disabled)')&&!!host().querySelector('ul button'),'Normal Source did not become ready');}
async function mountSource(root:Root,f:Awaited<ReturnType<typeof fixture>>,eraId?:string){await render(root,<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} eraId={eraId} documentId={f.sourceId}/></MemoryRouter>);await sourceReady();}

export async function testLocalToolIconsSource(){
 const f=await fixture('source'),root=createRoot(host());useLocaleStore.setState({locale:'en',loaded:true});try{
  const sibling=await f.client(undefined,f.otherId).read(),control=await db.projects.get(f.controlId);
  for(const eraId of [undefined,'past']){
   if(eraId){const inherited=f.client(eraId),read=await inherited.read();await inherited.save({...read.data,iconId:pack+':BookOpen'},read.revision,read.document?.version);}
   await mountSource(root,f,eraId);const client=f.client(eraId),initial=await client.read(),baseBefore=await f.client().read();const draft='Unsaved '+(eraId??'Base')+' author notes <stay literal>';
   await input(notes(),draft);const business=await allBusiness(),ledger=JSON.stringify(getPendingWritesSnapshot());
   await input(search(),'castle');await until(()=>host().querySelector('ul button')?.textContent?.trim()==='Castle','Castle search did not settle');
   equal(await allBusiness(),business,'Search saved/changed business');equal(JSON.stringify(getPendingWritesSnapshot()),ledger,'Search changed pending ledger');check(notes().value===draft,'Search lost notes draft');
   await input(search(),'');await until(()=>host().querySelectorAll('ul button').length===50,'Empty query page did not settle');await click(button('Next'));await until(()=>host().querySelector('[role="status"]')?.textContent?.startsWith('51–')===true,'Pagination did not settle');check(notes().value===draft,'Pagination lost notes draft');equal(await allBusiness(),business,'Pagination wrote business');
   await input(search(),'castle');await until(()=>!!host().querySelector('ul button')&&host().querySelector('ul button')?.textContent?.trim()==='Castle','Castle result not ready');await click(button('Castle'));await until(async()=>(await client.read()).data.iconId===pack+':Castle','Selection did not save iconId');
   const selected=await client.read();check(selected.data.notes===initial.data.notes&&notes().value===draft,'Selecting icon saved/lost notes');check(selected.revision!>initial.revision!,'Selection did not use normal revision');
   await click(button('Save notes'));await until(async()=>(await client.read()).data.notes===draft&&button('Save notes').disabled,'Explicit notes save not confirmed');const saved=await client.read();check(saved.data.iconId===pack+':Castle','Saving notes changed selected icon');
   await click(button('Undo'));await until(async()=>(await client.read()).data.notes===initial.data.notes,'Undo did not restore notes');check((await client.read()).data.iconId===pack+':Castle','Notes undo removed icon selection');await click(button('Redo'));await until(async()=>(await client.read()).data.notes===draft,'Redo did not restore notes');
   await render(root,<p>Closed Source</p>);await mountSource(root,f,eraId);check(notes().value===draft,'Reopened Source lost notes');check((await client.read()).data.iconId===pack+':Castle','Reopened Source lost identity');
   if(eraId)equal(await f.client().read(),baseBefore,'Era writes changed Base');
  }
  const client=f.client('past');await input(notes(),'Conflict draft stays');const remote=f.client('past'),observed=await remote.read();check(remote.state,'Source state API missing');await act(async()=>{await remote.state!.apply(observed,[{type:'set',field:'notes',value:'Remote independent notes'}]);await pause();});await click(button('Save notes'));await until(()=>!!host().querySelector('[role="alert"]'),'Overlapping notes conflict was not shown');check(notes().value==='Conflict draft stays','Conflict lost draft');check((await client.read()).data.notes==='Remote independent notes','Conflict overwrote saved remote notes');
  await click(button('Discard draft and reload'));await until(()=>notes().value==='Remote independent notes','Explicit recovery did not reload');
  const observedUnknown=await client.read();await client.save({...observedUnknown.data,iconId:'future:Unknown',notes:'<script>literal-not-executed</script>'},observedUnknown.revision,observedUnknown.document?.version);await render(root,<p>Close unknown</p>);await mountSource(root,f,'past');check(notes().value==='<script>literal-not-executed</script>','Literal notes changed');const read=await client.read();check(read.data.iconId==='future:Unknown','Unknown persisted ID was rewritten');
  const stored=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId,'past','local-tool',f.sourceId]).first())?.document?.root;check(stored,'Era Source portable row absent');const html=renderLocalToolPreview(sourceDocumentPreview(stored as unknown as Parameters<typeof sourceDocumentPreview>[0]));check(html.includes('future:Unknown')&&html.includes('&lt;script&gt;literal-not-executed&lt;/script&gt;')&&!html.includes('<script>'),'Preview invented icon atom or active prose');
  equal(await f.client(undefined,f.otherId).read(),sibling,'Sibling Source changed');equal(await db.projects.get(f.controlId),control,'Foreign synthetic control project changed');
  return['normal Source Base/era preserves draft during query/page; selection writes only iconId, Save notes only notes, Undo/Redo/reopen/conflict/recovery and literal unknown preview work'];
 }finally{await act(async()=>root.unmount());await f.cleanup();}
}

export async function testLocalToolIconsAll(){return[...await testLocalToolIconsContract(),...await testLocalToolIconsCanvas(),...await testLocalToolIconsBlockClients(),...await testLocalToolIconsSource()];}

const channel=window as unknown as {__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string};
export async function testLocalToolIconsLayout(){
 const f=await fixture('layout'),root=createRoot(host()),tests:string[]=[];try{for(const locale of ['en','es'] as const)for(const width of [1280,390]){
  const n=width+(locale==='es'?2000:0);await act(async()=>{channel.__want={n,w:width,h:1000};await pause();});await until(()=>channel.__sizeAck===n,'CSS viewport handshake missing');useLocaleStore.setState({locale,loaded:true});await mountSource(root,f);await input(search(),'castle');await until(()=>host().querySelectorAll('ul button').length===1,'CSS catalogue search unsettled');
  const section=host().querySelector('section[aria-label]');check(section,'CSS Source missing');check(section.scrollWidth<=section.clientWidth+1,'Source overflows '+locale+width);for(const control of section.querySelectorAll<HTMLElement>('button,input')){const rect=control.getBoundingClientRect();check(rect.height>=39,'Control below40px '+control.textContent);check(rect.left>=-1&&rect.right<=innerWidth+1,'Control out of viewport');}
  check(host().querySelector('canvas')&&getComputedStyle(host().querySelector('h2')!).fontFamily.length>0,'CSS or canvas missing');const file=`sdk-icons-${locale}-${width}`;channel.__shot={name:file};await until(()=>channel.__shotDone===file,'CSS screenshot handshake missing');tests.push('CSS '+locale+' '+width+' local reflow/40px controls; screenshot '+file);
 }}finally{await act(async()=>root.unmount());await f.cleanup();}return tests;
}

/** Root-only author preview on the existing Vite origin; the displayed tool is product source. */
export function mountLocalToolIconsPreview(element:HTMLElement){const root=createRoot(element);function Preview(){const [current,setCurrent]=useState<Awaited<ReturnType<typeof fixture>>>(),[era,setEra]=useState<string>(),[status,setStatus]=useState('Fixture sintética SDK1523'),[result,setResult]=useState<unknown>();const task=async(run:()=>Promise<void>)=>{try{await run();}catch(error){setStatus(String(error));}};const clear=async()=>{const previous=current;flushSync(()=>setCurrent(undefined));if(previous)await previous.cleanup();clients.clear();setResult(undefined);setStatus('Fixture propia eliminada');};const prepare=async(past:boolean)=>{await clear();const next=await fixture('preview');setEra(past?'past':undefined);setCurrent(next);setStatus('Fixture propia preparada');};const query=async()=>{check(current,'Prepara una fixture');const client=current.client(era),before=await client.read(),draft=element.querySelector('textarea')?.value,ledger=JSON.stringify(getPendingWritesSnapshot());const sdk=await client.icons?.search('castle'),mcp=await client.callTool('wh_local_tool_icons',{action:'search',query:'castle'});setResult({sdk,mcp,same:JSON.stringify(sdk)===JSON.stringify(mcp),snapshotExact:JSON.stringify(before)===JSON.stringify(await client.read()),draftBefore:draft,draftAfter:element.querySelector('textarea')?.value,ledgerExact:ledger===JSON.stringify(getPendingWritesSnapshot())});};return <MemoryRouter><div className="min-w-0 space-y-4 p-4 text-text-primary"><h1 className="font-display text-xl">QA SDK1523 · Catálogo de iconos</h1><div className="flex flex-wrap gap-2"><button className="min-h-10 rounded-lg border border-border px-3" onClick={()=>void task(()=>prepare(false))}>Preparar Base</button><button className="min-h-10 rounded-lg border border-border px-3" onClick={()=>void task(()=>prepare(true))}>Preparar época</button><button className="min-h-10 rounded-lg border border-border px-3" disabled={!current} onClick={()=>void task(query)}>Consultar SDK y MCP</button><button className="min-h-10 rounded-lg border border-border px-3" onClick={()=>void task(clear)}>Limpiar</button></div><p role="status">{status}</p>{current&&<LocalToolDocumentHost key={current.sourceId+era} projectId={current.projectId} documentId={current.sourceId} eraId={era}/>}<pre className="whitespace-pre-wrap break-words">{JSON.stringify(result,null,2)}</pre></div></MemoryRouter>;}root.render(<Preview/>);return()=>root.unmount();}


/** F1-only supplement: both product alerts, with real Source notes conflict and a failing search port. */
export async function testLocalToolIconsErrorLayout(){
 const f=await fixture('error-layout'),root=createRoot(host()),tests:string[]=[];
 try{
  await act(async()=>{useLocaleStore.setState({locale:'es',loaded:true});});
  const client=f.client(),icons=client.icons;check(icons,'Real icon service missing in error fixture');
  const wrapped:LocalToolClient<IconNotebookState>={...client,icons:{...icons,search:async()=>{throw Error('Synthetic search rejection for finish F1');}}};
  const Original=iconNotebook.component;
  await render(root,<MemoryRouter><Original projectId={f.projectId} client={wrapped} context={{view:'editor',canEdit:true,scope:{projectId:f.projectId},document:{id:f.sourceId,namespace:iconNotebook.namespace,title:'QA icon notebook'}}}/></MemoryRouter>);
  await until(()=>!!host().querySelector('textarea:not(:disabled)')&&host().querySelectorAll('[role="alert"]').length===1,'Product catalogue rejection did not display');
  const draft='Borrador F1 conservado tras conflicto real';await input(notes(),draft);
  const remote=f.client(),observed=await remote.read();check(remote.state,'Real Source state actions missing');
  await act(async()=>{await remote.state!.apply(observed,[{type:'set',field:'notes',value:'Notas remotas F1 guardadas'}]);await pause();});
  await click(button('Guardar notas'));await until(()=>host().querySelectorAll('[role="alert"]').length===2,'Real notes conflict did not display alongside catalogue error');
  check(notes().value===draft,'Error state lost the draft');check((await client.read()).data.notes==='Notas remotas F1 guardadas','Error state overwrote remote saved notes');
  const luminance=(css:string)=>{const numbers=css.match(/[\d.]+/g)?.slice(0,3).map(Number);check(numbers?.length===3,'Unexpected computed RGB ink '+css);const channel=numbers.map(value=>{const x=value/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;});return channel[0]*0.2126+channel[1]*0.7152+channel[2]*0.0722;};
  for(const width of [1280,390]){
   const n=width+9000;await act(async()=>{channel.__want={n,w:width,h:1000};await pause();});await until(()=>channel.__sizeAck===n,'F1 viewport handshake missing');
   const alerts=[...host().querySelectorAll<HTMLElement>('[role="alert"]')];check(alerts.length===2,'Both product alerts must remain visible');
   check(alerts[0].textContent?.includes('consultar el catálogo')&&alerts[1].textContent?.includes('guardar el cambio'),'F1 error messages were replaced');
   const background=getComputedStyle(document.body).backgroundColor,back=luminance(background);
   const evidence=alerts.map(alert=>{const color=getComputedStyle(alert).color,ink=luminance(color),ratio=(Math.max(ink,back)+0.05)/(Math.min(ink,back)+0.05),box=alert.getBoundingClientRect();check(ratio>=4.5,'F1 alert contrast below4.5:1');check(box.width>0&&box.height>0&&box.left>=0&&box.right<=innerWidth+1,'F1 alert clipped');return{text:alert.textContent,color,background,ratio};});
   console.log('F1_ERROR_CONTRAST '+JSON.stringify({width,evidence}));
   const file='sdk-icons-errors-es-'+width;channel.__shot={name:file};await until(()=>channel.__shotDone===file,'F1 error screenshot missing');tests.push('F1 both product alerts/'+width+' computed contrast>=4.5, draft and remote notes preserved; '+file);
  }
 }finally{await act(async()=>root.unmount());await f.cleanup();}return tests;
}

/** One final capture batch: the four original normal states plus the two F1 error states. */
export async function testLocalToolIconsLayoutAndErrors(){return[...await testLocalToolIconsLayout(),...await testLocalToolIconsErrorLayout()];}
