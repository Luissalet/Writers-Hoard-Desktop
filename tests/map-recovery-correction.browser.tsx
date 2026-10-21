import '@/engines';
import '@/services/aiBridge/dispatch';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import MapView,{type PinDraft} from '@/components/maps/MapView';
import {createLocalDraftStore} from '@/hooks/localDraftStore';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';
import {readEraRow} from '@/services/worldEras/store';
import type {MapPin} from '@/types';

const assert:(v:unknown,m:string)=>asserts v=(v,m)=>{if(!v)throw Error(m);};
const accept=(v:unknown):v is PinDraft=>!!v&&typeof v==='object'&&'name'in v;
const pause=()=>new Promise(r=>setTimeout(r,30));
const channel=window as unknown as Record<string,any>;let sequence=0;
async function wait(check:()=>boolean,label:string){for(let n=0;n<300;n++){if(check())return;await act(async()=>{await pause();});}throw Error('Map recovery timeout '+label);}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n,'input');});}
async function click(node:HTMLElement){node.scrollIntoView({block:'center',behavior:'instant'});await act(async()=>{await pause();});const r=node.getBoundingClientRect();assert(r.width>0&&r.top>=0&&r.bottom<=innerHeight,'native button visible');const point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseDown',...point},{type:'mouseUp',...point}]);}
function text(node:HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));}
const pin=(projectId:string):MapPin=>({id:projectId+'-pin',projectId,mapId:projectId+'-map',name:'Harbour',description:'Original',icon:'port',position:{x:20,y:30}});
async function project(id:string){await db.projects.put({id,title:'Map recovery',mode:'custom',type:'standalone',color:'#cab57d',description:'',status:'draft',enabledEngines:['maps'],engineOrder:['maps'],createdAt:1,updatedAt:1});}
export async function testMapRecoveryCorrection(){
 const id='map-recovery-'+crypto.randomUUID(),key='wh.maps-drafts.v1.'+id,drafts=createLocalDraftStore(key,accept),row=pin(id),root=createRoot(document.getElementById('root')!);await project(id);let finish:()=>void=()=>{},calls=0;
 try{
  drafts.set(row.id,{name:'Recovered legacy',description:'Recovered without baseline',icon:'port'});
  const render=async()=>act(async()=>root.render(<MemoryRouter><MapView projectId={id} mapId={row.mapId} pins={[row]} focusPinId={row.id} drafts={drafts} onUploadBackground={()=>{}} onAddPin={()=>{}} onEditPin={async()=>{calls++;if(calls===1)await new Promise<void>(resolve=>{finish=resolve;});}} onDeletePin={()=>{}}/></MemoryRouter>));
  await render();assert(document.querySelector('textarea')?.value==='Recovered without baseline','legacy recovery not displayed');
  await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid=map-pin-save]')!.click();});
  await act(async()=>text(document.querySelector('textarea')!,'Later edit while save is pending'));
  await act(async()=>finish());
  assert(drafts.get(row.id)?.description==='Later edit while save is pending'&&document.querySelector('textarea')?.value==='Later edit while save is pending','successful prior submission erased newer draft');
  await act(async()=>{root.render(<div/>);});await render();
  assert(document.querySelector('textarea')?.value==='Later edit while save is pending','reopening lost newer pending draft');
  await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid=map-pin-save]')!.click();});
  assert(calls===2&&!drafts.has(row.id),'legacy/enriched recovered owner not retired on retry');
  return['Legacy recovery with no baseline reopens intact; successful in-flight submission retains newer text and its journal; reopened retry retires only that submitted draft'];
 }finally{await act(async()=>root.unmount());drafts.clear();await deleteProject(id);}
}
export async function testMapRecoveryNative(){
 const out:string[]=[];useLocaleStore.setState({locale:'en'});
 for(const width of[1440,640]){
  const id='map-recovery-'+crypto.randomUUID(),key='wh.maps-drafts.v1.'+id,drafts=createLocalDraftStore(key,accept),row=pin(id),root=createRoot(document.getElementById('root')!);let fail=true,last:any;
  await project(id);await db.worldMaps.put({id:row.mapId,projectId:id,title:'Recovery map',createdAt:1,updatedAt:1});await db.mapPins.put(row);
  try{
   drafts.set(row.id,{name:'Recovered harbour',description:'Offline recovered description 🧭',icon:'port'});
   const render=async()=>act(async()=>root.render(<MemoryRouter><MapView projectId={id} mapId={row.mapId} pins={[row]} focusPinId={row.id} drafts={drafts} onUploadBackground={()=>{}} onAddPin={()=>{}} onEditPin={async(pinId,changes)=>{if(fail)throw Error('own_failed_save');const result=await channel.qaNative.call('wh_update_map_pin',{projectId:id,id:pinId,name:changes.name,description:changes.description});assert(result.ok,'actual MCP update failed '+JSON.stringify(result));last=result.result;return(await db.mapPins.get(pinId))!;}} onDeletePin={()=>{}}/></MemoryRouter>));
   const n=++sequence;channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n,'size');await render();
   await click(document.querySelector('[data-testid=map-pin-save]')!);assert(!!document.querySelector('[role=alert]')&&drafts.has(row.id),'native failed save lost recovery');
   await act(async()=>root.render(<div/>));await render();fail=false;await click(document.querySelector('[data-testid=map-pin-save]')!);
   await wait(()=>!document.querySelector<HTMLButtonElement>('[data-testid=map-pin-save]')!.disabled,'save settled');
   assert(!drafts.has(row.id)&&(await db.mapPins.get(row.id))!.description==='Offline recovered description 🧭','native reopened retry did not retire owner/persist through MCP');
   const query=await channel.qaNative.call('wh_list_maps',{projectId:id});assert(query.ok&&JSON.stringify(query.result).includes('Recovered harbour'),'native MCP query missing saved correct pin');
   await wait(()=>!document.querySelector('[role=alert]')&&!document.body.textContent?.includes('Unsaved draft.'),'successful recovery rendered');
   const name='map-recovery-corrected-'+width;channel.__shot={name,forcePaint:true};await wait(()=>channel.__shotDone===name,'capture');
   assert(Number.isInteger(last._undo?.audit_index),'normal MCP audit absent');const undone=await channel.qaNative.undo(last._undo.audit_index);assert(undone.ok&&(await db.mapPins.get(row.id))!.description==='Original'&&(await db.mapPins.get(row.id))!.name==='Harbour','normal audit Undo did not restore pin name and description');
   out.push(`Native pointer ${width}px: failed save → unmount/reopen → retry commits correct pin through actual MCP, retires recovery; normal query and HTTP audit Undo restore both name and description`);
  }finally{await act(async()=>root.unmount());drafts.clear();await deleteProject(id);}
 }return out;
}
export async function testMapPinUndoFields(){
 const id='map-recovery-'+crypto.randomUUID(),row=pin(id),out:string[]=[];await project(id);
 await db.projects.update(id,{worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 await db.worldMaps.put({id:row.mapId,projectId:id,title:'Undo map',createdAt:1,updatedAt:1});await db.mapPins.put(row);
 const entry=id+'-entry';await db.codexEntries.put({id:entry,projectId:id,title:'Port',type:'location',fields:{},content:'',tags:[],relations:[],createdAt:1,updatedAt:1});
 try{
  for(const eraId of[undefined,'past']){
   const scope={projectId:id,...(eraId?{eraId}:{})};
   const changed=await channel.qaNative.call('wh_update_map_pin',{...scope,id:row.id,description:'Changed description',linkedEntryId:entry});assert(changed.ok,'update fields failed '+JSON.stringify(changed));
   const later=await channel.qaNative.call('wh_update_map_pin',{...scope,id:row.id,name:'Later independent name'});assert(later.ok,'later name update failed');
   const undone=await channel.qaNative.undo(changed.result._undo.audit_index);assert(undone.ok,'normal HTTP Undo failed '+JSON.stringify(undone));
   const actual=eraId?await readEraRow<MapPin>(scope,'mapPins',row.id):await db.mapPins.get(row.id);
   assert(actual?.description==='Original'&&actual.linkedEntryId===undefined&&actual.name==='Later independent name','Undo changed fields lost description/absent reference or overwrote later untouched name: '+JSON.stringify(actual));
   if(eraId)assert((await db.mapPins.get(row.id))!.description==='Original','era Undo leaked into Base');
   out.push(`Actual external MCP ${eraId?'named era':'Base'}: changed description and previously absent linkedEntryId restored by HTTP Undo, later untouched name survives; original Base isolated`);
  }
  return out;
 }finally{await deleteProject(id);}
}
export async function testMapPinUndoAbsent(){
 const id='map-recovery-'+crypto.randomUUID(),row=pin(id),out:string[]=[];await project(id);
 await db.projects.update(id,{worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 await db.worldMaps.put({id:row.mapId,projectId:id,title:'Legacy optional fields',createdAt:1,updatedAt:1});
 const{description:_description,...legacy}=row;void _description;await db.mapPins.put(legacy);
 try{
  for(const eraId of[undefined,'past']){
   const scope={projectId:id,...(eraId?{eraId}:{})};
   const changed=await channel.qaNative.call('wh_update_map_pin',{...scope,id:row.id,description:'Added legacy description'});assert(changed.ok,'absent-description update failed');
   const undone=await channel.qaNative.undo(changed.result._undo.audit_index);assert(undone.ok,'absent-description Undo failed');
   const actual=eraId?await readEraRow<MapPin>(scope,'mapPins',row.id):await db.mapPins.get(row.id);
   assert(actual?.description===undefined&&actual?.name==='Harbour','undefined optional description not restored');
   out.push(`Actual external MCP ${eraId?'named era':'Base'}: legacy pin without optional description returns to undefined after normal HTTP Undo`);
  }return out;
 }finally{await deleteProject(id);}
}
