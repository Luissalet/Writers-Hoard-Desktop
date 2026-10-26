// Contract-first theme1532: these tests run unchanged before and after product work.
import {act,Fragment,useEffect,useState,type ComponentType,type CSSProperties,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {BookOpen} from 'lucide-react';
import * as SDK from '@/engines/local/sdk';
import type {LocalToolClient,LocalToolJson} from '@/engines/local/sdk';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createLocalToolClient} from '@/engines/local/storage';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {LocalToolUndoBoundary} from '@/engines/local/LocalToolUndoBoundary';
import definition from '@/engines/local/examples/iconNotebookDefinition';
import type {IconNotebookState} from '@/engines/local/examples/IconNotebook';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {getWorkspaceAppearance} from '@/services/workspaceAppearance/store';
import {workspaceAppearanceStyle} from '@/services/workspaceAppearance/style';
import type {WorkspaceAppearanceValues} from '@/services/workspaceAppearance/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {tabsStorageKey} from '@/components/project/workspace/workspaceTabs';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import type {EngineDefinition} from '@/engines/_types';
import {useLocaleStore} from '@/stores/localeStore';

const keys=['--color-deep','--color-surface','--color-elevated','--color-border','--color-border-hover','--color-text-primary','--color-text-muted','--color-text-dim','--color-accent-gold'] as const;
type Scope={projectId:string;eraId?:string};
interface Snapshot extends Scope{mode:'light'|'dark';tokens:Readonly<Record<typeof keys[number],string>>}
interface ThemePort{get():Promise<Snapshot>;subscribe(changed:()=>void):()=>void}
interface ThemeView{snapshot?:Snapshot;available:boolean;loading:boolean;error:string;retry():void}
interface ProposedSDK{LocalToolAppliedThemeProvider?:ComponentType<{scope:Scope;style:CSSProperties;children:ReactNode}>;useLocalToolTheme?:(client:{readonly theme?:ThemePort})=>ThemeView}
type Client=LocalToolClient<IconNotebookState>;
const proposed=SDK as unknown as ProposedSDK;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const json=(value:unknown)=>JSON.stringify(canonical(value)),same=(a:unknown,b:unknown,message:string)=>check(json(a)===json(b),message);
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
async function until(test:()=>boolean|Promise<boolean>,message:string){for(let i=0;i<180;i++){if(await test())return;await act(async()=>{await pause();});}throw Error(message);}
async function rejects(run:()=>unknown,message:string){let failed=false;try{await run();}catch{failed=true;}check(failed,message);}
const business=async()=>json(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()]))),pending=()=>json(getPendingWritesSnapshot());
async function direct(name:string,args:Record<string,unknown>){const reply=await runBridgeTool(name,args);check(reply.ok,'Normal dispatcher failed '+name+': '+json(reply));return reply.result;}
async function saveAppearance(scope:Scope,patch:WorkspaceAppearanceValues){const read=await getWorkspaceAppearance(scope);await direct('wh_workspace_appearance_save',{...scope,patch,expectedRevision:read.revision});}
function theme(client:Client):ThemePort{const port=(client as unknown as {readonly theme?:ThemePort}).theme;check(port&&typeof port.get==='function'&&typeof port.subscribe==='function','local_tool_theme_missing_after_positive_source');return port;}
function validate(snapshot:Snapshot,scope:Scope){check(snapshot.projectId===scope.projectId&&snapshot.eraId===scope.eraId,'Theme stole project/era context');check(snapshot.mode==='dark'||snapshot.mode==='light','Invalid effective mode');same(Object.keys(snapshot.tokens).sort(),[...keys].sort(),'Theme must expose exactly the nine contracted colors');for(const key of keys)check(/^#[\da-f]{6}$/i.test(snapshot.tokens[key]),'Unresolved color '+key);}
function color(value:string){const probe=document.createElement('span');probe.style.color=value;document.body.append(probe);const result=getComputedStyle(probe).color;probe.remove();return result;}
function rgb(value:string){const values=value.match(/[\d.]+/g)?.slice(0,3).map(Number);check(values?.length===3,'Invalid computed color '+value);return values;}
function canvas(container:ParentNode){const node=container.querySelector<HTMLCanvasElement>('canvas');check(node,'Missing real Canvas');return node;}
function pixel(node:HTMLCanvasElement){const ctx=node.getContext('2d');check(ctx,'Missing 2D context');const data=ctx.getImageData(0,0,node.width,node.height).data;let best=0;for(let i=3;i<data.length;i+=4)if(data[i]>data[best+3])best=i-3;check(data[best+3]>240,'Real icon did not paint opaque pixels');return Array.from(data.slice(best,best+3));}
const painted=(node:HTMLCanvasElement,ink:string)=>{try{return pixel(node).every((value,i)=>Math.abs(value-rgb(ink)[i])<=2);}catch{return false;}};
async function readyIcon(container:ParentNode){await until(()=>{const node=container.querySelector<HTMLCanvasElement>('canvas');return!!node&&node.style.display==='block'&&painted(node,getComputedStyle(node.parentElement!).color);},'Positive current Canvas painter did not draw inherited ink');return canvas(container);}
function textarea(container:ParentNode){const node=container.querySelector<HTMLTextAreaElement>('textarea');check(node,'Missing actual notebook notes');return node;}
async function type(node:HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
function button(container:ParentNode,label:string){const node=[...container.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===label);check(node,'Missing '+label);return node;}
async function render(root:Root,node:ReactNode){await act(async()=>{root.render(node);await pause();});}
function mount(){const node=document.createElement('div');document.body.append(node);return{node,root:createRoot(node)};}
let registered=false;
async function fixture(label:string){
 if(!registered){registerLocalToolModules({'./installed/examples.icon-notebook/module.tsx':{default:definition}});registered=true;}
 const projectId='theme-'+label+'-'+crypto.randomUUID(),controlId=projectId+'-control';
 const project=(id:string)=>({id,title:'Synthetic theme '+label,description:'Own QA fixture',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['local-tool-'+definition.namespace,'theme-probe'],engineOrder:['local-tool-'+definition.namespace,'theme-probe'],worldEras:[{id:'past',name:'Past',description:'Synthetic era',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 const cleanup=async()=>{await deleteProject(projectId);await deleteProject(controlId);localStorage.removeItem(tabsStorageKey(projectId));};
 try{await db.projects.bulkPut([project(projectId),project(controlId)]);const a=await createSourceToolDocument({projectId},definition.namespace,'Theme Source A'),b=await createSourceToolDocument({projectId},definition.namespace,'Theme Source B');
  const client=(eraId?:string,documentId=a.id)=>createLocalToolClient(projectId,definition,{documentId,eraId});
  for(const [id,label]of [[a.id,'A'],[b.id,'B']]){const current=client(undefined,id),before=await current.read();await current.save({version:1,iconId:'writer-map-symbols/1:BookOpen',notes:'Saved '+label},before.revision,before.document?.version);}
  return{projectId,controlId,aId:a.id,bId:b.id,client,cleanup};
 }catch(error){await cleanup();throw error;}
}

export async function testLocalToolThemeApi(){
 const f=await fixture('api'),{root,node}=mount();useLocaleStore.setState({locale:'en',loaded:true});try{
  const a=f.client(),b=f.client(undefined,f.bId),source=(id:string)=>{const value=node.querySelector<HTMLElement>('[data-source-document-host="'+id+'"]');check(value,'Missing actual Source '+id);return value;};
  await render(root,<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.aId}/><LocalToolDocumentHost projectId={f.projectId} documentId={f.bId}/></MemoryRouter>);
  await until(()=>node.querySelectorAll('textarea:not(:disabled)').length===2,'Normal Source A/B not ready');
  await type(textarea(source(f.aId)),'Unsaved A survives theme');await type(textarea(source(f.bId)),'Confirmed B through actual UI');
  const stale=await b.read();await act(async()=>{button(source(f.bId),'Save notes').click();await pause();});
  await until(async()=>(await b.read()).data.notes==='Confirmed B through actual UI','Actual Source Save notes failed');
  const savedA=await a.read(),savedB=await b.read(),afterSave=await business();
  await rejects(()=>b.save({...stale.data,notes:'Must not overwrite'},stale.revision,stale.document?.version),'Source stale CAS accepted');
  same(await business(),afterSave,'Stale Source write changed data');check(savedA.data.notes==='Saved A'&&textarea(source(f.aId)).value==='Unsaved A survives theme','A/B isolation or draft positive failed');
  console.log('PASS actual compiled Source A/B UI save/read, stale CAS rejection and independent unsaved draft BEFORE optional theme assertion');
  (window as unknown as {__testStage?:string}).__testStage='THEME_API_POSITIVE '+json({sourceA:{saved:savedA.data.notes,draft:textarea(source(f.aId)).value},sourceB:{saved:savedB.data.notes,revision:savedB.revision},staleCasRejected:true,independentDraft:true});
  const service=theme(a);let notices=0;const off=service.subscribe(()=>{notices++;});
  try{const before=await business(),ledger=pending(),url=location.href;validate(await service.get(),{projectId:f.projectId});await service.get();await act(async()=>{await pause();});same(await business(),before,'Theme read/subscribe wrote business');check(pending()===ledger&&location.href===url&&notices===0,'Theme read changed pending/navigation or emitted');
   for(const scene of [{eraId:undefined,patch:{}},{eraId:undefined,patch:{mode:'light' as const}},{eraId:'past',patch:{}},{eraId:'past',patch:{background:'#101010',mode:'light' as const,accent:'#33aa55'}}]){
    const scope={projectId:f.projectId,eraId:scene.eraId};if(Object.keys(scene.patch).length)await saveAppearance(scope,scene.patch);
    const current=f.client(scene.eraId),value=await theme(current).get();validate(value,scope);if(scene.patch.background)check(value.mode==='dark','Mode ignored real background contrast');
    const mcp=await direct('wh_workspace_appearance_get',scope) as {resolved?:{mode:string;tokens:Snapshot['tokens']}};check(mcp.resolved,'MCP appearance lacks additive resolved');same(mcp.resolved,{mode:value.mode,tokens:value.tokens},'SDK/MCP resolved disagreement');
    const pane=document.createElement('div'),style=workspaceAppearanceStyle((await getWorkspaceAppearance(scope)).effective);Object.assign(pane.style,style);for(const[key,value]of Object.entries(style))if(key.startsWith('--'))pane.style.setProperty(key,String(value));document.body.append(pane);
    try{for(const key of keys)same(color(getComputedStyle(pane).getPropertyValue(key).trim()),color(value.tokens[key]),'SDK/compiled CSS mismatch '+key);check(getComputedStyle(pane).colorScheme===value.mode,'CSS/effective mode mismatch');}finally{pane.remove();}
    const original=await theme(current).get();Reflect.set(original.tokens,'--color-deep','#ff00ff');same(await theme(current).get(),value,'Returned snapshot mutates authoritative theme');
   }
   await until(()=>notices>0,'Stable theme subscription missed normal appearance save');await act(async()=>{await pause();});const abortBefore=await business(),abortNotices=notices;
   try{await db.transaction('rw',db.tables,async()=>{await saveAppearance({projectId:f.projectId},{background:'#abcdef'});throw Error('theme_deliberate_abort');});}catch(error){check(String(error).includes('theme_deliberate_abort'),'Abort failed before deliberate rollback: '+String(error));}
   await act(async()=>{await pause();});same(await business(),abortBefore,'Aborted appearance leaked writes');check(notices===abortNotices,'Aborted appearance emitted confirmed theme notice');
   off();const stopped=notices;await saveAppearance({projectId:f.projectId},{accent:'#dd3355'});await act(async()=>{await pause();});check(notices===stopped,'Theme unsubscribe retained listener');
   const era={projectId:f.projectId,eraId:'past'},read=await getWorkspaceAppearance(era);await direct('wh_workspace_appearance_reset',{...era,expectedRevision:read.revision});const inherited=await theme(f.client('past')).get(),base=await service.get();same(inherited.tokens,base.tokens,'Era reset failed to inherit Base');
   same(await a.read(),savedA,'Theme altered saved Source A');same(await b.read(),savedB,'Theme altered Source B');check(textarea(source(f.aId)).value==='Unsaved A survives theme','Theme lost A draft');
  }finally{off();}
  await hookRaces(a);return['actual Source positive; live readonly SDK/MCP/compiled CSS resolution, inheritance/reset, immutable reads and hook races'];
 }finally{await act(async()=>root.unmount());node.remove();await f.cleanup();}
}

async function hookRaces(base:Client){
 const useTheme=proposed.useLocalToolTheme;check(useTheme,'useLocalToolTheme missing');const {root,node}=mount();
 type Pending={resolve:(value:Snapshot)=>void;reject:(error:Error)=>void};
 const controlled=(projectId:string)=>{const requests:Pending[]=[],listeners=new Set<()=>void>();const port:ThemePort={get:()=>new Promise<Snapshot>((resolve,reject)=>requests.push({resolve,reject})),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};}};return{client:{...base,projectId,theme:port},requests,listeners,count:()=>requests.length,emit:()=>{for(const fn of listeners)fn();}};};
 const a=controlled('hook-A'),b=controlled('hook-B'),frames:{id:string;snapshot?:Snapshot}[]=[];let view:ThemeView|undefined;
 const current=()=>{check(view,'Hook did not render');return view;};
 const value=(id:string,ink:string):Snapshot=>({projectId:id,mode:'dark',tokens:Object.fromEntries(keys.map(key=>[key,ink])) as Record<typeof keys[number],string>});
 function Probe({client}:{client:typeof a.client}){const current=useTheme!(client);view=current;useEffect(()=>{frames.push({id:client.projectId,snapshot:current.snapshot});});return <p>{current.loading?'loading':current.error||current.snapshot?.projectId||'empty'}</p>;}
 try{await render(root,<Probe client={a.client}/>);check(current().available&&current().loading&&a.count()===1,'Hook initial contract');await render(root,<Probe client={b.client}/>);await render(root,<Probe client={a.client}/>);
  check(a.count()===2&&b.count()===1,'ABA did not issue independent bindings');await act(async()=>{a.requests[0].resolve(value('hook-A','#111111'));b.requests[0].resolve(value('hook-B','#222222'));await pause();});check(current().loading&&!current().snapshot,'Revoked ABA request published');
  await act(async()=>{a.requests[1].resolve(value('hook-A','#eeeeee'));await pause();});check(!current().loading&&current().snapshot?.tokens['--color-deep']==='#eeeeee','Fresh ABA read missing');
  await act(async()=>{a.emit();await pause();});await act(async()=>{a.requests[2].reject(Error('Controlled read failure'));await pause();});check(current().error.includes('Controlled read failure')&&!current().loading,'Read failure disappeared');
  await act(async()=>{current().retry();await pause();});await act(async()=>{a.requests[3].resolve(value('hook-A','#dddddd'));await pause();});check(!current().error&&!current().loading&&current().snapshot?.tokens['--color-deep']==='#dddddd','Explicit Retry failed');
  await act(async()=>{a.emit();await pause();a.emit();await pause();});await act(async()=>{a.requests[5].resolve(value('hook-A','#cccccc'));await pause();a.requests[4].resolve(value('hook-A','#aaaaaa'));await pause();});check(current().snapshot?.tokens['--color-deep']==='#cccccc','Older same-binding request replaced fresh theme');
  check(frames.every(frame=>!frame.snapshot||frame.snapshot.projectId===frame.id),'Hook exposed a foreign scope frame');
  function Absent(){const current=useTheme!({});check(!current.available&&!current.loading&&!current.snapshot,'Old host manufactured a theme or remained loading');return null;}
  await render(root,<Absent/>);check(a.listeners.size===0&&b.listeners.size===0,'Hook teardown retained subscription');
 }finally{await act(async()=>root.unmount());node.remove();}
}

function Applied({scope,style,children}:{scope:Scope;style:CSSProperties;children:ReactNode}){const Provider=proposed.LocalToolAppliedThemeProvider;return Provider?<Provider scope={scope} style={style}>{children}</Provider>:<Fragment>{children}</Fragment>;}
export async function testLocalToolThemeCanvas(){
 const f=await fixture('canvas'),{root,node}=mount(),scope={projectId:f.projectId},era={projectId:f.projectId,eraId:'past'};useLocaleStore.setState({locale:'en',loaded:true});
 const clients=[f.client(),f.client('past',f.bId)],mounts=[0,0],Component=definition.component;let release:()=>void=()=>{};
 const originalStroke=CanvasRenderingContext2D.prototype.stroke,strokes=new Map<HTMLCanvasElement,number>();
 CanvasRenderingContext2D.prototype.stroke=function(path?:Path2D){strokes.set(this.canvas,(strokes.get(this.canvas)??0)+1);return Reflect.apply(originalStroke,this,path===undefined?[]:[path]);};
 try{await saveAppearance(scope,{background:'#151515',mode:'dark'});await saveAppearance(era,{background:'#f4f0e6',mode:'light'});
  const oldStyle=workspaceAppearanceStyle((await getWorkspaceAppearance(scope)).effective),eraStyle=workspaceAppearanceStyle((await getWorkspaceAppearance(era)).effective);let nextStyle=oldStyle;
  function Pane({index,style}:{index:number;style:CSSProperties}){useEffect(()=>{mounts[index]++;},[index]);return <div data-pane={index} style={style}><Applied scope={index?era:scope} style={style}><span data-ink={index} className="text-text-primary"><SDK.LocalToolIcon client={clients[index]} icon="BookOpen" size={32}/></span><span data-fixed={index}><SDK.LocalToolIcon client={clients[index]} icon="BookOpen" size={32} color="#2277cc"/></span><LocalToolUndoBoundary><Component projectId={f.projectId} client={clients[index]} context={{view:'editor',canEdit:true,scope:index?era:scope}}/></LocalToolUndoBoundary></Applied></div>;}
  function Held(){const [style,setStyle]=useState(oldStyle);release=()=>setStyle(nextStyle);return <><Pane index={0} style={style}/><Pane index={1} style={eraStyle}/></>;}
  await render(root,<MemoryRouter><Held/></MemoryRouter>);const ink=(index:number)=>{const value=node.querySelector<HTMLElement>('[data-ink="'+index+'"]');check(value,'Missing ink wrapper');return value;};
  const baseCanvas=await readyIcon(ink(0)),eraCanvas=await readyIcon(ink(1)),fixed=node.querySelector<HTMLElement>('[data-fixed="0"]')!;await readyIcon(fixed);
  const panes=[node.querySelector<HTMLElement>('[data-pane="0"]')!,node.querySelector<HTMLElement>('[data-pane="1"]')!];await until(()=>panes.every(pane=>!!pane.querySelector('textarea:not(:disabled)')),'Canvas notebooks not ready');
  await type(textarea(panes[0]),'Base draft remains');await type(textarea(panes[1]),'Era draft remains');const draftNodes=panes.map(textarea),sources=await Promise.all(clients.map(client=>client.read())),control=await db.projects.get(f.controlId),oldInk=getComputedStyle(ink(0)).color,oldPixels=pixel(baseCanvas),eraPixels=pixel(eraCanvas),fixedCanvas=canvas(fixed);
  console.log('PASS existing real catalogue Canvas painted inherited DOM ink; two notebooks editable before theme change; mounts='+json(mounts));
  (window as unknown as {__testStage?:string}).__testStage='THEME_CANVAS_POSITIVE '+json({mounts,domInk:oldInk,pixel:oldPixels,eraPixel:eraPixels,sources:sources.map(value=>({documentId:value.document?.id,notes:value.data.notes})),drafts:draftNodes.map(value=>value.value),realCanvasNodes:baseCanvas.isConnected&&eraCanvas.isConnected});
  await act(async()=>{await saveAppearance(scope,{background:'#faf7ee',mode:'light'});await pause();});nextStyle=workspaceAppearanceStyle((await getWorkspaceAppearance(scope)).effective);
  const optional=(clients[0] as unknown as {theme?:ThemePort}).theme;if(optional)check((await optional.get()).mode==='light','Reader did not advance while visual parent held');else console.log('INFO baseline optional theme absent; persisted new appearance is independently confirmed');
  check((await getWorkspaceAppearance(scope)).effective.mode==='light','Normal save failed');same(pixel(baseCanvas),oldPixels,'Canvas advanced before applied parent commit');check(getComputedStyle(ink(0)).color===oldInk,'Held parent applied style early');
  const stored=await business(),ledger=pending(),fixedCount=strokes.get(fixedCanvas);await act(async()=>{release();await pause();});await until(()=>getComputedStyle(ink(0)).color!==oldInk,'Released parent did not apply normal appearance CSS');
  // First baseline RED is material Canvas staleness, never an absent-module import.
  await until(()=>painted(baseCanvas,getComputedStyle(ink(0)).color),'theme_canvas_stale_after_applied_commit: DOM changed but same Canvas retained old ink');
  check(canvas(ink(0))===baseCanvas&&canvas(ink(1))===eraCanvas,'Canvas DOM node remounted');same(mounts,[1,1],'Notebook/Canvas pane remounted');same(pixel(eraCanvas),eraPixels,'Base change recolored independent era');check(painted(fixedCanvas,color('#2277cc')),'Fixed ink lost priority');check(strokes.get(fixedCanvas)===fixedCount,'Explicit fixed ink repainted on theme signature');
  same(await business(),stored,'Releasing applied CSS wrote business');check(pending()===ledger,'Applied commit changed pending ledger');same(await Promise.all(clients.map(client=>client.read())),sources,'Theme altered Source');same(await db.projects.get(f.controlId),control,'Theme changed control project');
  for(let i=0;i<2;i++)check(textarea(panes[i])===draftNodes[i]&&draftNodes[i].value===(i?'Era draft remains':'Base draft remains'),'Applied commit lost real notebook draft');
  const counts=[strokes.get(baseCanvas),strokes.get(eraCanvas)],before=await clients[0].read();await act(async()=>{await clients[0].save({...before.data,notes:'Normal explicit saved note'},before.revision,before.document?.version);await pause();});await act(async()=>{await pause();});same([strokes.get(baseCanvas),strokes.get(eraCanvas)],counts,'Notes notice repainted unchanged theme');
  check(textarea(panes[0]).value==='Base draft remains','Normal notice lost unsaved notes');console.log('PASS held data/applied commit ordering, independent era, fixed ink, stable nodes/clients/drafts and no note-only repaint');
  await render(root,<p>Closing controlled panes</p>);await workspaceIntegration(root,node,f);return['real Canvas positive and causal applied-commit repaint; real ProjectWorkspace primary/secondary integration'];
 }finally{CanvasRenderingContext2D.prototype.stroke=originalStroke;await act(async()=>root.unmount());node.remove();await f.cleanup();}
}

async function workspaceIntegration(root:Root,node:HTMLElement,f:Awaited<ReturnType<typeof fixture>>){
 const clients=[f.client(),f.client('past',f.bId)],mounts=[0,0];
 function Probe({index}:{index:number}){const pane=useEnginePane();useEffect(()=>{mounts[index]++;},[index]);return <div data-real-probe={index}><span className="text-text-primary"><SDK.LocalToolIcon client={clients[index]} icon="BookOpen" size={32}/></span>{index===0&&<button onClick={()=>pane?.openBeside?.('/project/'+f.projectId+'/theme-probe?era=past')}>Open era probe</button>}</div>;}
 const engines:EngineDefinition[]=[{id:'theme-probe',name:'Theme probe',description:'Synthetic integration',category:'core',icon:BookOpen,tables:{},component:()=> <Probe index={1}/>}];
 localStorage.removeItem(tabsStorageKey(f.projectId));await render(root,<MemoryRouter initialEntries={['/project/'+f.projectId+'/theme-probe']}><ProjectWorkspace projectId={f.projectId} engines={engines}><Probe index={0}/></ProjectWorkspace></MemoryRouter>);
 const primary=node.querySelector<HTMLElement>('[data-real-probe="0"]');check(primary,'Missing real primary');const expectedBase=(await getWorkspaceAppearance({projectId:f.projectId})).effective.background;check(expectedBase,'Missing prepared Base background');await until(()=>getComputedStyle(primary).getPropertyValue('--color-deep').trim()===expectedBase,'Real primary initial appearance not applied');const first=await readyIcon(primary);
 await act(async()=>{button(primary,'Open era probe').click();await pause();});await until(()=>!!node.querySelector('[data-real-probe="1"]'),'Real companion not opened');const secondary=node.querySelector<HTMLElement>('[data-real-probe="1"]')!,expectedEra=(await getWorkspaceAppearance({projectId:f.projectId,eraId:'past'})).effective.background;check(expectedEra,'Missing prepared era background');await until(()=>getComputedStyle(secondary).getPropertyValue('--color-deep').trim()===expectedEra,'Real companion initial appearance not applied');const second=await readyIcon(secondary),old=getComputedStyle(first.parentElement!).color,eraOld=getComputedStyle(second.parentElement!).color;
 await act(async()=>{await saveAppearance({projectId:f.projectId},{background:'#111111',mode:'dark'});await pause();});await until(()=>getComputedStyle(first.parentElement!).color!==old,'Actual primary style did not change');await until(()=>painted(first,getComputedStyle(first.parentElement!).color),'Real ProjectWorkspace primary omitted applied-theme Provider');
 check(getComputedStyle(second.parentElement!).color===eraOld&&painted(second,eraOld),'Primary theme leaked into companion era');
 await act(async()=>{await saveAppearance({projectId:f.projectId,eraId:'past'},{background:'#222222',mode:'dark'});await pause();});await until(()=>getComputedStyle(second.parentElement!).color!==eraOld,'Actual companion style did not change');await until(()=>painted(second,getComputedStyle(second.parentElement!).color),'Real ProjectWorkspace companion omitted applied-theme Provider');
 same(mounts,[1,1],'Real workspace repaint remounted probe');check(canvas(primary)===first&&canvas(secondary)===second,'Real workspace replaced Canvas nodes');
 console.log('PASS actual ProjectWorkspace applies Providers at both style sites; removing either Provider fails this separate integration');
}

export async function testLocalToolThemeAll(){const passed:string[]=[],failures:string[]=[];for(const [label,run]of [['API',testLocalToolThemeApi],['Canvas',testLocalToolThemeCanvas]]as const){try{passed.push(...await run());}catch(error){failures.push(label+': '+String(error));}}if(failures.length)throw Error(failures.join('\n'));return passed;}
