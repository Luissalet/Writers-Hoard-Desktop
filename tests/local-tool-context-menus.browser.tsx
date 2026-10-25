import '@/engines';
import {act,StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolProps,type LocalToolHostContext} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import MapContextMenu from '@/components/maps/MapContextMenu';
import TourHost from '@/components/tutorial/TourHost';
import {startTour,closeTour} from '@/components/tutorial/tourController';
import {useTourStore} from '@/components/tutorial/tourStore';
import actualDefinition from '@/engines/local/installed/examples.context-counter/module';
import {useLocaleStore} from '@/stores/localeStore';
import {pinLocalToolRelease} from '@/engines/local/releases';
import type {LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import {ToastHost} from '@/components/common/toast';
import type {LocalToolMenuEntry,LocalToolContextMenuPort} from '@/engines/local/sdk';

type Entry={kind:'item';id:string;label:string;disabled?:boolean;onSelect:()=>void|Promise<void>};
type Menu=LocalToolContextMenuPort;
const ports=new Map<string,Menu>();
function Counter({client,context}:LocalToolProps<{count:number}>){
 const [count,setCount]=useState(0),[error,setError]=useState(false);
 const menu=(context as LocalToolHostContext&{contextMenu?:Menu}|undefined)?.contextMenu;
 useEffect(()=>{if(menu)ports.set(context?.document?.id??'legacy',menu);},[context,menu]);
 useEffect(()=>{let live=true;const read=()=>{void client.read().then(row=>{if(live)setCount(row.data.count);}).catch(()=>{if(live)setError(true);});};read();const off=client.subscribe?.(read);return()=>{live=false;off?.();};},[client]);
 const increment=async()=>{const before=await client.read();await client.state!.apply(before,[{type:'set',field:'count',value:before.data.count+1}]);};
 const entries:Entry[]=[{kind:'item',id:'increment',label:'Increment count',onSelect:increment}];
 return <section data-menu-counter><output data-menu-result tabIndex={0} onContextMenu={event=>menu?.open(event,entries,{label:'Count actions'})} onKeyDown={event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)menu?.open(event,entries,{label:'Count actions'});}}>{count}</output><button data-menu-increment onClick={()=>void increment()}>Increment</button>{error&&<p role="alert">Counter read failed</p>}</section>;
}
const definition=defineLocalTool({namespace:'test.context-counter',name:{en:'Context counter',es:'Contador contextual'},description:{en:'Context menu fixture.',es:'Prueba propia de menú.'},initialState:{count:0},validateState:(value):value is {count:number}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.count==='number',codec:{version:1,fields:{count:{kind:'scalar'}}},document:{defaultTitle:{en:'Counter',es:'Contador'}},component:Counter});
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
async function until(check:()=>boolean|Promise<boolean>,label:string){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(label+' '+document.body.textContent?.slice(-600));}
async function click(node:Element|null){assert(node,'Missing actual control');await act(async()=>{(node as HTMLElement).click();await pause();});}
async function fixture(){
 const projectId='context-menu-'+crypto.randomUUID(),[engine]=registerLocalToolModules({'./installed/test.context-counter/module.tsx':{default:definition}});
 await db.projects.put({id:projectId,title:'Own menu QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
 const source=await createSourceToolDocument({projectId},definition.namespace,'Own count');return{projectId,source,engine};
}
export async function testLocalToolContextMenuHost(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);let added=0,mapOpen=true;
 const render=async()=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{instanceId:'menu-source',projectId:f.projectId,visible:true}}><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></EnginePaneContext.Provider>{mapOpen&&<MapContextMenu at={{clientX:20,clientY:20,x:1,y:1}} onClose={()=>{mapOpen=false;}} onAddPin={()=>added++}/>}</MemoryRouter></StrictMode>);await pause();});};
 try{
  await render();await until(()=>!!document.querySelector('[data-menu-counter]'),'Real selected Source component missing');
  assert(document.querySelector('[data-testid="map-context-menu"][role="menu"]'),'Incumbent native menu positive missing');await click(document.querySelector('[data-testid="map-menu-add-pin"]'));assert(added===1,'Incumbent menu positive did not act');await render();
  await click(document.querySelector('[data-menu-increment]'));await until(()=>document.querySelector('[data-menu-result]')?.textContent==='1','Normal Source action did not persist');
  const before=JSON.stringify(await db.projects.get(f.projectId)),target=document.querySelector<HTMLElement>('[data-menu-result]')!;
  await act(async()=>{target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:160,clientY:100}));await pause();});
  assert(document.querySelector('[data-local-tool-context-menu][role="menu"]'),'Own context menu missing in real Source host');
  assert(before===JSON.stringify(await db.projects.get(f.projectId)),'Opening a menu changed saved data');
  await click(document.querySelector('[data-local-tool-context-menu] [role="menuitem"]'));await until(()=>document.querySelector('[data-menu-result]')?.textContent==='2','Contextual Source action did not commit');
  assert(!document.querySelector('[data-local-tool-context-menu]'),'Selection left menu open');
  await act(async()=>{target.focus();target.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'F10',shiftKey:true}));await pause();});assert(document.querySelector('[data-local-tool-context-menu]'),'Keyboard did not open host menu');
  await act(async()=>{document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));await pause();});assert(!document.querySelector('[data-local-tool-context-menu]')&&document.activeElement===target,'Escape did not close/restore trigger');
  return ['Real Source action and incumbent menu positive; pointer/keyboard host menu acts normally, opening is readonly and Escape restores focus'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuTourKeys(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>{root.render(<MemoryRouter><TourHost/><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></MemoryRouter>);});await until(()=>!!ports.get(f.source.id)&&!!document.querySelector('[data-menu-result]'),'Real menu Source unavailable');
  const target=document.querySelector<HTMLElement>('[data-menu-result]')!;target.setAttribute('data-tour','dashboard-new-project');
  await act(async()=>{assert(await startTour('first-world'),'Real global tour did not start');});await until(()=>!!document.querySelector('[data-testid="tour-overlay"]'),'Real overlay missing');
  const open=async()=>{await act(async()=>{target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:160,clientY:100}));await pause();});assert(document.querySelector('[data-local-tool-context-menu]')?.contains(document.activeElement),'Menu not visible/focused before keyboard conflict');};
  await open();const before=useTourStore.getState().active!.index,menu=document.querySelector<HTMLElement>('[data-local-tool-context-menu]')!,overlay=document.querySelector<HTMLElement>('[data-testid="tour-overlay"]')!;
  assert(Number(getComputedStyle(menu).zIndex)>Number(getComputedStyle(overlay).zIndex),'Menu does not sit above actual tour overlay');
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});
  assert(!document.querySelector('[data-local-tool-context-menu]')&&useTourStore.getState().active?.index===before,'First Escape closed tour instead of menu');
  await open();for(const key of ['ArrowRight','ArrowLeft']){await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await pause();});assert(useTourStore.getState().active?.index===before,'Menu arrow key moved the real tour');}
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});assert(!!useTourStore.getState().active,'Menu Escape destroyed tour');
  await act(async()=>{target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});assert(!useTourStore.getState().active,'Second Escape no longer closes normal tour');
  return ['Real TourHost capture delegates to visible focused SDK menu: arrows preserve step, first Escape menu only, second Escape normal tour'];
 }finally{closeTour();await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuTourOutside(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);
 try{await act(async()=>root.render(<MemoryRouter><TourHost/><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/><button data-outside-menu>Other pane</button></MemoryRouter>));await until(()=>!!ports.get(f.source.id),'Outside control Source missing');const target=document.querySelector<HTMLElement>('[data-menu-result]')!;target.setAttribute('data-tour','dashboard-new-project');
  const open=async()=>{await act(async()=>{assert(await startTour('first-world'),'Outside control tour missing');target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:90}));await pause();});};
  await open();const hidden=document.querySelector<HTMLElement>('[data-local-tool-context-menu]')!;hidden.hidden=true;
  await act(async()=>{target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});assert(!useTourStore.getState().active,'Hidden SDK node inhibited normal tour Escape');await act(async()=>{ports.get(f.source.id)!.close();await pause();});
  await open();await act(async()=>{const outside=document.querySelector<HTMLElement>('[data-outside-menu]')!;outside.focus();assert(document.activeElement===outside,'Outside focus control failed');/* Hidden Electron changes activeElement without firing focusin. */outside.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await pause();});assert(!document.querySelector('[data-local-tool-context-menu]'),'Outside focus left popup open');await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});assert(!useTourStore.getState().active,'Unfocused former menu inhibited normal tour Escape');
  return ['Hidden popup or focus in another pane does not bypass normal real TourHost keyboard behavior'];
 }finally{closeTour();await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuIsolation(){
 const f=await fixture(),second=await createSourceToolDocument({projectId:f.projectId},definition.namespace,'Second'),root=createRoot(document.getElementById('root')!),Engine=f.engine.component;
 await db.projects.update(f.projectId,{worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
 const render=async(visible:boolean,eraId?:string,readOnly=false)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={['/project/'+f.projectId+'/local-tool-'+definition.namespace+'?legacy=1']}><div data-pane="a"><EnginePaneContext.Provider value={{instanceId:'menu-a',projectId:f.projectId,visible,eraId}}><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id} eraId={eraId} readOnly={readOnly}/></EnginePaneContext.Provider></div><div data-pane="b"><EnginePaneContext.Provider value={{instanceId:'menu-b',projectId:f.projectId,visible:true}}><LocalToolDocumentHost projectId={f.projectId} documentId={second.id}/></EnginePaneContext.Provider></div><div data-pane="legacy"><EnginePaneContext.Provider value={{instanceId:'menu-legacy',projectId:f.projectId,visible:true}}><Engine projectId={f.projectId}/></EnginePaneContext.Provider></div></MemoryRouter></StrictMode>);await pause();});};
 const trigger=(pane:string)=>document.querySelector<HTMLElement>(`[data-pane="${pane}"] [data-menu-result]`)!;
 const event=(target:HTMLElement)=>{let prevented=0,stopped=0;return{currentTarget:target,type:'contextmenu',clientX:innerWidth-2,clientY:innerHeight-2,preventDefault(){prevented++;},stopPropagation(){stopped++;},counts:()=>[prevented,stopped]};};
 let calls=0;const entries:Entry[]=[{kind:'item',id:'own',label:'Own action',onSelect:()=>{calls++;}}];
 try{
  await render(true);await until(()=>!!ports.get(f.source.id)&&!!ports.get(second.id)&&!!ports.get('legacy'),'Source/legacy ports missing');const a=ports.get(f.source.id)!,b=ports.get(second.id)!,legacy=ports.get('legacy')!,before=JSON.stringify(await db.projects.get(f.projectId));
  const first=event(trigger('a'));await act(async()=>{assert(a.open(first,entries,{label:'A actions'}),'A declined');await pause();});assert(JSON.stringify(first.counts())==='[1,1]','Admitted event not consumed once');
  const invalid=event(trigger('b'));assert(!b.open(invalid,[] as Entry[],{label:'Invalid'})&&JSON.stringify(invalid.counts())==='[0,0]','Invalid request consumed event');assert(document.querySelector('[role="menu"]')?.getAttribute('aria-label')==='A actions','Invalid request replaced valid menu');
  const foreign=event(trigger('a'));assert(!b.open(foreign,entries,{label:'Foreign'})&&JSON.stringify(foreign.counts())==='[0,0]','Other root trigger admitted');
  const retained=document.querySelector('[data-local-tool-context-menu] [role="menuitem"]')!;
  await act(async()=>{assert(b.open(event(trigger('b')),entries,{label:'B actions'}),'B declined');a.close();await pause();});assert(document.querySelector('[role="menu"]')?.getAttribute('aria-label')==='B actions','Old A close retired B');await click(retained);assert(calls===0,'Detached old selection executed');
  const rect=document.querySelector('[data-local-tool-context-menu]')!.getBoundingClientRect();assert(rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,'Corner menu exceeded viewport');
  await act(async()=>{assert(legacy.open(event(trigger('legacy')),entries,{label:'Legacy actions'}),'Legacy declined');await pause();});assert(document.querySelector('[role="menu"]')?.getAttribute('aria-label')==='Legacy actions','Legacy not presented');
  await render(false);const hidden=event(trigger('a'));assert(!a.open(hidden,entries,{label:'Hidden'})&&JSON.stringify(hidden.counts())==='[0,0]','Hidden lease revived');
  await render(true);await until(()=>ports.get(f.source.id)!==a,'Return reused revoked port');const returned=ports.get(f.source.id)!;assert(!a.open(event(trigger('a')),entries,{label:'ABA'}),'Old hide-return port revived');
  await act(async()=>{assert(returned.open(event(trigger('a')),entries,{label:'Returned'}),'Returned declined');await pause();});await render(true,'past');await until(()=>ports.get(f.source.id)!==returned,'Era retained old port');assert(!document.querySelector('[data-local-tool-context-menu]')&&!returned.open(event(trigger('a')),entries,{label:'Old era'}),'Era retained presentation or lease');
  const era=ports.get(f.source.id)!;await render(true,'past',true);assert(!era.open(event(document.querySelector<HTMLElement>('[data-pane="b"] [data-menu-result]')!),entries,{label:'Readonly'}),'Readonly revived author port');assert(before===JSON.stringify(await db.projects.get(f.projectId)),'Menu lifecycle wrote project');
  const last=b;await act(async()=>root.unmount());assert(!last.open(event(trigger('b')),entries,{label:'Unmounted'}),'Unmounted port revived');
  return ['Real Source/legacy isolate roots, reject invalid before replacement/consumption, revoke hide-return/era/readonly/unmount leases and preserve saved bytes','One presenter per document, old close/selection cannot adopt B, corner placement stays in viewport'];
 }finally{if(document.querySelector('[data-source-document-host]'))await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuRelease(){
 const namespace='test.context-menu-release',hashes=['a','b'].map(x=>x.repeat(64));
 for(let i=0;i<2;i++){const source=defineLocalTool({...definition,namespace}),manifest:LocalToolReleaseManifest={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version:`0.${i}.0`,contentHash:hashes[i],files:[{path:'module.tsx',bytes:1,sha256:'c'.repeat(64)}]},path=`./installed/${namespace}/versions/${hashes[i]}/module.tsx`;registerLocalToolModules({[path]:{default:source}},{[path.replace('module.tsx','release.json')]:manifest});}
 const f=await fixture();await db.projects.update(f.projectId,{enabledEngines:['local-tool-'+namespace]});await pinLocalToolRelease(f.projectId,namespace,hashes[0],null);const source=await createSourceToolDocument({projectId:f.projectId},namespace,'Pinned menu'),root=createRoot(document.getElementById('root')!);
 try{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={source.id}/></MemoryRouter>));await until(()=>!!ports.get(source.id),'Pinned port missing');const a=ports.get(source.id)!,target=document.querySelector<HTMLElement>('[data-menu-result]')!,event={currentTarget:target,clientX:100,clientY:100,preventDefault(){},stopPropagation(){}};let invoked=false;
  await act(async()=>{assert(a.open(event,[{kind:'item',id:'old',label:'Old release',onSelect:()=>{invoked=true;}}],{label:'Pinned'}),'PinA declined');});const old=document.querySelector('[role="menuitem"]')!;await pinLocalToolRelease(f.projectId,namespace,hashes[1],1);await until(()=>ports.get(source.id)!==a,'Pin did not revoke port');assert(!document.querySelector('[data-local-tool-context-menu]'),'Pin retained menu');await click(old);assert(!invoked&&!a.open(event,[{kind:'item',id:'old',label:'Old',onSelect:()=>{invoked=true;}}],{label:'Stale'}),'Old release adopted new pin');
  return ['Selected compiled-registry release fixtures revoke old menu ports and selections on pin change (not package installation E2E)'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuExample(){
 registerLocalToolModules({'./installed/examples.context-counter/module.tsx':{default:actualDefinition}});const f=await fixture();await db.projects.update(f.projectId,{enabledEngines:['local-tool-'+actualDefinition.namespace]});const source=await createSourceToolDocument({projectId:f.projectId},actualDefinition.namespace,'Actual counter'),root=createRoot(document.getElementById('root')!);
 try{const render=async()=>{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={source.id}/></MemoryRouter>));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Actual example unavailable');};await render();
  await click(document.querySelector('[data-context-counter-action="actions"]'));const items=[...document.querySelectorAll<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]')];assert(items.length===3&&items[0].textContent==='Increment'&&items[1].textContent==='Reset'&&items[1].disabled&&items[2].textContent==='More actions','Existing flat actions or disabled Reset were lost at zero');assert(document.querySelector('[role="separator"]'),'Separator missing');
  await click(items[0]);await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Actual menu action missing');await click(document.querySelector('[data-context-counter-action="undo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Explicit UI Undo failed');await click(document.querySelector('[data-context-counter-action="redo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Explicit UI Redo failed');
  await click(document.querySelector('[data-context-counter-action="reset"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Reset button failed');
  await click(document.querySelector('[data-context-counter-action="actions"]'));await click(menuItem('More actions'));await click(menuItem('Increment',1));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Nested example increment did not persist');
  await click(document.querySelector('[data-context-counter-action="actions"]'));await click(menuItem('More actions'));await click(menuItem('Count',1));await click(menuItem('Reset',2));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Deep example reset did not persist');
  await click(document.querySelector('[data-context-counter-action="undo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Deep reset UI Undo did not restore one');await click(document.querySelector('[data-context-counter-action="redo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Deep reset UI Redo did not restore zero');
  await act(async()=>{root.render(<MemoryRouter><p>Closed</p></MemoryRouter>);await pause();});await render();assert(!document.querySelector('[data-local-tool-context-menu]'),'Popup persisted on reopen');
  const saved=JSON.stringify(await db.projects.get(f.projectId));assert(!saved.includes('onSelect')&&!saved.includes('contextMenu'),'Menu entered stored JSON');
  return ['Actual installed example menu/button changes persist; explicit receipt Undo/Redo/reset and reopen work without storing popup'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuNative(){
 const native=(window as unknown as{__contextMenuNative:{execute:(payload:unknown)=>Promise<{ok:boolean;result?:Record<string,unknown>;error?:unknown}>}}).__contextMenuNative;assert(native,'Use actual Native wrapper');
 registerLocalToolModules({'./installed/examples.context-counter/module.tsx':{default:actualDefinition}});const f=await fixture();await db.projects.update(f.projectId,{enabledEngines:['local-tool-'+actualDefinition.namespace],worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});const source=await createSourceToolDocument({projectId:f.projectId},actualDefinition.namespace,'Native counter'),root=createRoot(document.getElementById('root')!);
 const args={projectId:f.projectId,namespace:actualDefinition.namespace,documentId:source.id},run=async(tool:string,more:Record<string,unknown>={})=>{const result=await native.execute({tool,args:{...args,...more}});assert(result.ok,'Native rejected '+tool+' '+JSON.stringify(result));return result.result!;};
 try{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={source.id}/></MemoryRouter>));await until(()=>!!document.querySelector('[data-context-counter]'),'Native actual module not mounted');const before=JSON.stringify(await db.projects.get(f.projectId)),described=await native.execute({tool:'wh_local_tool_describe',args:{projectId:f.projectId,namespace:actualDefinition.namespace}});assert(described.ok,'Native describe rejected '+JSON.stringify(described));const describe=described.result!;assert(Array.isArray(describe.operations)&&describe.operations.length===2&&!JSON.stringify(describe).includes('onSelect')&&!Object.hasOwn(describe,'contextMenu'),'Describe exposed callbacks or lost operations');assert(before===JSON.stringify(await db.projects.get(f.projectId)),'Describe wrote');
  const first=await run('wh_local_tool_call',{operation:'increment',input:{}});assert(first.count===1&&typeof first.receiptId==='string','Native increment missing receipt');await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Native operation not visible');const undone=await run('wh_local_tool_state_undo',{receiptId:first.receiptId});assert((undone.snapshot as{data:{count:number}}).data.count===0&&typeof undone.receiptId==='string','Native Undo failed');const redo=await run('wh_local_tool_state_redo',{receiptId:undone.receiptId});assert((redo.snapshot as{data:{count:number}}).data.count===1,'Native Redo failed');
  const era=await run('wh_local_tool_call',{eraId:'past',operation:'reset',input:{}});assert(era.count===0&&typeof era.receiptId==='string','Era reset missing receipt');const rejected=await native.execute({tool:'wh_local_tool_state_undo',args:{...args,receiptId:era.receiptId}});assert(!rejected.ok,'Base accepted era receipt');await run('wh_local_tool_state_undo',{eraId:'past',receiptId:era.receiptId});await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Era changed Base');
  await click(document.querySelector('[data-context-counter-action="actions"]'));await click(menuItem('More actions'));await click(menuItem('Increment',1));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='2','Native-mounted nested UI action did not save');
  await click(document.querySelector('[data-context-counter-action="undo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Nested UI receipt Undo failed');await click(document.querySelector('[data-context-counter-action="redo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='2','Nested UI receipt Redo failed');
  const afterNested=await run('wh_local_tool_call',{operation:'reset',input:{}});assert(afterNested.count===0&&typeof afterNested.receiptId==='string','Native reset after nested UI action missed its ordinary operation receipt');await run('wh_local_tool_state_undo',{receiptId:afterNested.receiptId});await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='2','Native receipt Undo after nested UI changed a different source');
  return ['Native executor→IPC→registered describe/call/receipt Undo/Redo use the actual module, selected Source and Base/era without callback serialization or new server'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuInputAndErrors(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);let release:(()=>void)|undefined;
 const render=async(visible=true)=>{await act(async()=>{root.render(<MemoryRouter><ToastHost/><EnginePaneContext.Provider value={{instanceId:'menu-input',projectId:f.projectId,visible}}><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});};
 const native=window as unknown as{__native?:unknown;__nativeAck?:number};let n=0;
 const key=async(keyCode:string)=>{const id=++n;native.__native={n:id,events:[{type:'keyDown',keyCode},{type:'keyUp',keyCode}]};await until(()=>native.__nativeAck===id,'Native keyboard input missing');};
 try{
  await render();await until(()=>!!ports.get(f.source.id),'Input port missing');const port=ports.get(f.source.id)!,target=document.querySelector<HTMLElement>('[data-menu-result]')!;let selected=0;
  const event={currentTarget:target,type:'contextmenu',clientX:50,clientY:80,preventDefault(){},stopPropagation(){}};
  const entries:LocalToolMenuEntry[]=[{kind:'label',label:'Counter'},{kind:'item',id:'disabled',label:'Disabled',disabled:true,onSelect:()=>{selected+=100;}},{kind:'separator'},{kind:'item',id:'first',label:'First action',onSelect:()=>{selected++;}},{kind:'item',id:'last',label:'Last action',onSelect:()=>{selected+=10;}}];
  await act(async()=>{assert(port.open(event,entries,{label:'Keyboard actions'}),'Input menu declined');await pause();});assert(document.activeElement?.textContent==='First action','First enabled action not focused');entries[3]={kind:'item',id:'changed',label:'Changed',onSelect:()=>{selected+=1000;}};
  assert(document.querySelector('[role="menu"]')?.textContent?.includes('First action')&&!document.querySelector('[role="menu"]')?.textContent?.includes('Changed'),'Host retained mutable entry array');
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));});assert(document.activeElement?.textContent==='Last action','End failed');const entered=document.activeElement as HTMLElement;await key('Enter');assert(selected===10&&!document.querySelector('[data-local-tool-context-menu]'),'Native Enter did not select exactly one enabled action');await click(entered);assert(selected===10,'Default click after Enter invoked retired selection again');
  await act(async()=>{assert(port.open(event,[{kind:'item',id:'space',label:'Space action',onSelect:()=>{selected+=20;}}],{label:'Space activation'}),'Space menu declined');await pause();});const spaced=document.activeElement as HTMLElement;await key('Space');assert(selected===30&&!document.querySelector('[data-local-tool-context-menu]'),'Native Space did not activate once');await click(spaced);assert(selected===30,'Default click after Space invoked retired selection again');
  await act(async()=>{assert(port.open(event,entries,{label:'Tab actions'}),'Tab menu declined');await pause();});const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});await act(async()=>{document.activeElement!.dispatchEvent(tab);await pause();});assert(!document.querySelector('[data-local-tool-context-menu]')&&document.activeElement===target&&!tab.defaultPrevented,'Tab failed to retire/restore without consuming normal browser traversal');
  await act(async()=>{assert(port.open(event,entries,{label:'Scroll actions'}),'Scroll menu declined');await pause();});assert(document.querySelector('[data-local-tool-context-menu]'),'Scroll fixture popup not committed');await act(async()=>{document.dispatchEvent(new Event('scroll'));await pause();});assert(!document.querySelector('[data-local-tool-context-menu]'),'Outside scroll retained stale menu');
  await act(async()=>{assert(port.open(event,[{kind:'item',id:'fail',label:'Fail action',onSelect:async()=>{throw Error('INTERNAL_DO_NOT_SHOW');}}],{label:'Failure'}),'Failure menu declined');await pause();});await click(document.querySelector('[role="menuitem"]'));await until(()=>!!document.querySelector('[role="alert"]'),'Action rejection not reported');assert(!document.body.textContent?.includes('INTERNAL_DO_NOT_SHOW'),'Raw callback diagnostic leaked');await click(document.querySelector('[role="alert"] button'));
  let started=false;const gate=new Promise<void>(resolve=>release=resolve);await act(async()=>{assert(port.open(event,[{kind:'item',id:'late',label:'Delayed action',onSelect:async()=>{started=true;await gate;throw Error('late');}}],{label:'Delayed'}),'Delayed menu declined');await pause();});await click(document.querySelector('[role="menuitem"]'));assert(started,'Admitted callback never started');await render(false);release();await act(async()=>{await pause();});assert(!document.querySelector('[role="alert"]'),'Rejected callback from revoked host notified another surface');
  return ['Normal CSS host owns entry copies, skips disabled items, native keydown Enter/Space activate once; Tab retires/restores without consuming browser default (visible traversal belongs to Brave), scroll and readable failures work','Already-started callback is not claimed cancellable; after host revocation its rejection cannot notify another surface'];
 }finally{release?.();await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuBeforeCallback(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);let observed:{menuPresent:boolean;triggerFocused:boolean}|undefined;
 try{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></MemoryRouter>));await until(()=>!!ports.get(f.source.id),'Callback control Source missing');const target=document.querySelector<HTMLElement>('[data-menu-result]')!;
  await act(async()=>{assert(ports.get(f.source.id)!.open({currentTarget:target,clientX:80,clientY:80,preventDefault(){},stopPropagation(){}},[{kind:'item',id:'inspect',label:'Inspect before dialog',onSelect:()=>{observed={menuPresent:!!document.querySelector('[data-local-tool-context-menu]'),triggerFocused:document.activeElement===target};}}],{label:'Callback order'}),'Callback control declined');await pause();});await click(document.querySelector('[role="menuitem"]'));
  assert(observed&&!observed.menuPresent&&observed.triggerFocused,'Callback began before popup DOM retired and trigger focus restored: '+JSON.stringify(observed));return ['Menu DOM is already retired and trigger focused synchronously inside callback, before an action may open another surface'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

const capture=window as unknown as{__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string};
export async function testLocalToolContextMenuVisual(){
 registerLocalToolModules({'./installed/examples.context-counter/module.tsx':{default:actualDefinition}});const f=await fixture();await db.projects.update(f.projectId,{enabledEngines:['local-tool-'+actualDefinition.namespace]});const source=await createSourceToolDocument({projectId:f.projectId},actualDefinition.namespace,'QA contextual counter'),root=createRoot(document.getElementById('root')!),old=useLocaleStore.getState().locale;
 try{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={source.id}/></MemoryRouter>));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Visual actual module unavailable');await click(document.querySelector('[data-context-counter-action="increment"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Visual count did not save');let n=0;
  for(const locale of ['en','es']as const){await act(async()=>{useLocaleStore.getState().setLocale(locale);await pause();});for(const width of [1280,390]){const id=++n;capture.__want={w:width,h:800,n:id};await until(()=>capture.__sizeAck===id,'Visual resize missing');await click(document.querySelector('[data-context-counter-action="actions"]'));await until(()=>!!document.querySelector('[data-local-tool-context-menu]'),'Visual menu missing');await click(menuItem(locale==='en'?'More actions':'Más acciones'));await click(menuItem(locale==='en'?'Count':'Cuenta',1));const menu=document.querySelectorAll<HTMLElement>('[data-local-tool-context-menu]')[2]!,rect=menu.getBoundingClientRect();assert(getComputedStyle(menu).opacity==='1'&&rect.width>0&&rect.left>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,'Visual menu not settled/contained');assert(document.documentElement.scrollWidth<=innerWidth+1,'Visual page overflow');
    const name=`context-submenu-${locale}-${width}`;capture.__shot={name,forcePaint:true};await until(()=>capture.__shotDone===name,'Visual screenshot missing');await click(menu.querySelector('[data-menu-back]'));assert(document.querySelectorAll('[data-local-tool-context-menu]').length===2,'Visual narrow Back did not return one level');while(document.querySelector('[data-local-tool-context-menu]')){await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});}}}
  return ['Actual installed Source example and host menu, one settled EN/ES1280/390 screenshot batch; warm first frames excluded'];
 }finally{await act(async()=>root.unmount());useLocaleStore.getState().setLocale(old);await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenus(){
 const results:string[]=[];
 for(const run of [testLocalToolContextMenuHost,testLocalToolContextMenuTourKeys,testLocalToolContextMenuTourOutside,testLocalToolContextMenuIsolation,testLocalToolContextMenuRelease,testLocalToolContextMenuExample,testLocalToolContextMenuInputAndErrors,testLocalToolContextMenuBeforeCallback,testLocalToolContextMenuSubmenuSource,testLocalToolContextMenuSubmenuNavigation,testLocalToolContextMenuSubmenuOwners,testLocalToolContextMenuSubmenuTour])results.push(...await run());
 return results;
}

// Prospective runtime contract: this fixture predates the public submenu type.
// Its cast permits execution against the current SDK; a TypeScript/import error
// is deliberately not the RED being asserted here.
function SubmenuCounterProbe({client,context}:LocalToolProps<{count:number}>){
 const [count,setCount]=useState<number|null>(null),[admitted,setAdmitted]=useState<boolean|null>(null);
 useEffect(()=>{let live=true;const read=()=>{void client.read().then(row=>{if(live)setCount(row.data.count);});};read();const off=client.subscribe?.(read);return()=>{live=false;off?.();};},[client]);
 const increment=async()=>{const before=await client.read();await client.state!.apply(before,[{type:'set',field:'count',value:before.data.count+1}]);};
 const openFlat=(event:React.MouseEvent<HTMLButtonElement>)=>setAdmitted(context?.contextMenu?.open(event,[{kind:'item',id:'flat-increment',label:'Flat increment',onSelect:increment}],{label:'Flat positive'})??false);
 const openTree=(event:React.MouseEvent<HTMLButtonElement>)=>{
  const entries=[{kind:'item',id:'root-increment',label:'Root increment',onSelect:increment},{kind:'submenu',id:'more',label:'More actions',entries:[{kind:'item',id:'more-increment',label:'Nested increment',onSelect:increment}]}];
  setAdmitted(context?.contextMenu?.open(event,entries as unknown as LocalToolMenuEntry[],{label:'Nested actions'})??false);
 };
 return <section data-submenu-probe><output data-submenu-count>{count??'loading'}</output><output data-submenu-admitted>{String(admitted)}</output><button data-submenu-normal type="button" onClick={()=>void increment()}>Normal increment</button><button data-submenu-flat type="button" onClick={openFlat}>Flat actions</button><button data-submenu-tree type="button" onClick={openTree}>Nested actions</button></section>;
}

export async function testLocalToolContextMenuSubmenuSource(){
 const own=defineLocalTool({...definition,namespace:'test.context-submenu-probe',component:SubmenuCounterProbe}),projectId='context-submenu-'+crypto.randomUUID();
 registerLocalToolModules({'./installed/test.context-submenu-probe/module.tsx':{default:own}});
 await db.projects.put({id:projectId,title:'Own submenu QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+own.namespace],createdAt:1,updatedAt:1});
 const source=await createSourceToolDocument({projectId},own.namespace,'Own submenu counter'),root=createRoot(document.getElementById('root')!);
 const count=()=>document.querySelector('[data-submenu-count]')?.textContent;
 try{
  await act(async()=>root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{instanceId:'submenu-source-probe',projectId,visible:true}}><LocalToolDocumentHost projectId={projectId} documentId={source.id}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>));
  await until(()=>count()==='0','Actual Source submenu fixture did not mount');
  await click(document.querySelector('[data-submenu-normal]'));await until(()=>count()==='1','Positive normal Source action did not save');
  console.log('SUBMENU_POSITIVE normal Source button saved count=1');
  await click(document.querySelector('[data-submenu-flat]'));
  assert(document.querySelector('[data-submenu-admitted]')?.textContent==='true','Positive flat host menu was declined');
  const flat=[...document.querySelectorAll<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]')].find(row=>row.textContent==='Flat increment');
  await click(flat??null);await until(()=>count()==='2','Positive flat Source menu action did not save');
  assert(!document.querySelector('[data-local-tool-context-menu]'),'Flat positive did not close');
  console.log('SUBMENU_POSITIVE flat host menu saved count=2 and retired its DOM');
  const before=JSON.stringify(await db.projects.get(projectId));
  await click(document.querySelector('[data-submenu-tree]'));
  console.log('SUBMENU_BRANCH admitted='+document.querySelector('[data-submenu-admitted]')?.textContent+' menus='+document.querySelectorAll('[data-local-tool-context-menu]').length);
  const branch=[...document.querySelectorAll<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]')].find(row=>row.textContent==='More actions');
  assert(branch,'Source host did not present the requested submenu branch after the normal button and flat-menu positives');
  await click(branch);
  const nested=[...document.querySelectorAll<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]')].find(row=>row.textContent==='Nested increment');
  assert(nested,'Opening the actual submenu branch did not present its child action');
  assert(before===JSON.stringify(await db.projects.get(projectId)),'Navigating the submenu wrote saved state');
  await click(nested);await until(()=>count()==='3','Nested Source action did not save through the ordinary state operation');
  assert(!document.querySelector('[data-local-tool-context-menu]'),'Nested selection retained popup DOM');
  assert((await db.projects.get(projectId))?.sourceToolDocuments?.find(row=>row.id===source.id)?.data?.count===3,'Nested Source change was not persisted in its document');
  return ['Real Source normal button and flat menu remain positive; requested submenu branch opens, navigates readonly and commits its own leaf action'];
 }finally{await act(async()=>root.unmount());await deleteProject(projectId);}
}

function menuItem(label:string,depth=0,doc:Document=document){
 const menu=doc.querySelectorAll('[data-local-tool-context-menu][role="menu"]')[depth];
 return [...menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]].find(row=>row.textContent===label)??null;
}
async function menuKey(key:string,doc:Document=document){await act(async()=>{const win=doc.defaultView!;doc.activeElement?.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await pause();});}

export async function testLocalToolContextMenuSubmenuNavigation(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);let calls=0,inside:{menus:number;focused:boolean}|undefined;
 try{
  await act(async()=>root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></MemoryRouter></StrictMode>));await until(()=>!!ports.get(f.source.id),'Nested navigation Source port missing');
  const port=ports.get(f.source.id)!,target=document.querySelector<HTMLElement>('[data-menu-result]')!,event={currentTarget:target,type:'contextmenu',clientX:innerWidth-2,clientY:innerHeight-2,preventDefault(){},stopPropagation(){}};
  const selected=()=>{calls++;inside={menus:document.querySelectorAll('[data-local-tool-context-menu]').length,focused:document.activeElement===target};};
  const rows:LocalToolMenuEntry[]=[{kind:'label',label:'Root label'},{kind:'item',id:'plain',label:'Plain',onSelect:selected},{kind:'submenu',id:'disabled-root',label:'Disabled branch',disabled:true,entries:[{kind:'item',id:'disabled-child',label:'Never',onSelect:selected}]},{kind:'submenu',id:'a',label:'Branch A',entries:[{kind:'label',label:'Child label'},{kind:'item',id:'disabled-leaf',label:'Disabled leaf',disabled:true,onSelect:selected},{kind:'separator'},{kind:'item',id:'leaf-a',label:'Leaf A',onSelect:selected},{kind:'submenu',id:'deep',label:'Deep',entries:[{kind:'item',id:'deep-leaf',label:'Deep leaf',onSelect:selected}]}]},{kind:'submenu',id:'b',label:'Branch B',entries:[{kind:'item',id:'leaf-b',label:'Leaf B',onSelect:selected}]}];
  const before=JSON.stringify(await db.projects.get(f.projectId)),open=async()=>{await act(async()=>{assert(port.open(event,rows,{label:'Navigation tree'}),'Valid nested request declined');await pause();});};
  await open();assert(document.activeElement===menuItem('Plain'),'Root first enabled action was not focused');await menuKey('End');assert(document.activeElement===menuItem('Branch B'),'Root End did not use its own level');await menuKey('Home');await menuKey('ArrowDown');assert(document.activeElement===menuItem('Branch A'),'Root arrows did not skip the disabled branch');await menuKey('ArrowRight');
  assert(document.querySelectorAll('[data-local-tool-context-menu]').length===2&&document.activeElement===menuItem('Leaf A',1),'Right did not focus the first enabled child');
  assert(menuItem('Branch A')?.getAttribute('aria-expanded')==='true'&&document.getElementById(menuItem('Branch A')!.getAttribute('aria-controls')!)?.getAttribute('role')==='menu','Branch ARIA did not identify its visible child');
  const child=menuItem('Leaf A',1)!;await act(async()=>{child.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));child.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await pause();});assert(document.querySelectorAll('[data-local-tool-context-menu]').length===2,'Child pointer or focus was treated as outside');
  await menuKey('Home');assert(document.activeElement?.hasAttribute('data-menu-back'),'Home did not make the explicit Back reachable');await menuKey('End');assert(document.activeElement===menuItem('Deep',1),'Child End escaped its own level');await menuKey('ArrowRight');assert(document.querySelectorAll('[data-local-tool-context-menu]').length===3&&document.activeElement===menuItem('Deep leaf',2),'Deep branch did not open/focus');
  const deepOld=menuItem('Deep leaf',2)!;await menuKey('Escape');assert(document.querySelectorAll('[data-local-tool-context-menu]').length===2&&document.activeElement===menuItem('Deep',1),'Deep Escape failed to restore parent focus');await menuKey('ArrowLeft');assert(document.querySelectorAll('[data-local-tool-context-menu]').length===1&&document.activeElement===menuItem('Branch A'),'Left failed to restore the root branch');await click(deepOld);assert(calls===0,'Retired deep leaf invoked');
  await menuKey('ArrowRight');await click(document.querySelectorAll('[data-local-tool-context-menu]')[1].querySelector('[data-menu-back]'));assert(document.querySelectorAll('[data-local-tool-context-menu]').length===1&&document.activeElement===menuItem('Branch A'),'Pointer Back failed to return one level');
  await menuKey('ArrowRight');const oldA=menuItem('Leaf A',1)!;await act(async()=>{const sibling=menuItem('Branch B')!;sibling.focus();assert(document.activeElement===sibling,'Sibling focus positive failed');/* Hidden Electron updates activeElement without focusin; use the same explicit event as the incumbent focus oracle. */sibling.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await pause();});assert(document.querySelectorAll('[data-local-tool-context-menu]').length===1,'Changing parent focus retained unrelated descendants');await menuKey(' ');assert(document.activeElement===menuItem('Leaf B',1),'Space did not open a sibling');await menuKey('Escape');await click(menuItem('Branch A'));await click(oldA);assert(calls===0,'Retired A leaf adopted the A→B→A reopening');
  const a=rows[3];assert(a.kind==='submenu','Fixture A invalid');a.label='Changed branch';const leaf=a.entries[3];assert(leaf.kind==='item','Fixture leaf invalid');leaf.label='Changed leaf';leaf.onSelect=()=>{calls+=100;};assert(menuItem('Leaf A',1)&&!menuItem('Changed leaf',1),'Open nested tree retained author metadata aliases');
  const invalidEvent={...event,preventDefault(){throw Error('Invalid input consumed default');},stopPropagation(){throw Error('Invalid input stopped propagation');}},invalid=[{kind:'item',id:'duplicate',label:'First',onSelect:selected},{kind:'submenu',id:'invalid-parent',label:'Invalid',entries:[{kind:'item',id:'duplicate',label:'Duplicate deep',onSelect:selected}]}] as LocalToolMenuEntry[];
  assert(!port.open(invalidEvent,invalid,{label:'Invalid deep request'})&&!!menuItem('Leaf A',1),'Invalid deep request replaced the valid tree');
  for(const menu of document.querySelectorAll<HTMLElement>('[data-local-tool-context-menu]')){const r=menu.getBoundingClientRect();assert(r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'Nested corner placement escaped viewport');}
  assert(before===JSON.stringify(await db.projects.get(f.projectId)),'Nested open/focus/navigation wrote the project');await menuKey('Enter');assert(calls===1&&inside?.menus===0&&inside.focused,'Nested callback did not observe the entire DOM retired and trigger focused');await click(oldA);assert(calls===1,'Retired leaf double-selected');
  await open();await click(menuItem('Changed branch'));const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});await act(async()=>{document.activeElement!.dispatchEvent(tab);await pause();});assert(!tab.defaultPrevented&&!document.querySelector('[data-local-tool-context-menu]')&&document.activeElement===target,'Child Tab did not retire all levels without consuming browser traversal');
  return ['Nested Source levels own keyboard/focus/Back, disabled rows, ARIA, pointer/focus interior and bounded placement; sibling/deep reopen revokes retained leaves','Copied deep metadata and callbacks remain detached, invalid deep input preserves the live tree; navigation is readonly and nested callback sees all DOM removed with trigger focused (Tab default only, visible traversal belongs to ROOT)'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuSubmenuOwners(){
 const f=await fixture(),second=await createSourceToolDocument({projectId:f.projectId},definition.namespace,'Other submenu source'),root=createRoot(document.getElementById('root')!),Engine=f.engine.component;let calls=0;
 await db.projects.update(f.projectId,{worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
 const render=async(visible=true,eraId?:string,readOnly=false)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={['/project/'+f.projectId+'/local-tool-'+definition.namespace+'?legacy=1']}><div data-subowner="a"><EnginePaneContext.Provider value={{instanceId:'submenu-owner-a',projectId:f.projectId,visible,eraId}}><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id} eraId={eraId} readOnly={readOnly}/></EnginePaneContext.Provider></div><div data-subowner="b"><LocalToolDocumentHost projectId={f.projectId} documentId={second.id}/></div><div data-subowner="legacy"><Engine projectId={f.projectId}/></div></MemoryRouter></StrictMode>);await pause();});};
 const tree:LocalToolMenuEntry[]=[{kind:'submenu',id:'owner-branch',label:'Owner branch',entries:[{kind:'item',id:'owner-leaf',label:'Owner leaf',onSelect:()=>{calls++;}}]}];
 const event=(pane:string)=>({currentTarget:document.querySelector<HTMLElement>(`[data-subowner="${pane}"] [data-menu-result]`)!,type:'contextmenu',clientX:120,clientY:110,preventDefault(){},stopPropagation(){}});
 const open=async(port:Menu,pane:string)=>{await act(async()=>{assert(port.open(event(pane),tree,{label:pane+' tree'}),'Nested owner request declined '+pane);await pause();});await click(menuItem('Owner branch'));assert(!!menuItem('Owner leaf',1),'Nested owner child missing');};
 try{
  await render();await until(()=>!!ports.get(f.source.id)&&!!ports.get(second.id)&&!!ports.get('legacy'),'Nested owners did not mount');const a=ports.get(f.source.id)!,b=ports.get(second.id)!,before=JSON.stringify(await db.projects.get(f.projectId));
  await open(a,'a');const retainedA=menuItem('Owner leaf',1)!;await open(b,'b');a.close();assert(document.querySelector('[role="menu"]')?.getAttribute('aria-label')==='b tree','Old owner close removed B tree');await click(retainedA);assert(calls===0,'Old A child selected into B');await click(menuItem('Owner leaf',1));assert(calls===1,'Current B child did not select');
  await open(a,'a');const hiddenLeaf=menuItem('Owner leaf',1)!;await render(false);assert(!document.querySelector('[data-local-tool-context-menu]'),'Hide left nested DOM');await render();await until(()=>ports.get(f.source.id)!==a,'Nested hide-return retained port');await click(hiddenLeaf);assert(calls===1&&!a.open(event('a'),tree,{label:'Revoked'}),'Nested hide-return revived old leaf or port');
  const returned=ports.get(f.source.id)!;await open(returned,'a');await render(true,'past');await until(()=>ports.get(f.source.id)!==returned,'Nested era did not revoke');assert(!document.querySelector('[data-local-tool-context-menu]')&&!returned.open(event('a'),tree,{label:'Old Base'}),'Nested Base port adopted era');
  const era=ports.get(f.source.id)!;await open(era,'a');const eraLeaf=menuItem('Owner leaf',1)!;await render(true,'past',true);await click(eraLeaf);assert(calls===1&&!document.querySelector('[data-local-tool-context-menu]')&&!era.open(event('a'),tree,{label:'Old editable era'}),'Readonly retained editable child');
  await open(ports.get('legacy')!,'legacy');assert(before===JSON.stringify(await db.projects.get(f.projectId)),'Nested owner lifecycle wrote data');await act(async()=>root.unmount());assert(!document.querySelector('[data-local-tool-context-menu]')&&!b.open(event('b'),tree,{label:'Unmounted'}),'Unmount retained nested presentation');
  return ['Nested real Source and legacy trees remain instance-bound through owner replacement, hide-return, Base/era, readonly and unmount; old leaves/ports cannot adopt the current owner and lifecycle does not write'];
 }finally{if(document.querySelector('[data-subowner]'))await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenuSubmenuTour(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(<MemoryRouter><TourHost/><LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/></MemoryRouter>));await until(()=>!!ports.get(f.source.id),'Nested tour Source unavailable');const target=document.querySelector<HTMLElement>('[data-menu-result]')!;target.setAttribute('data-tour','dashboard-new-project');
  await act(async()=>{assert(await startTour('first-world'),'Real tour did not start for nested control');});const step=useTourStore.getState().active!.index;
  const tree:LocalToolMenuEntry[]=[{kind:'submenu',id:'tour-branch',label:'Tour branch',entries:[{kind:'submenu',id:'tour-deep',label:'Tour deep',entries:[{kind:'item',id:'tour-leaf',label:'Tour leaf',onSelect:()=>{throw Error('Tour navigation must not invoke');}}]}]}];
  await act(async()=>{assert(ports.get(f.source.id)!.open({currentTarget:target,type:'contextmenu',clientX:130,clientY:140,preventDefault(){},stopPropagation(){}},tree,{label:'Tour tree'}),'Nested tour menu declined');await pause();});await menuKey('ArrowRight');await menuKey('ArrowRight');assert(document.querySelectorAll('[data-local-tool-context-menu]').length===3,'Tour capture swallowed a submenu Right');
  for(const expected of [2,1,0]){await menuKey('Escape');assert(document.querySelectorAll('[data-local-tool-context-menu]').length===expected&&useTourStore.getState().active?.index===step,'Nested Escape reached the tour before its menus retired');}
  assert(document.activeElement===target,'Root Escape did not restore tour trigger');await menuKey('Escape');assert(!useTourStore.getState().active,'Following Escape did not return to the normal tour');
  return ['Unchanged real TourHost delegates nested Right/Escape to the visible SDK tree; children return one level, root retires, only the following Escape closes the tour'];
 }finally{closeTour();await act(async()=>root.unmount());await deleteProject(f.projectId);}
}
