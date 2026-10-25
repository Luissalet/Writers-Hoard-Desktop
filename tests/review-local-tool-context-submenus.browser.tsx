// Independent 1505 oracle, prepared from the public contract before author freeze.
// It does not import the author's Browser/Node assertions or copy its presenter.
import {act,useEffect,useLayoutEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {pinLocalToolRelease} from '@/engines/local/releases';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {defineLocalTool,type LocalToolClient,type LocalToolContextMenuPort,type LocalToolJson,type LocalToolMenuEntry,type LocalToolMenuTrigger,type LocalToolProps} from '@/engines/local/sdk';
import {useLocaleStore} from '@/stores/localeStore';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=40)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function until(predicate:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await act(async()=>{await pause();});}throw Error(message);}
const namespace='review.context-submenus';
type Count={count:number};
type Binding={client:LocalToolClient<Count>;port?:LocalToolContextMenuPort};
type Observation={panels:number;focused:boolean};
type Model={entries:LocalToolMenuEntry[];binding?:Binding;admitted?:boolean;calls:number;wrongCalls:number;receiptId?:string;readError?:string;observations:Observation[]};
const models=new Map<string,Model>();
const modelFor=(id:string)=>{let value=models.get(id);if(!value){value={entries:[],calls:0,wrongCalls:0,observations:[]};models.set(id,value);}return value;};
const menus=()=>[...document.querySelectorAll<HTMLElement>('[data-local-tool-context-menu][role="menu"]')];
const trigger=(id:string)=>document.querySelector<HTMLButtonElement>('[data-review-submenu-trigger="'+id+'"]');
const panel=(label:string)=>menus().find(node=>node.getAttribute('aria-label')===label);
function item(label:string,within:ParentNode=document){return[...within.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent?.trim()===label)??null;}
async function click(node:HTMLElement|null|undefined,message:string){check(node,message);await act(async()=>{node.click();await pause();});}
async function key(node:HTMLElement,keyValue:string){await act(async()=>{node.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:keyValue}));await pause();});}
async function increment(client:LocalToolClient<Count>){const before=await client.read();check(client.state,'Real client state operations missing');return client.state.apply(before,[{type:'set',field:'count',value:before.data.count+1}]);}

function OwnSource({client,context}:LocalToolProps<Count>){
 const id=context.document!.id,model=modelFor(id),[count,setCount]=useState<number|null>(null);
 useLayoutEffect(()=>{const binding={client,port:context.contextMenu};model.binding=binding;return()=>{if(model.binding===binding)model.binding=undefined;};},[client,context.contextMenu,model]);
 useEffect(()=>{let live=true;const refresh=()=>{void client.read().then(row=>{if(live)setCount(row.data.count);}).catch(error=>{if(live){model.readError=String(error);setCount(null);}});};refresh();const off=client.subscribe?.(refresh);return()=>{live=false;off?.();};},[client,model]);
 return <section data-review-submenu-source={id}><output data-review-submenu-count={id}>{count??'loading'}</output><button type="button" data-review-submenu-trigger={id} onContextMenu={event=>{model.admitted=context.contextMenu?.open(event,model.entries,{label:'Independent actions'});}}>Independent actions</button></section>;
}
const definition=defineLocalTool({
 namespace,name:{en:'Independent submenu fixture',es:'Fixture independiente de ramas'},description:{en:'Own Source fixture',es:'Source propio'},initialState:{count:0},
 validateState:(value:LocalToolJson):value is Count=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.count==='number'&&Number.isFinite(value.count),
 codec:{version:1,fields:{count:{kind:'scalar'}}},document:{defaultTitle:{en:'Independent document',es:'Documento independiente'}},preview:{version:1,fields:[{key:'count',label:{en:'Count',es:'Cuenta'}}]},
 operations:[{id:'increment',description:{en:'Increment once',es:'Incrementar una vez'},writes:true,inputSchema:{type:'object',properties:{},additionalProperties:false},run:async(_input:Record<string,LocalToolJson>,client:LocalToolClient<Count>)=>{const result=await increment(client);return{count:result.snapshot.data.count,receiptId:result.receiptId};}}],component:OwnSource,
});
const releaseHashes=['c'.repeat(64),'d'.repeat(64)];
function register(){
 const modules:Record<string,unknown>={[`./installed/${namespace}/module.tsx`]:{default:definition}},manifests:Record<string,unknown>={};
 for(const[version,hash]of releaseHashes.entries()){
  const prefix=`./installed/${namespace}/versions/${hash}/`;modules[prefix+'module.tsx']={default:definition};
  manifests[prefix+'release.json']={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,contentHash:hash,version:String(version+1),files:[{path:'module.tsx',sha256:'f'.repeat(64),bytes:1}]};
 }
 registerLocalToolModules(modules,manifests);
}
type Leaf=Extract<LocalToolMenuEntry,{kind:'item'}>;
function tree(id:string){
 const model=modelFor(id);
 const commit:Leaf={kind:'item',id:'deep-commit',label:'Commit one',onSelect:()=>{
  model.calls++;model.observations.push({panels:menus().length,focused:document.activeElement===trigger(id)});
  const client=model.binding?.client;check(client,'Callback must use the real mounted Source client');
  return increment(client).then(result=>{model.receiptId=result.receiptId;});
 }};
 const entries:LocalToolMenuEntry[]=[
  {kind:'item',id:'flat-control',label:'Flat control',onSelect:()=>{model.wrongCalls++;}},
  {kind:'submenu',id:'branch-a',label:'Branch A',entries:[
   {kind:'label',label:'Owned branch'},
   {kind:'item',id:'a-disabled',label:'Unavailable action',disabled:true,onSelect:()=>{model.wrongCalls++;}},
   {kind:'submenu',id:'a-deeper',label:'A deeper',entries:[{kind:'separator'},commit]},
  ]},
  {kind:'submenu',id:'branch-b',label:'Branch B',entries:[{kind:'item',id:'b-control',label:'B control',onSelect:()=>{model.wrongCalls++;}}]},
 ];model.entries=entries;return{entries,commit};
}
async function fixture(suffix:string,pinned=false){
 register();const projectId='review-submenus-'+suffix+'-'+crypto.randomUUID();
 await db.projects.add({id:projectId,title:'Independent submenu QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',createdAt:1,updatedAt:1,enabledEngines:['local-tool-'+namespace],worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
 const a=await createSourceToolDocument({projectId},namespace,'Own A'),b=await createSourceToolDocument({projectId},namespace,'Own B');tree(a.id);tree(b.id);
 if(pinned)await pinLocalToolRelease(projectId,namespace,releaseHashes[0],null);
 const mount=document.createElement('div');document.getElementById('root')!.append(mount);const root=createRoot(mount),locale=useLocaleStore.getState().locale,loaded=useLocaleStore.getState().loaded;
 useLocaleStore.setState({locale:'en',loaded:true});
 const render=async(id=a.id,eraId?:string,visible=true)=>{
  await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:'independent-submenus',projectId,eraId,visible}}><LocalToolDocumentHost projectId={projectId} documentId={id} eraId={eraId} chrome={false}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
  await until(()=>!!trigger(id)&&document.querySelector('[data-review-submenu-count="'+id+'"]')?.textContent==='0'&&(visible?!!modelFor(id).binding?.port:!modelFor(id).binding?.port),'Real Source owner/port failed to settle');
 };
 const snapshot=async()=>JSON.stringify({project:await db.projects.get(projectId),variants:await db.worldEraVariants.where('projectId').equals(projectId).sortBy('id')});
 const cleanup=async()=>{await act(async()=>{root.unmount();await pause();});mount.remove();models.delete(a.id);models.delete(b.id);await deleteProject(projectId);useLocaleStore.setState({locale,loaded});};
 return{projectId,a,b,render,snapshot,cleanup};
}
async function open(id:string){const node=trigger(id);check(node,'Own real Source trigger missing');const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:70,clientY:90});await act(async()=>{node.dispatchEvent(event);await pause();});check(modelFor(id).admitted===true&&event.defaultPrevented&&menus().length===1,'Source public-port positive must admit the valid tree and consume its actual event');return node;}
async function deep(id:string){await open(id);await click(item('Branch A',panel('Independent actions')),'Branch A missing');await click(item('A deeper',panel('Branch A')),'Deep branch missing');check(menus().length===3&&panel('A deeper'),'Actual root/child/grandchild must remain presented');const leaf=item('Commit one',panel('A deeper'));check(leaf,'Actual grandchild leaf missing');return leaf;}
function counted(target:HTMLElement){let prevented=0,stopped=0;return{currentTarget:target,type:'contextmenu',clientX:80,clientY:90,preventDefault(){prevented++;},stopPropagation(){stopped++;},counts:()=>[prevented,stopped]};}

async function reviewDeepValidationBeforeReplacement(){
 const f=await fixture('validation');
 try{
  await f.render();const before=await f.snapshot(),target=await open(f.a.id),current=panel('Independent actions');check(current,'Valid current menu positive missing');
  const leaf=()=>({kind:'item',id:'valid-leaf',label:'Valid leaf',onSelect:()=>{modelFor(f.a.id).wrongCalls++;}} as const);
  const badGrandchild=[{kind:'submenu',id:'outer',label:'Outer',entries:[{kind:'submenu',id:'inner',label:'Inner',entries:[{kind:'item',id:'bad',label:'Bad',onSelect:17}]}]}];
  const cycle:unknown[]=[];cycle.push({kind:'submenu',id:'cyclic',label:'Cyclic',entries:cycle});
  const duplicate=[leaf(),{kind:'submenu',id:'other',label:'Other',entries:[{kind:'submenu',id:'nested',label:'Nested',entries:[leaf()]}]}];
  for(const[name,entries]of [['invalid-grandchild',badGrandchild],['cycle',cycle],['duplicate-deep-id',duplicate]]as const){
   const event=counted(target);let admitted:boolean|undefined;
   await act(async()=>{admitted=modelFor(f.a.id).binding!.port!.open(event,entries as unknown as LocalToolMenuEntry[],{label:'Rejected '+name});await pause();});
   check(admitted===false&&event.counts().every(value=>value===0),'DEEP_VALIDATION_'+name+': invalid tree consumed an event');
   check(menus().length===1&&panel('Independent actions')===current,'DEEP_VALIDATION_'+name+': invalid tree replaced an already admitted valid menu');
  }
  const input=tree(f.a.id);await open(f.a.id);const branch=input.entries[1] as Extract<LocalToolMenuEntry,{kind:'submenu'}>;
  branch.label='Changed caller branch';const nested=branch.entries[2] as Extract<LocalToolMenuEntry,{kind:'submenu'}>;nested.label='Changed caller nested';input.commit.label='Changed caller leaf';
  check(!Object.isFrozen(input.entries)&&!Object.isFrozen(branch)&&!Object.isFrozen(nested.entries),'Host must not freeze the author containers');
  await click(item('Branch A',panel('Independent actions')),'Detached original branch label missing');await click(item('A deeper',panel('Branch A')),'Detached original nested label missing');
  check(item('Commit one',panel('A deeper'))&&!item('Changed caller leaf'),'Host deep copy retained a mutable author leaf');
  await act(async()=>{modelFor(f.a.id).binding!.port!.close();await pause();});
  check(modelFor(f.a.id).calls===0&&modelFor(f.a.id).wrongCalls===0&&await f.snapshot()===before,'Validation/copy/presentation must not execute or write');
  return 'Independent deep validation: invalid grandchild/cycle/global duplicate decline without event consumption or replacing the current Source menu; detached nested labels and caller mutability preserved';
 }finally{await f.cleanup();}
}

async function reviewBranchLifetimesAndCallbackOrder(){
 const f=await fixture('branches');
 try{
  await f.render();const original=tree(f.a.id),before=await f.snapshot(),old=await deep(f.a.id),rootPanel=panel('Independent actions')!,child=panel('Branch A')!,grandchild=panel('A deeper')!;
  await act(async()=>{grandchild.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));old.focus();old.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await pause();});
  check(menus().length===3&&panel('Independent actions')===rootPanel&&panel('Branch A')===child,'TREE_INTERIOR: focus/pointer entering the real grandchild closed an ancestor');
  await key(old,'Escape');check(menus().length===2&&document.activeElement===item('A deeper',child),'Escape from grandchild must return to its connected parent opener');
  await click(item('Branch B',rootPanel),'Sibling branch B missing');check(menus().length===2&&panel('Branch B')&&!panel('Branch A'),'Sibling switch failed to retire descendants');
  await click(item('Branch A',rootPanel),'Return branch A missing');await click(item('A deeper',panel('Branch A')),'Return grandchild missing');
  const fresh=item('Commit one',panel('A deeper'));check(fresh&&fresh!==old&&!old.isConnected,'Return to A must create a different revocable grandchild opening');
  await click(old,'Retained old DOM control missing');check(modelFor(f.a.id).calls===0&&modelFor(f.a.id).wrongCalls===0&&menus().length===3,'BRANCH_A_B_A: retained old leaf selected or disturbed the current tree');
  check(await f.snapshot()===before,'Opening/navigating/returning branches wrote Source state');
  // The host must preserve the original callback just as it preserved deep labels.
  original.commit.onSelect=()=>{modelFor(f.a.id).wrongCalls++;};
  await click(fresh,'Current grandchild leaf missing');await until(()=>!!modelFor(f.a.id).receiptId,'Current deep leaf did not complete its real state operation');
  const model=modelFor(f.a.id);check(model.calls===1&&model.wrongCalls===0,'Deep selected/copy action did not execute exactly the original callback once');
  check(model.observations.length===1&&model.observations[0].panels===0&&model.observations[0].focused,'CALLBACK_ORDER: a menu panel remained or the trigger was not focused INSIDE the grandchild callback');
  const client=model.binding!.client;check((await client.read()).data.count===1,'Grandchild action did not persist to its actual selected Source');
  check((await db.projects.get(f.projectId))!.sourceToolDocuments!.find(row=>row.id===f.b.id)!.data.count===0,'Selected deep action changed the sibling document');
  const undone=await client.state!.undo(model.receiptId!);check(undone.snapshot.data.count===0&&(await client.read()).data.count===0,'Real receipt Undo did not restore the exact Source count');
  check(!menus().length,'Receipt settlement resurrected menu state');
  return 'Independent branch lifetimes: genuine portal descendants are inside; Escape and sibling A→B→A revoke retained leaves without writes; current grandchild removes all DOM/restores trigger inside callback and persists once with actual receipt Undo';
 }finally{await f.cleanup();}
}

async function reviewSourceOwnerRevocation(){
 for(const mode of ['document','hidden-return','era','release']as const){
  const f=await fixture('owner-'+mode,mode==='release');
  try{
   await f.render();const before=await f.snapshot(),old=await deep(f.a.id),oldPort=modelFor(f.a.id).binding!.port!,oldTrigger=trigger(f.a.id)!;
   if(mode==='document'){await f.render(f.b.id);await f.render(f.a.id);}
   if(mode==='hidden-return'){await f.render(f.a.id,undefined,false);check(!menus().length,'Hidden pane retained descendants');await f.render();}
   if(mode==='era'){await f.render(f.a.id,'past');await f.render();}
   if(mode==='release'){
    await act(async()=>{await pinLocalToolRelease(f.projectId,namespace,releaseHashes[1],1);await pause();});await until(()=>!!modelFor(f.a.id).binding?.port&&modelFor(f.a.id).binding?.port!==oldPort,'Actual releaseB failed to replace Source lease');const bPort=modelFor(f.a.id).binding!.port;
    await act(async()=>{await pinLocalToolRelease(f.projectId,namespace,releaseHashes[0],2);await pause();});await until(()=>!!modelFor(f.a.id).binding?.port&&modelFor(f.a.id).binding?.port!==bPort,'Return to releaseA failed to create a fresh Source lease');
   }
   check(modelFor(f.a.id).binding!.port!==oldPort&&!old.isConnected&&!menus().length,'OWNER_'+mode+': retired source/branch was revived on return');
   const afterExplicitChange=await f.snapshot();if(mode!=='release')check(afterExplicitChange===before,'Owner/hide/era navigation wrote project or effective variants');
   const next=await deep(f.a.id),currentPanels=menus(),event=counted(oldTrigger);check(oldPort.open(event,modelFor(f.a.id).entries,{label:'Stale owner'})===false&&event.counts().every(value=>value===0),'Retired owner port admitted an obsolete trigger');
   await click(old,'Retained retired Source leaf missing');
   check(modelFor(f.a.id).calls===0&&modelFor(f.a.id).wrongCalls===0&&next.isConnected&&menus().length===3&&menus().every((node,index)=>node===currentPanels[index]),'OWNER_'+mode+': stale leaf acted or changed a new owner tree');
   check(await f.snapshot()===afterExplicitChange,'Retired owner invocation introduced a write after explicit context/release mutation');
  }finally{await f.cleanup();}
 }
 return 'Independent Source revocation: document A→B→A, pane hide→return, Base→era→Base and actual pinned release A→B→A reject old ports/leaves without adopting or displacing a new tree; pin writes attributed separately';
}

async function reviewRecursiveRecording(){
 const fake=createFakeLocalToolHost(definition,{projects:[{id:'independent-recursive-fake',updatedAt:1}]}),before=JSON.stringify(fake.inspect());let selected=0;
 const leaf={kind:'item' as const,id:'fake-leaf',label:'Before',onSelect:()=>{selected++;}};
 const entries:LocalToolMenuEntry[]=[{kind:'label',label:'Own label'},{kind:'submenu',id:'fake-a',label:'First',entries:[{kind:'separator'},{kind:'submenu',id:'fake-b',label:'Second',entries:[leaf]}]}];
 const event=new Proxy({},{get(){throw Error('Recorder must not access any event/DOM member');}}) as LocalToolMenuTrigger;
 check(fake.contextMenu.open(event,entries,{label:'Recorded descendants'})===false&&fake.contextMenuRequests.length===1,'Fake must record metadata without claiming presentation');
 const captured=JSON.stringify(fake.contextMenuRequests),branch=entries[1] as Extract<LocalToolMenuEntry,{kind:'submenu'}>,nested=branch.entries[1] as Extract<LocalToolMenuEntry,{kind:'submenu'}>;
 leaf.label='After';leaf.onSelect=()=>{selected+=100;};branch.label='Changed';(nested.entries as LocalToolMenuEntry[]).push({kind:'label',label:'Late addition'});
 check(!Object.isFrozen(entries)&&!Object.isFrozen(nested.entries)&&JSON.stringify(fake.contextMenuRequests)===captured,'Recursive recorder retained or froze author descendants');
 function noLive(value:unknown){check(typeof value!=='function','Recorder retained a callback');if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){check(!['onSelect','event','currentTarget','ownerDocument','target'].includes(key),'Recorder retained live field '+key);noLive(child);}}
 noLive(fake.contextMenuRequests);const decoded=JSON.parse(captured);check(decoded[0].entries[1].entries[1].entries[0].label==='Before','Recorded grandchild metadata missing');
 const cyclic:LocalToolMenuEntry[]=[];cyclic.push({kind:'submenu',id:'recorder-cycle',label:'Cycle',entries:cyclic});check(fake.contextMenu.open(event,cyclic,{label:'Invalid'})===false&&fake.contextMenuRequests.length===1,'Invalid cycle appended a partial fake request');
 fake.contextMenu.close();check(selected===0&&JSON.stringify(fake.inspect())===before,'Recursive recorder selected or wrote memory');
 return 'Independent recursive fake: copied grandchild JSON metadata has no callbacks/event/DOM, caller descendants remain mutable, cycles record no partial request and fixture memory remains exact (not a Node-purity execution)';
}

export async function testReviewLocalToolContextSubmenus(){return[await reviewDeepValidationBeforeReplacement(),await reviewBranchLifetimesAndCallbackOrder(),await reviewSourceOwnerRevocation(),await reviewRecursiveRecording()];}
