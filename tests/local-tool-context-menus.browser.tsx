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
  await click(document.querySelector('[data-context-counter-action="actions"]'));const items=[...document.querySelectorAll<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]')];assert(items.length===2&&items[1].disabled,'Reset not disabled at zero');assert(document.querySelector('[role="separator"]'),'Separator missing');
  await click(items[0]);await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Actual menu action missing');await click(document.querySelector('[data-context-counter-action="undo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Explicit UI Undo failed');await click(document.querySelector('[data-context-counter-action="redo"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='1','Explicit UI Redo failed');
  await click(document.querySelector('[data-context-counter-action="reset"]'));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Reset button failed');
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
 try{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={source.id}/></MemoryRouter>));await until(()=>document.querySelector('[data-context-counter-value]')?.textContent==='0','Visual actual module unavailable');let n=0;
  for(const locale of ['en','es']as const){await act(async()=>{useLocaleStore.getState().setLocale(locale);await pause();});for(const width of [1280,390]){const id=++n;capture.__want={w:width,h:800,n:id};await until(()=>capture.__sizeAck===id,'Visual resize missing');await click(document.querySelector('[data-context-counter-action="actions"]'));await until(()=>!!document.querySelector('[data-local-tool-context-menu]'),'Visual menu missing');const menu=document.querySelector<HTMLElement>('[data-local-tool-context-menu]')!,rect=menu.getBoundingClientRect();assert(getComputedStyle(menu).opacity==='1'&&rect.width>0&&rect.left>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,'Visual menu not settled/contained');assert(document.documentElement.scrollWidth<=innerWidth+1,'Visual page overflow');
    const name=`context-menu-${locale}-${width}`;capture.__shot={name,forcePaint:true};await until(()=>capture.__shotDone===name,'Visual screenshot missing');await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();});}}
  return ['Actual installed Source example and host menu, one settled EN/ES1280/390 screenshot batch; warm first frames excluded'];
 }finally{await act(async()=>root.unmount());useLocaleStore.getState().setLocale(old);await deleteProject(f.projectId);}
}

export async function testLocalToolContextMenus(){
 const results:string[]=[];
 for(const run of [testLocalToolContextMenuHost,testLocalToolContextMenuTourKeys,testLocalToolContextMenuTourOutside,testLocalToolContextMenuIsolation,testLocalToolContextMenuRelease,testLocalToolContextMenuExample,testLocalToolContextMenuInputAndErrors,testLocalToolContextMenuBeforeCallback])results.push(...await run());
 return results;
}
