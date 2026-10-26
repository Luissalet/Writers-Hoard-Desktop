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
import iconNotebook from '@/engines/local/examples/iconNotebookDefinition';
import type {IconNotebookState} from '@/engines/local/examples/IconNotebook';
import type {LocalToolClient,LocalToolIcons} from '@/engines/local/sdk';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const equal=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(a)===JSON.stringify(b),message);
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(predicate:()=>boolean|Promise<boolean>,message:string){for(let attempt=0;attempt<300;attempt++){if(await predicate())return;await act(async()=>{await pause();});}throw Error(message);}
function host(){const value=document.getElementById('root');check(value,'Missing test root');return value;}
function button(label:string){const value=[...host().querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);check(value,'Missing button '+label);return value;}
async function click(value:HTMLElement){await act(async()=>{value.click();await pause();});}
async function input(value:HTMLInputElement|HTMLTextAreaElement,text:string){await act(async()=>{Object.getOwnPropertyDescriptor(value instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(value,text);value.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
async function render(root:Root,node:ReactNode){await act(async()=>{root.render(node);await pause();});}
function notes(){const value=host().querySelector<HTMLTextAreaElement>('textarea');check(value,'Source notes missing');return value;}
function search(){const value=host().querySelector<HTMLInputElement>('input[type="search"]');check(value,'Source search missing');return value;}
async function ready(){await until(()=>!!host().querySelector('textarea:not(:disabled)')&&host().querySelectorAll('ul button').length>0,'Source did not become ready');}
const business=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
const ledger=()=>JSON.stringify(getPendingWritesSnapshot());
const pack='writer-map-symbols/1';
let registered=false;
function register(){if(!registered){registerLocalToolModules({'./installed/examples.icon-notebook/module.tsx':{default:iconNotebook}});registered=true;}}
async function fixture(label:string){
 register();const projectId='icons-svg-'+label+'-'+crypto.randomUUID(),controlId=projectId+'-control';
 const project=(id:string)=>({id,title:'QA SDK icon SVG '+label,description:'Synthetic author fixture',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['local-tool-'+iconNotebook.namespace],engineOrder:['local-tool-'+iconNotebook.namespace],worldEras:[{id:'past',name:'Past',description:'Synthetic era',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 await db.projects.bulkPut([project(projectId),project(controlId)]);
 const source=await createSourceToolDocument({projectId},iconNotebook.namespace,'QA SVG notebook'),sibling=await createSourceToolDocument({projectId},iconNotebook.namespace,'Untouched SVG sibling');
 const client=(eraId?:string,documentId=source.id)=>createLocalToolClient(projectId,iconNotebook,{documentId,eraId});
 const initial=await client().read();await client().save({version:1,iconId:pack+':Castle',notes:'Saved independent notes <literal>'},initial.revision,initial.document?.version);
 return{projectId,controlId,sourceId:source.id,siblingId:sibling.id,client,cleanup:async()=>{await deleteProject(projectId);await deleteProject(controlId);}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function mountSource(root:Root,f:Fixture,eraId?:string){await render(root,<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.sourceId} eraId={eraId}/></MemoryRouter>);await ready();}
async function mountClient(root:Root,f:Fixture,client:LocalToolClient<IconNotebookState>){const Component=iconNotebook.component;await render(root,<MemoryRouter><Component projectId={f.projectId} client={client} context={{view:'editor',canEdit:true,scope:{projectId:f.projectId,eraId:client.eraId},document:{id:f.sourceId,namespace:iconNotebook.namespace,title:'QA SVG notebook'}}}/></MemoryRouter>);await ready();}
function trapDownloads(){
 const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click,urls=new Map<string,Blob>(),items:{filename:string;blob:Blob}[]=[];
 URL.createObjectURL=function(blob:Blob|MediaSource){const url=originalCreate.call(URL,blob);if(blob instanceof Blob)urls.set(url,blob);return url;};
 HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.svg')){const blob=urls.get(this.href);check(blob,'Product download did not use a real Blob URL');items.push({filename:this.download,blob});return;}originalClick.call(this);};
 return{items,restore:()=>{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}};
}

export async function testLocalToolIconSvgContract(){
 const f=await fixture('contract');try{
  const client=f.client(),past=f.client('past'),world=createLocalToolClient(f.projectId,iconNotebook,{readOnly:true});
  check(client.icons?.resolveSvg&&past.icons?.resolveSvg&&world.icons?.resolveSvg,'Runtime SVG port missing');
  const before=await business(),pending=ledger(),snapshot=await client.read(),url=location.href;
  const old=getBridgeTool('wh_local_tool_icons') as unknown as {schema:{properties:{action:{enum:string[]}}}};
  equal(old.schema.properties.action.enum,['packs','get','search'],'Metadata MCP enum changed');
  const tool=getBridgeTool('wh_local_tool_icon_svg');check(tool?.writes===false,'New SVG tool must be readonly');
  for(const id of ['Castle',pack+':Castle','Wand2',pack+':Wand2','UnknownSymbol','foreign:Castle','']){
   const svg=await client.icons.resolveSvg(id),direct=await runBridgeTool('wh_local_tool_icon_svg',{id});check(direct.ok,'Direct SVG MCP failed '+JSON.stringify(direct));
   equal(direct.result,svg,'Direct SDK/MCP SVG bytes/null differ');
   const global=await runBridgeTool('wh_local_tool_icon_svg',{id,projectId:'missing-synthetic-project',eraId:'missing-era'});check(global.ok,'Global SVG queried the project');equal(global.result,svg,'Optional scope changed SVG');
   equal(await client.callTool('wh_local_tool_icon_svg',{id}),svg,'Base scoped callTool differs');equal(await past.callTool('wh_local_tool_icon_svg',{id}),svg,'Era scoped callTool differs');equal(await world.icons.resolveSvg(id),svg,'Readonly world client differs');
  }
  for(const args of [{},{id:7}])check(!(await runBridgeTool('wh_local_tool_icon_svg',args)).ok,'Invalid direct SVG arguments accepted');
  for(const args of [{},{id:{}}]){let rejected=false;try{await client.callTool('wh_local_tool_icon_svg',args);}catch{rejected=true;}check(rejected,'Invalid scoped SVG arguments accepted');}
  equal(await client.callTool('wh_local_tool_icon_svg',{id:7}),null,'Existing number-to-string coercion changed');
  const extra=await runBridgeTool('wh_local_tool_icon_svg',{id:'Castle',url:'https://example.invalid/icon.svg'});check(extra.ok,'Direct ignored extra argument failed');
  equal(extra.result,await client.icons.resolveSvg('Castle'),'Extra URL replaced the local vector');
  equal(await client.callTool('wh_local_tool_icon_svg',{id:'Castle',url:'https://example.invalid/icon.svg'}),extra.result,'Scoped normalizer did not ignore unknown extra field');
  check((await client.icons.resolveSvg('Castle'))?.includes('<metadata>'),'Real vector/no notices missing');
  equal(await client.read(),snapshot,'SVG queries changed Source snapshot');equal(await business(),before,'SVG queries changed business');check(ledger()===pending&&location.href===url,'SVG queries changed pending ledger/navigation');
  return['real SDK/Base/era/readonly world, new MCP direct/scoped callTool share SVG/null without writes; old metadata enum intact'];
 }finally{await f.cleanup();}
}

export async function testLocalToolIconSvgSource(){
 const f=await fixture('source'),root=createRoot(host()),downloads=trapDownloads();useLocaleStore.setState({locale:'en',loaded:true});try{
  const sibling=await f.client(undefined,f.siblingId).read(),control=await db.projects.get(f.controlId);
  for(const eraId of [undefined,'past']){
   const client=f.client(eraId),observed=await client.read();await client.save({...observed.data,iconId:'Wand2'},observed.revision,observed.document?.version);
   await render(root,<p>Close earlier Source</p>);await mountSource(root,f,eraId);
   const draft='Unsaved '+(eraId??'Base')+' notes during SVG';await input(notes(),draft);
   const saved=await client.read(),before=await business(),pending=ledger(),count=downloads.items.length;
   await click(button('Download SVG'));await until(()=>downloads.items.length===count+1,'Normal Source did not start the product SVG download');
   const item=downloads.items[count];check(item.filename==='WandSparkles.svg','Alias filename was not canonical');check(item.blob.type==='image/svg+xml;charset=utf-8','SVG MIME changed');
   check(await item.blob.text()===await client.icons!.resolveSvg!('Wand2'),'Product download bytes differ from real SDK');
   check(notes().value===draft,'Download lost draft');equal(await client.read(),saved,'Download saved/changed notes/ID/revision');equal(await business(),before,'Download changed business');check(ledger()===pending,'Download flushed ledger');
   await click(button('Save notes'));await until(async()=>(await client.read()).data.notes===draft,'Save notes no longer works');
   await click(button('Undo'));await until(async()=>(await client.read()).data.notes===saved.data.notes,'Undo notes failed');check((await client.read()).data.iconId==='Wand2','Undo notes changed ID');
   await click(button('Redo'));await until(async()=>(await client.read()).data.notes===draft,'Redo notes failed');
  }
  equal(await f.client(undefined,f.siblingId).read(),sibling,'Sibling Source changed');equal(await db.projects.get(f.controlId),control,'Control project changed');
  return['normal Source Base/era downloads actual Blob SVG with canonical alias filename, preserving draft/snapshot/ledger; explicit Save notes and Undo/Redo remain normal'];
 }finally{downloads.restore();await act(async()=>root.unmount());await f.cleanup();}
}

export async function testLocalToolIconSvgLifecycle(){
 const f=await fixture('lifecycle'),root=createRoot(host()),downloads=trapDownloads();useLocaleStore.setState({locale:'en',loaded:true});try{
  const base=f.client(),real=base.icons;check(real?.resolveSvg,'Lifecycle real SVG missing');
  const jobs:{id:string;resolve:(value:string|null)=>void}[]=[];
  const shared:LocalToolIcons={...real,resolveSvg:id=>new Promise(resolve=>jobs.push({id,resolve}))};
  const first={...base,icons:shared},second={...base,icons:shared};
  await mountClient(root,f,first);await input(notes(),'Draft before async SVG');
  const before=await business(),pending=ledger();await click(button('Download SVG'));await until(()=>jobs.length===1,'Deferred SVG request missing');check(button('Download SVG').disabled,'Busy SVG button is enabled');check(!notes().disabled,'SVG blocked note editing');
  await input(notes(),'Draft edited while SVG awaits');jobs[0].resolve(await real.resolveSvg('Castle'));await until(()=>downloads.items.length===1,'Editing notes incorrectly invalidated SVG');
  check(notes().value==='Draft edited while SVG awaits','Async download lost edited notes');equal(await business(),before,'Async download wrote Source');check(ledger()===pending,'Async download flushed ledger');

  await click(button('Download SVG'));await until(()=>jobs.length===2,'Second request missing');await mountClient(root,f,second);jobs[1].resolve(await real.resolveSvg('Castle'));await act(async()=>{await pause();});check(downloads.items.length===1,'Different client sharing icons resurrected old export');
  await click(button('Download SVG'));await until(()=>jobs.length===3,'Selection-cycle request missing');
  await input(search(),'book open');await until(()=>[...host().querySelectorAll('ul button')].some(b=>b.textContent?.trim()==='Book Open'),'Book Open result missing');await click(button('Book Open'));await until(async()=>(await base.read()).data.iconId===pack+':BookOpen','B selection did not settle');
  await input(search(),'castle');await until(()=>[...host().querySelectorAll('ul button')].some(b=>b.textContent?.trim()==='Castle'),'Castle result missing');await click(button('Castle'));await until(async()=>(await base.read()).data.iconId===pack+':Castle','A selection did not return');
  jobs[2].resolve(await real.resolveSvg('Castle'));await act(async()=>{await pause();});check(downloads.items.length===1,'A→B→A revived an earlier export');check(notes().value==='Draft edited while SVG awaits','Selection cycle changed draft');
  await click(button('Download SVG'));await until(()=>jobs.length===4,'Unmount request missing');await render(root,<p>Closed consumer</p>);jobs[3].resolve(await real.resolveSvg('Castle'));await act(async()=>{await pause();});check(downloads.items.length===1,'Unmounted consumer started a download');

  let reject=true;const failureClient={...base,icons:{...real,resolveSvg:async(id:string)=>{if(reject)throw Error('Synthetic explicit SVG provider rejection');return real.resolveSvg!(id);}}};
  await mountClient(root,f,failureClient);await input(notes(),'Error draft remains');const errorBusiness=await business(),errorLedger=ledger();await click(button('Download SVG'));await until(()=>!!host().querySelector('[role="alert"]')?.textContent?.includes('prepare the SVG'),'SVG error not shown');check(notes().value==='Error draft remains'&&!button('Download SVG').disabled,'Error blocked recovery or lost draft');equal(await business(),errorBusiness,'SVG rejection wrote state');check(ledger()===errorLedger,'Rejection flushed ledger');
  reject=false;await click(button('Download SVG'));await until(()=>downloads.items.length===2,'Explicit SVG retry failed');
  const absent={...base,icons:{...real,resolveSvg:undefined}};await mountClient(root,f,absent);check(button('Download SVG').disabled&&host().textContent?.includes('This host does not provide SVG'),'Absent capability was advertised');check(!notes().disabled,'Absent SVG disabled notes');checkNoOverflow();checkMessageContrast();
  await render(root,<p>Close previous draft before another scenario</p>);const known=await base.read();await base.save({...known.data,iconId:'future:Unknown'},known.revision,known.document?.version);await mountSource(root,f);check(host().textContent?.includes('future:Unknown'),'Reopened Source lost unknown stored ID');await input(notes(),'Unknown symbol draft stays');
  const unknown=await base.read(),unknownBusiness=await business(),unknownLedger=ledger(),count=downloads.items.length;await click(button('Download SVG'));await until(()=>host().textContent?.includes('No SVG is available for this symbol.')===true,'Unknown SVG did not show unavailability');check(downloads.items.length===count,'Unknown ID became fallback download');check(notes().value==='Unknown symbol draft stays','Unknown query lost draft');equal(await base.read(),unknown,'Unknown ID rewritten');equal(await business(),unknownBusiness,'Unknown query wrote business');check(ledger()===unknownLedger,'Unknown query flushed ledger');
  return['async SVG preserves editable notes; different clients/same service, selection A→B→A and unmount revoke irreversibly; rejection/retry, absent host and unknown ID preserve data'];
 }finally{downloads.restore();await act(async()=>root.unmount());await f.cleanup();}
}

export async function testLocalToolIconSvgAll(){return[...await testLocalToolIconSvgContract(),...await testLocalToolIconSvgSource(),...await testLocalToolIconSvgLifecycle()];}

function checkNoOverflow(){const section=host().querySelector<HTMLElement>('section[aria-label]');check(section&&section.scrollWidth<=section.clientWidth+1,'SVG Source overflows');for(const control of section.querySelectorAll<HTMLElement>('button,input,textarea')){const r=control.getBoundingClientRect();check(r.height>=39&&r.left>=-1&&r.right<=innerWidth+1,'SVG control clipped/below40px');}}
function checkMessageContrast(){
 const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)?.slice(0,3).map(Number);check(rgb?.length===3,'Unexpected computed ink '+color);const x=rgb.map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return x[0]*.2126+x[1]*.7152+x[2]*.0722;};
 const back=getComputedStyle(document.body).backgroundColor,b=luminance(back),messages=[...host().querySelectorAll<HTMLElement>('[role="status"],[role="alert"]')].filter(node=>node.textContent?.includes('SVG'));
 check(messages.length>0,'SVG status/alert missing');return messages.map(node=>{const color=getComputedStyle(node).color,l=luminance(color),ratio=(Math.max(l,b)+.05)/(Math.min(l,b)+.05);check(ratio>=4.5,'SVG message contrast below4.5');return{text:node.textContent,color,background:back,ratio};});
}
const channel=window as unknown as {__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string};
export async function testLocalToolIconSvgLayout(){
 const f=await fixture('layout'),root=createRoot(host()),downloads=trapDownloads(),tests:string[]=[];let sequence=16000;
 try{
  const scenes=[...(['en','es'] as const).flatMap(locale=>[1280,390].map(width=>({locale,width,state:'started' as const}))),...[1280,390].map(width=>({locale:'en' as const,width,state:'busy' as const})),...[1280,390].map(width=>({locale:'es' as const,width,state:'error' as const}))];
  for(const scene of scenes){
   const n=++sequence;channel.__want={n,w:scene.width,h:1000};await until(()=>channel.__sizeAck===n,'SVG viewport handshake missing');await act(async()=>{useLocaleStore.setState({locale:scene.locale,loaded:true});});await render(root,<p>Change scene</p>);
   const client=f.client(),real=client.icons;check(real?.resolveSvg,'Layout real SVG missing');let resolve:((value:string|null)=>void)|undefined;
   const provider=scene.state==='busy'?{...real,resolveSvg:()=>new Promise<string|null>(done=>{resolve=done;})}:scene.state==='error'?{...real,resolveSvg:async()=>{throw Error('Synthetic layout SVG rejection');}}:real;
   await mountClient(root,f,{...client,icons:provider});await input(search(),'castle');await until(()=>host().querySelectorAll('ul button').length===1,'SVG layout search unsettled');await input(notes(),scene.locale==='es'?'Borrador sin guardar mientras se prepara el símbolo.':'Unsaved draft while preparing the symbol.');
   const before=await client.read(),pending=ledger(),count=downloads.items.length,label=scene.locale==='es'?'Descargar SVG':'Download SVG';await click(button(label));
   if(scene.state==='started')await until(()=>downloads.items.length===count+1,'SVG layout download missing');else if(scene.state==='busy')await until(()=>!!resolve&&button(label).disabled,'SVG busy layout missing');else await until(()=>!!host().querySelector('[role="alert"]')?.textContent?.includes('preparar el SVG'),'SVG error layout missing');
   await act(async()=>{await pause();await pause();});checkNoOverflow();const contrast=checkMessageContrast();equal(await client.read(),before,'SVG layout wrote Source');check(ledger()===pending,'SVG layout flushed ledger');check(notes().value.includes(scene.locale==='es'?'Borrador':'Unsaved'),'SVG layout lost draft');
   if(scene.state!=='busy'){button(label).focus();check(Number.parseFloat(getComputedStyle(button(label)).outlineWidth)>=2,'SVG control focus outline absent');}
   console.log('SVG_LAYOUT '+JSON.stringify({locale:scene.locale,width:scene.width,state:scene.state,contrast}));
   const name='sdk-icon-svg-'+scene.state+'-'+scene.locale+'-'+scene.width;channel.__shot={name};await until(()=>channel.__shotDone===name,'SVG screenshot handshake missing');tests.push('settled CSS '+scene.locale+'/'+scene.width+'/'+scene.state+'; contrast>=4.5,40px controls, draft and snapshot exact; '+name);
   await render(root,<p>Scene complete</p>);resolve?.(null);
  }
 }finally{downloads.restore();await act(async()=>root.unmount());await f.cleanup();}return tests;
}

/** Normal product Source on ROOT's existing Vite origin. This preview does not intercept downloads. */
export function mountLocalToolIconSvgPreview(element:HTMLElement){
 const root=createRoot(element);
 function Preview(){
  const [current,setCurrent]=useState<Fixture>(),[era,setEra]=useState<string>(),[busy,setBusy]=useState(false),[status,setStatus]=useState('Fixture sintética SDK1526'),[result,setResult]=useState<unknown>();
  const clear=async()=>{const previous=current;flushSync(()=>setCurrent(undefined));if(previous)await previous.cleanup();setResult(undefined);setStatus('Fixture propia eliminada');};
  const task=async(run:()=>Promise<void>)=>{setBusy(true);try{await run();}catch(error){setStatus(String(error));}finally{setBusy(false);}};
  const prepare=async(past:boolean)=>{await clear();const next=await fixture('preview');setEra(past?'past':undefined);setCurrent(next);setStatus('Fixture propia preparada');};
  const query=async()=>{check(current,'Prepara una fixture');const client=current.client(era),before=await client.read(),draft=element.querySelector('textarea')?.value,pending=ledger();check(client.icons?.resolveSvg,'Host sin SVG');const sdk=await client.icons.resolveSvg('Castle'),mcp=await client.callTool('wh_local_tool_icon_svg',{id:'Castle'}),unknownSdk=await client.icons.resolveSvg('future:Unknown'),unknownMcp=await client.callTool('wh_local_tool_icon_svg',{id:'future:Unknown'});setResult({projectId:current.projectId,controlId:current.controlId,scope:era??'Base',same:sdk===mcp,svgBytes:new TextEncoder().encode(sdk??'').length,unknownSdk,unknownMcp,snapshotExact:JSON.stringify(before)===JSON.stringify(await client.read()),ledgerExact:pending===ledger(),draftBefore:draft,draftAfter:element.querySelector('textarea')?.value});};
  return <MemoryRouter><div className="min-w-0 space-y-4 p-4 text-text-primary"><h1 className="font-display text-xl">QA SDK1526 · SVG de símbolos</h1><div className="flex flex-wrap gap-2"><button className="min-h-10 rounded-lg border border-border px-3" disabled={busy} onClick={()=>void task(()=>prepare(false))}>Preparar Base</button><button className="min-h-10 rounded-lg border border-border px-3" disabled={busy} onClick={()=>void task(()=>prepare(true))}>Preparar época</button><button className="min-h-10 rounded-lg border border-border px-3" disabled={busy||!current} onClick={()=>void task(query)}>Consultar SDK y MCP SVG</button><button className="min-h-10 rounded-lg border border-border px-3" disabled={busy} onClick={()=>void task(clear)}>Limpiar</button></div><p role="status">{status}</p>{current&&<LocalToolDocumentHost key={current.sourceId+era} projectId={current.projectId} documentId={current.sourceId} eraId={era}/>}<pre className="whitespace-pre-wrap break-words">{JSON.stringify(result,null,2)}</pre></div></MemoryRouter>;
 }
 root.render(<Preview/>);return()=>root.unmount();
}
