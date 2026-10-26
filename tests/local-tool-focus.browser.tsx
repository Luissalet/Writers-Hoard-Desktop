import '@/engines';
import {act,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes,useParams} from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import TopBar from '@/components/layout/TopBar';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {saveTabsState,tabsStorageKey} from '@/components/project/workspace/workspaceTabs';
import {workspaceRoute} from '@/components/project/workspace/routes';
import {registerLocalToolModules} from '@/engines/local/registry';
import {getEngine} from '@/engines/_registry';
import * as SDK from '@/engines/local/sdk';
import type {LocalToolClient,LocalToolFocusMode,LocalToolHostContext,LocalToolJson,LocalToolProps} from '@/engines/local/sdk';
import {useLocalToolState} from '@/engines/local/useLocalToolState';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getPendingWritesSnapshot,registerPendingFlusher} from '@/services/pendingWrites';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {useLocaleStore} from '@/stores/localeStore';
import Modal from '@/components/common/Modal';

type State={notes:string};
const live=new Map<string,{client:LocalToolClient<State>;context?:LocalToolHostContext}>();
const namespace='tests.focus-source';let registered=false;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
async function until(test:()=>boolean|Promise<boolean>,message:string){for(let i=0;i<200;i++){if(await test())return;await act(async()=>{await pause();});}throw Error(message);}
const canonical=(value:unknown)=>JSON.stringify(value);
async function click(node:HTMLElement){await act(async()=>{node.click();await pause();});}
async function type(node:HTMLTextAreaElement,text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(node,text);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
async function direct(name:string,args:Record<string,unknown>){const reply=await runBridgeTool(name,args);check(reply.ok,'Dispatcher '+name+': '+canonical(reply));return reply.result;}
function Probe({client,context}:LocalToolProps<State>){
 const [draft,setDraft]=useState<string>(),[modal,setModal]=useState(false),state=useLocalToolState(client,{observe:true,hasDraft:draft!==undefined}),canvas=useRef<HTMLCanvasElement>(null);
 const focus=SDK.useLocalToolFocusMode(context);
 useLayoutEffect(()=>{live.set(client.documentId??'legacy',{client,context});return()=>{if(live.get(client.documentId??'legacy')?.client===client)live.delete(client.documentId??'legacy');};},[client,context]);
 useLayoutEffect(()=>{const ctx=canvas.current?.getContext('2d');if(ctx){ctx.fillStyle='#d5b575';ctx.fillRect(0,0,12,12);}},[]);
 const button='min-h-10 rounded-lg border border-border px-3 text-sm text-text-primary';
 return <div data-focus-probe={client.documentId??'legacy'}><canvas ref={canvas} width={12} height={12}/><textarea aria-label="Focus notes" value={draft??state.snapshot?.data.notes??''} disabled={!state.snapshot} onChange={event=>setDraft(event.target.value)}/><button className={button} onClick={()=>{if(draft!==undefined)void state.apply([{type:'set',field:'notes',value:draft}]).then(ok=>{if(ok)setDraft(undefined);});}}>Save fixture notes</button><button className={button} data-probe-focus onClick={focus.toggle}>Author focus</button><button className={button} data-probe-menu onClick={event=>context?.contextMenu?.open(event,[{kind:'item',id:'keep',label:'Keep notes',onSelect:()=>{}}],{label:'Focus actions'})}>Actions</button><button className={button} data-probe-modal onClick={()=>setModal(true)}>Open fixture dialog</button><Modal open={modal} onClose={()=>setModal(false)} title="Own focus dialog" dismissible={false}><button data-probe-modal-close onClick={()=>setModal(false)}>Close fixture dialog</button></Modal><span data-focus-logical>{String(focus.available)}:{String(focus.active)}</span></div>;
}
const definition=SDK.defineLocalTool<State>({namespace,name:{en:'Focus source fixture',es:'Prueba Source concentración'},description:{en:'Synthetic focus regression.',es:'Prueba sintética de concentración.'},document:{defaultTitle:{en:'Focus document',es:'Documento concentración'}},codec:{version:1,fields:{notes:{kind:'prose'}}},initialState:{notes:''},validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:Probe});

/** Actual MainLayout + ProjectWorkspace + registered Source engine, not a fake focus target. */
export async function mountLocalToolFocusFixture(){
 if(!registered){registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});registered=true;}
 const projectId='focus-ui-'+crypto.randomUUID(),controlId=projectId+'-control',engine=getEngine('local-tool-'+namespace);check(engine,'Normal Source engine absent');
 const project=(id:string)=>({id,title:'Own focus fixture',description:'Synthetic local QA',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:[engine.id],engineOrder:[engine.id],worldEras:[{id:'past',name:'Past',description:'Own QA era',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 await db.projects.bulkPut([project(projectId),project(controlId)]);const a=await createSourceToolDocument({projectId},namespace,'Focus A'),b=await createSourceToolDocument({projectId},namespace,'Focus B');
 const client=(id:string)=>createLocalToolClient(projectId,definition,{documentId:id});
 for(const row of [a,b]){const c=client(row.id),before=await c.read();await c.save({notes:'Saved '+row.title},before.revision,before.document?.version);}
 const beside='companion:'+crypto.randomUUID(),url='/project/'+projectId+'/'+engine.id+'?document='+a.id;
 saveTabsState(projectId,{tabs:[{id:beside,engineId:engine.id,history:[workspaceRoute('/project/'+projectId+'/'+engine.id+'?document='+b.id+'&era=past')],index:0}],activeId:beside,closed:[]});
 function Workspace(){const {id}=useParams();return <><TopBar title="Own focus fixture"/><ProjectWorkspace projectId={id!} engines={[engine!]}><engine.component projectId={id!}/></ProjectWorkspace></>;}
 const container=document.createElement('div');container.style.height='100vh';document.body.append(container);const root=createRoot(container);useLocaleStore.setState({locale:'en',loaded:true});
 await act(async()=>{root.render(<MemoryRouter initialEntries={[url]}><Routes><Route element={<MainLayout/>}><Route path="/project/:id/:tab" element={<Workspace/>}/></Route></Routes></MemoryRouter>);await pause();});
 await until(()=>live.has(a.id)&&live.has(b.id)&&container.querySelectorAll('textarea[aria-label="Focus notes"]:not(:disabled)').length===2,'Real Source A/B not ready');
 const host=(id:string)=>{const node=container.querySelector<HTMLElement>('[data-source-document-host="'+id+'"]');check(node,'Missing Source '+id);return node;};
 const notes=(id:string)=>{const node=host(id).querySelector<HTMLTextAreaElement>('textarea[aria-label="Focus notes"]');check(node,'Missing notes');return node;};
 return{projectId,controlId,aId:a.id,bId:b.id,container,host,notes,client,async cleanup(){await act(async()=>root.unmount());container.remove();live.clear();await deleteProject(projectId);await deleteProject(controlId);localStorage.removeItem(tabsStorageKey(projectId));}};
}

export async function testLocalToolFocusShell(){
 const f=await mountLocalToolFocusFixture();let off=()=>{};
 try{
  await type(f.notes(f.aId),'Unsaved independent A');await type(f.notes(f.bId),'Confirmed B');
  const save=[...f.host(f.bId).querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Save fixture notes');check(save,'Save control missing');await click(save);
  await until(async()=>(await f.client(f.bId).read()).data.notes==='Saved Focus B'&&(await live.get(f.bId)!.client.read()).data.notes==='Confirmed B','Actual era Save failed or changed Base');
  await type(f.notes(f.bId),'Unsaved independent B');
  const nodes=[f.notes(f.aId),f.notes(f.bId)],canvases=[f.host(f.aId).querySelector('canvas'),f.host(f.bId).querySelector('canvas')],clients=[live.get(f.aId)!.client,live.get(f.bId)!.client];
  const before=canonical(await db.projects.bulkGet([f.projectId,f.controlId])),ledger=canonical(getPendingWritesSnapshot()),saved=await Promise.all(clients.map(client=>client.read()));let flushes=0;off=registerPendingFlusher('focus-no-flush-'+f.projectId,async()=>{flushes++;return false;});const pending=canonical(getPendingWritesSnapshot());
  console.log('PASS real registered Source A/B and era save positive before focus assertion; independent drafts');
  const a=live.get(f.aId)!.context?.focusMode,b=live.get(f.bId)!.context?.focusMode;check(a&&b&&a.getState().available&&b.getState().available,'local_tool_focus_missing_after_real_source_positive');
  const targetResult=await direct('wh_workspace_focus_get',{projectId:f.projectId}) as {targets:{hostId:string;documentId:string}[]};check(targetResult.targets.length===2,'Real shell did not list both mounted Source targets');const target=targetResult.targets.find(item=>item.documentId===f.aId);check(target,'Missing A target');
  const oldButton=f.host(f.aId).querySelector<HTMLButtonElement>('[data-local-tool-focus]');check(oldButton,'Normal host Focus button absent');const width=nodes[0].closest('[data-testid="workspace-primary"]')!.getBoundingClientRect().width;
  await click(oldButton);await until(()=>a.getState().active&&f.container.querySelector('[data-workspace-focus="true"]')!==null,'Focus did not enter actual MainLayout');
  await until(()=>nodes[0].closest('[data-testid="workspace-primary"]')!.getBoundingClientRect().width>=width,'Focus shrank content');
  for(const chrome of f.container.querySelectorAll<HTMLElement>('[data-workspace-chrome]'))check(chrome.hidden&&chrome.inert&&getComputedStyle(chrome).display==='none','Real chrome not hidden/inert');
  await act(async()=>{await pause();await pause();});
  for(let i=0;i<2;i++){check(f.notes(i?f.bId:f.aId)===nodes[i],'Textarea remounted');check(f.host(i?f.bId:f.aId).querySelector('canvas')===canvases[i],'Canvas remounted');check(live.get(i?f.bId:f.aId)!.client===clients[i],'Focus reissued Source client');}
  check(nodes[0].value==='Unsaved independent A'&&nodes[1].value==='Unsaved independent B','Focus lost drafts');check(canonical(await db.projects.bulkGet([f.projectId,f.controlId]))===before,'Focus changed business/control');check(canonical(getPendingWritesSnapshot())===pending&&flushes===0,'Focus flushed/saved pending notes');check(canonical(await Promise.all(clients.map(client=>client.read())))===canonical(saved),'Saved Source changed');
  const menu=f.host(f.aId).querySelector<HTMLButtonElement>('[data-probe-menu]');check(menu,'Actions absent');await click(menu);await until(()=>!!document.querySelector('[data-local-tool-context-menu]'),'Normal SDK menu absent');const menuNode=document.querySelector<HTMLElement>('[data-local-tool-context-menu]')!;
  await act(async()=>{menuNode.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});check(a.getState().active,'Menu Escape also exited focus');
  await click(f.host(f.aId).querySelector<HTMLButtonElement>('[data-probe-modal]')!);await until(()=>!!document.querySelector('[role="dialog"][aria-modal="true"]'),'Normal Modal missing');
  await act(async()=>{document.querySelector('[role="dialog"][aria-modal="true"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});check(a.getState().active&&!!document.querySelector('[role="dialog"][aria-modal="true"]'),'Non-dismissible Modal lost Escape priority');await click(document.querySelector<HTMLElement>('[data-probe-modal-close]')!);
  await act(async()=>{nodes[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});check(!a.getState().active,'Free owner Escape did not exit');
  await act(async()=>{await direct('wh_workspace_focus_set',{projectId:f.projectId,hostId:target.hostId,active:true});await pause();});check(a.getState().active&&b.getState().active,'MCP did not use same real shell');
  const exit=f.container.querySelector<HTMLButtonElement>('[data-workspace-focus-exit]');check(exit,'Visible shell exit missing');await click(exit);check(!a.getState().active&&document.activeElement===oldButton,'Shell Exit did not restore own trigger');
  const absent=await direct('wh_workspace_focus_set',{projectId:f.projectId,hostId:'not-mounted',active:true});check(canonical(absent)===canonical({available:false,active:false}),'Missing MCP host queued or invented UI');
  check(canonical(await db.projects.bulkGet([f.projectId,f.controlId]))===before&&canonical(getPendingWritesSnapshot())===pending&&flushes===0,'UI/MCP focus changed data/ledger');off();off=()=>{};check(canonical(getPendingWritesSnapshot())===ledger,'Own no-flush flusher cleanup changed previous ledger');
  await f.cleanup();check(!a.getState().available&&!b.getState().available,'Unmount retained active port');a.set(true);b.toggle();const none=await direct('wh_workspace_focus_get',{projectId:f.projectId}) as {targets:unknown[]};check(none.targets.length===0,'Closed real shell still listed targets');
  return['real MainLayout two Source Base/era; normal notes save, same nodes/client/drafts and zero focus flush/business writes','host/hook/readonly get/set MCP agree with actual chrome; menu/Modal/Escape and explicit exit restore; unmounted/missing targets inert'];
 }finally{off();if(f.container.isConnected)await f.cleanup();}
}

/** Hook frame/revocation oracle uses explicit memory ports, not shell evidence. */
export async function testLocalToolFocusHook(){
 const rootNode=document.createElement('div');document.body.append(rootNode);const root=createRoot(rootNode),listeners=new Set<()=>void>();let active=false,view:ReturnType<typeof SDK.useLocalToolFocusMode>|undefined;let oldSet:((active:boolean)=>void)|undefined;
 const port:LocalToolFocusMode={getState:()=>active?SDKFocusActive:SDKFocusInactive,set:value=>{active=value;for(const changed of listeners)changed();},toggle:()=>{active=!active;for(const changed of listeners)changed();},subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}};
 function Hook({context}:{context?:{focusMode?:LocalToolFocusMode}}){view=SDK.useLocalToolFocusMode(context);return <p>{String(view.available)}:{String(view.active)}</p>;}
 try{await act(async()=>root.render(<Hook context={{focusMode:port}}/>));check(view?.available&&!view.active,'Hook initial');oldSet=view.set;await act(async()=>view!.toggle());check(view?.active,'Hook missed subscriber');await act(async()=>root.render(<Hook context={{}}/>));check(!view?.available&&!view?.active,'Missing port rendered previous active frame');await act(async()=>root.render(<Hook context={{}}/>));check(listeners.size===0,'Hook missing port retained subscription');
  // The explicit fixture port is still live; only a production host lease revokes its effects.
  await act(async()=>oldSet!(false));check(!view?.available&&!view?.active,'Retained fixture callback changed a different missing binding');return['focus hook explicit memory subscribe/absent-port/old callback frame, no UI availability claim'];
 }finally{await act(async()=>root.unmount());rootNode.remove();}
}
const SDKFocusActive=Object.freeze({available:true,active:true}),SDKFocusInactive=Object.freeze({available:true,active:false});
