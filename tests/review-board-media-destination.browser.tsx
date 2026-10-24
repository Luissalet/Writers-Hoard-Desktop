// Independent regression: a destination moved during effective-media admission.
// Real BoardCanvas/NodeInspector/EntityPicker and real storage read; no extracted admission helper.
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {flushPendingWrites} from '@/services/pendingWrites';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {readWorldDocument} from '@/services/worldEras/store';
import {makeNode,makeEdge} from '@/engines/board/graph/mutations';
import {updateBoardNode} from '@/engines/board/operations';
import BoardCanvas from '@/engines/board/components/BoardCanvas';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {boardMediaFixture} from './board-media.browser';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=40)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function until(check:()=>unknown,message:string){for(let i=0;i<200;i++){if(await check())return;await act(async()=>{await pause();});}throw Error(message);}
function stable(value:unknown):string{
 const walk=(v:unknown):unknown=>v===undefined?['undefined']:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(walk):Object.fromEntries(Object.keys(v).sort().map(key=>[key,walk((v as Record<string,unknown>)[key])]));
 return JSON.stringify(walk(value));
}
async function capture(projectId:string,boardId:string){
 const read=await readWorldDocument({projectId},'board',boardId);assert(read,'Fixture Board missing');
 const body=structuredClone(read.document);delete body.root.updatedAt;
 for(const table of ['boardNodes','boardEdges'])for(const row of body.children[table]??[])delete row.updatedAt;
 return{version:read.version,raw:stable(read.document),authored:stable(body)};
}
async function click(element:HTMLElement|null,message:string){assert(element,message);await act(async()=>{element.click();await pause();});}

async function scenario(retarget:boolean){
 const f=await boardMediaFixture(retarget?'review-destination-hidden':'review-destination-control');
 const root=createRoot(document.getElementById('root')!);
 const table=Object.getPrototypeOf(db.table('localMediaAssets')) as{get:(this:{name:string},key:string)=>Promise<unknown>};
 const original=table.get;let entered=false,release=()=>{};
 const a=f.boardId+'-A',b=f.boardId+'-B';
 const node={...makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Original node title',position:{x:100,y:100},size:{width:320,height:240},layerId:a,ref:f.ref()}),content:'Original caption stays'};
 const peer=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'card',title:'Related untouched node',position:{x:500,y:100}});
 try{
  useLocaleStore.setState({locale:'en',loaded:true});
  await db.boardLayers.bulkAdd([{id:a,projectId:f.projectId,boardId:f.boardId,name:'Visible A',color:'#aa8866',order:0,visible:true,locked:false,opacity:1},{id:b,projectId:f.projectId,boardId:f.boardId,name:'Hidden B',color:'#6688aa',order:1,visible:false,locked:false,opacity:1}]);
  await db.boardNodes.bulkAdd([node,peer]);await db.boardEdges.add(makeEdge({projectId:f.projectId,boardId:f.boardId,sources:[{on:'node',id:node.id}],targets:[{on:'node',id:peer.id}],label:'Preserve relation'}));
  await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:f.projectId,projectId:f.projectId,visible:true,navigate:()=>{}}}><BoardCanvas projectId={f.projectId} board={f.board} onViewportChange={()=>{}}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
  await until(()=>document.querySelector(`[data-id="${node.id}"] audio[controls]`),'Initial real media node did not mount');
  const target=document.querySelector<HTMLElement>(`[data-id="${node.id}"]`)!;
  // Normal node context-menu selection opens this node's actual Inspector.
  await act(async()=>{const box=target.getBoundingClientRect();target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:box.left+15,clientY:box.top+15}));await pause();});
  const reference=()=>[...document.querySelectorAll<HTMLButtonElement>('aside button')].find(button=>button.textContent===`${node.ref!.entityType} · ${node.ref!.title}`)??null;
  await until(reference,'Selected node Reference(E) Inspector button absent');
  await click(reference(),'Real Reference(E) button absent');
  await until(()=>document.querySelector('[role="dialog"] input'),'EntityPicker did not open for existing node');
  const input=document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,f.video.title);input.dispatchEvent(new Event('input',{bubbles:true}));await pause();});
  const choice=()=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button=>button.textContent?.includes(f.video.title))??null;
  await until(choice,'Normal EntityPicker did not find replacement media');
  const before=await capture(f.projectId,f.boardId);
  const undo=()=>document.querySelector<HTMLButtonElement>('[data-testid="board-undo"]');
  assert(undo()?.disabled,'Fixture already has a UI journal entry before acquisition');
  const gate=new Promise<void>(resolve=>{release=resolve;});
  table.get=async function(key){if(this.name==='localMediaAssets'&&key===f.video.id){entered=true;await gate;}return original.call(this,key);};
  await click(choice(),'Replacement choice vanished');await until(()=>entered,'Replacement did not enter retained real effective storage read');
  let winner=before;
  if(retarget){
   // Public store move, then a genuine external tool edit announces committed state.
   // No fake graph/state callback or synthetic data-changed event: the normal bridge emits it.
   await updateBoardNode(node.id,{layerId:b});
   const renamed=await runBridgeTool('wh_update_board_card',{projectId:f.projectId,id:node.id,title:'Concurrent destination winner'});
   assert(renamed.ok,'Concurrent normal board edit failed: '+JSON.stringify(renamed));
   await until(()=>!document.querySelector(`[data-id="${node.id}"]`),'Mounted graph did not reflect concurrent hidden destination layer');
   const select=document.querySelector<HTMLSelectElement>('aside select');
   assert(select?.value===b,'Inspector did not confirm actual destination layer B');
   assert(document.querySelector('[role="dialog"]'),'Concurrent move canceled picker before admission could be observed');
   winner=await capture(f.projectId,f.boardId);
   assert(winner.raw!==before.raw&&undo()?.disabled,'Concurrent winner missing or fabricated a local UI journal entry');
  }
  release();
  await until(()=>!document.querySelector('[role="dialog"]')||document.querySelector('[role="alert"]'),'Retained acquisition did not settle');
  await act(async()=>{await flushPendingWrites();await pause(120);});table.get=original;
  if(retarget){
   const after=await capture(f.projectId,f.boardId),actual=await db.boardNodes.get(node.id);
   assert(after.version===winner.version&&after.raw===winner.raw,'Late Reference overwrote concurrent hidden-layer winner: '+JSON.stringify({expectedRef:node.ref!.entityId,actualRef:actual?.ref?.entityId,expectedLayer:b,actualLayer:actual?.layerId,beforeVersion:winner.version,afterVersion:after.version}));
   assert(undo()?.disabled,'Rejected late Reference created a UI journal entry');
   return 'Real Reference(E) rejects hidden-layer destination retarget after retained storage read; exact concurrent winner/ref/caption/relations/version and empty local journal preserved';
  }
  await until(()=>document.querySelector(`[data-id="${node.id}"] video[controls]`),'Stable-layer positive control did not mount replacement');
  assert((await db.boardNodes.get(node.id))?.ref?.entityId===f.video.id&&!undo()?.disabled,'Stable-layer Reference did not persist via real journal');
  await click(undo(),'Normal Undo button absent');await act(async()=>{await flushPendingWrites();await pause();});
  await until(()=>document.querySelector(`[data-id="${node.id}"] audio[controls]`),'Normal UI Undo did not restore original media');
  assert((await capture(f.projectId,f.boardId)).authored===before.authored,'Stable-layer Reference/Undo failed to restore authored body/caption/relations');
  return 'Same-layer real Inspector Reference(E) admits owned media and normal UI Undo restores original authored graph';
 }finally{release();table.get=original;await act(async()=>{root.unmount();await pause();});await flushPendingWrites();await f.cleanup();}
}

export async function testReviewBoardMediaDestination(){return[await scenario(false),await scenario(true)];}
