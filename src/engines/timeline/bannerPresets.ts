import Dexie,{type Transaction} from 'dexie';
import {db} from '@/db';
import type {Timeline,TimelineEvent} from '@/types';
import {announceEraChange,listWorldDocuments,readWorldDocument,saveEraDocument} from '@/services/worldEras/store';
import type {WorldEraScope,EraDocument,EraDocumentRead,EraRow} from '@/services/worldEras/types';
import {resolveWorldCalendar} from './worldCalendarStore';
import {timelineEventLabel,validateEventClock} from './eventClock';
import {validateWorldRange} from './worldCalendar';
import {normalizeBannerStyle,resolveBannerStyle,bannerStyleFields,type BannerPreset,type BannerTarget,type BannerAction} from './bannerStyles';
import {canonicalJson} from '@/services/aiRuntime/recipe';
const same=(a:unknown,b:unknown)=>canonicalJson(a??null)===canonicalJson(b??null);
interface FieldChange {timelineId:string;eventId?:string;presetId?:string;catalogPresent?:boolean;before:Record<string,unknown>|null;after:Record<string,unknown>|null}
interface Receipt {scope:WorldEraScope;changes:FieldChange[];claimed?:Transaction}
const receipts=new Map<string,Receipt>();
function clean<T>(value:T):T {if(!value||typeof value!=='object'||Array.isArray(value))return value;return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined)) as T;}
const rows=(read:EraDocumentRead)=>read.document.children.timelineEvents??[];
function patch(row:EraRow,fields:Record<string,unknown>|null){for(const[k,v]of Object.entries(fields??{})){if(v===undefined)delete row[k];else row[k]=structuredClone(v);}}
function required(read:EraDocumentRead|undefined):EraDocumentRead {if(!read)throw Error('banner_timeline_missing');return read;}
function check(read:EraDocumentRead,expected:string|undefined){if(typeof expected!=='string'||read.version!==expected)throw Error('banner_conflict');}
async function reads(scope:WorldEraScope){return listWorldDocuments(scope,'timeline');}
export async function readBannerCatalog(scope:WorldEraScope,timelineId:string){
 return db.transaction('r',db.tables,async()=>{const read=required(await readWorldDocument(scope,'timeline',timelineId));return {timelineId,version:read.version,presets:structuredClone((read.document.root as unknown as Timeline).bannerPresets??[])};});
}
export async function bannerContext(scope:WorldEraScope){
 return db.transaction('r',db.tables,async()=>{const all=await reads(scope);return {targets:all.map(r=>({timelineId:r.document.root.id,version:r.version})),timelines:all.map(r=>r.document.root as unknown as Timeline)};});
}
async function persist(scope:WorldEraScope,read:EraDocumentRead,document:EraDocument){
 if(scope.eraId){await saveEraDocument(scope,'timeline',document,read.version);return;}
 const old=read.document,next=document;
 if(!same(old.root,next.root))await db.timelines.put(next.root as unknown as Timeline);
 const oldRows=new Map((old.children.timelineEvents??[]).map(r=>[r.id,r]));
 for(const row of next.children.timelineEvents??[])if(!same(oldRows.get(row.id),row))await db.timelineEvents.put(clean(row) as unknown as TimelineEvent);
 const kept=new Set(next.children.timelineEvents?.map(r=>r.id));
 for(const id of oldRows.keys())if(!kept.has(id))await db.timelineEvents.delete(id);
}
function publish(scope:WorldEraScope,changes:FieldChange[]){
 const receiptId=crypto.randomUUID(),receipt={scope:{...scope},changes:structuredClone(changes)};let outer=Dexie.currentTransaction;
 if(outer){while(outer.parent)outer=outer.parent;outer.on('complete',()=>receipts.set(receiptId,receipt));}else receipts.set(receiptId,receipt);
 announceEraChange(scope.projectId);return receiptId;
}
export async function setBannerPreset(scope:WorldEraScope,timelineId:string,expectedVersion:string,action:'upsert'|'archive'|'restore',presetId:string,name?:string,style?:unknown){
 if(!presetId||!['upsert','archive','restore'].includes(action))throw Error('banner_preset_invalid');
 const normalized=action==='upsert'?normalizeBannerStyle(style):undefined;
 if(action==='upsert'&&(!name||!name.trim()))throw Error('banner_name_required');
 const changes=await db.transaction('rw',db.tables,async()=>{
  const read=required(await readWorldDocument(scope,'timeline',timelineId));check(read,expectedVersion);
  const document=structuredClone(read.document),root=document.root as unknown as Timeline,catalog=root.bannerPresets??[],current=catalog.find(p=>p.id===presetId);
  if(action!=='upsert'&&!current)throw Error('banner_preset_missing');
  const next:BannerPreset=action==='upsert'?{...current,id:presetId,name:name!.trim(),style:normalized!}:{...current!,...(action==='archive'?{archivedAt:Date.now()}:{})};
  if(action==='restore')delete next.archivedAt;
  root.bannerPresets=current?catalog.map(p=>p.id===presetId?next:p):[...catalog,next];root.updatedAt=Math.max(Date.now(),root.updatedAt+1);
  await persist(scope,read,document);
  return [{timelineId,presetId,catalogPresent:'bannerPresets' in read.document.root,before:current?structuredClone(current) as unknown as Record<string,unknown>:null,after:structuredClone(next) as unknown as Record<string,unknown>}];
 });
 return {receiptId:publish(scope,changes),...(await readBannerCatalog(scope,timelineId))};
}
export interface BannerEventWrite {event:TimelineEvent;baseline?:TimelineEvent;targets:BannerTarget[];action?:BannerAction;create?:boolean;position?:number;overrides?:Partial<TimelineEvent>}
/** Catalog-dependent edits and cross-lane linked moves share one transaction. */
export async function writeBannerEvent(scope:WorldEraScope,input:BannerEventWrite){
 const changes=await db.transaction('rw',db.tables,async()=>{
  const all=await reads(scope),byId=new Map(all.map(r=>[r.document.root.id,r]));
  const oldRead=all.find(r=>rows(r).some(e=>e.id===input.event.id)),current=oldRead&&rows(oldRead).find(e=>e.id===input.event.id) as unknown as TimelineEvent|undefined;
  if(input.create?!!current:!current)throw Error('banner_event_conflict');
  if(current&&input.baseline&&!same(current,Object.fromEntries(Object.keys(current).map(k=>[k,(input.baseline as unknown as Record<string,unknown>)[k]]))))throw Error('banner_conflict');
  if(input.event.projectId!==scope.projectId)throw Error('banner_project_mismatch');
  const next=clean(structuredClone(input.event)),destination=required(byId.get(next.timelineId)),source=oldRead??destination;
  const checkTarget=(r:EraDocumentRead)=>check(r,input.targets.find(t=>t.timelineId===r.document.root.id)?.version);
  checkTarget(source);if(destination!==source)checkTarget(destination);
  const timelines=all.map(r=>r.document.root as unknown as Timeline),action=input.action;
  if(action&&!['live','copy','manual'].includes(action.mode))throw Error('banner_action_invalid');
  if(action?.mode==='live'){
   const owner=required(byId.get(action.ownerTimelineId??''));checkTarget(owner);
   const preset=(owner.document.root as unknown as Timeline).bannerPresets?.find(p=>p.id===action.presetId);
   if(!preset)throw Error('banner_preset_missing');
   if(action.colorMode!==undefined&&!['event','preset'].includes(action.colorMode))throw Error('banner_color_mode_invalid');
   next.bannerPreset={ownerTimelineId:owner.document.root.id,id:preset.id,fallback:normalizeBannerStyle(preset.style),...(action.colorMode?{colorMode:action.colorMode}:{})};
  }else if(action?.mode==='manual'){delete next.bannerPreset;}
  else if(action?.mode==='copy'){
   if(action.presetId){const owner=required(byId.get(action.ownerTimelineId??''));checkTarget(owner);const preset=(owner.document.root as unknown as Timeline).bannerPresets?.find(p=>p.id===action.presetId);if(!preset)throw Error('banner_preset_missing');next.bannerPreset={ownerTimelineId:owner.document.root.id,id:preset.id,fallback:normalizeBannerStyle(preset.style),colorMode:action.colorMode};}
   if(next.bannerPreset){const owner=byId.get(next.bannerPreset.ownerTimelineId);if(owner)checkTarget(owner);Object.assign(next,bannerStyleFields(resolveBannerStyle(next,timelines).style));delete next.bannerPreset;}
   if(input.overrides)Object.assign(next,input.overrides);
  }
  for(const key of Object.keys(next))if((next as unknown as Record<string,unknown>)[key]===undefined)delete (next as unknown as Record<string,unknown>)[key];
  const moved=!!current&&current.timelineId!==next.timelineId;
  if(moved&&next.bannerPreset){const owner=byId.get(next.bannerPreset.ownerTimelineId),preset=(owner?.document.root as unknown as Timeline|undefined)?.bannerPresets?.find(p=>p.id===next.bannerPreset!.id);if(preset)next.bannerPreset={...next.bannerPreset,fallback:normalizeBannerStyle(preset.style)};}
  if(next.dateMode==='world'){
   const calendar=(await resolveWorldCalendar(scope.projectId,next.timelineId,scope.eraId))?.calendar;
   if(!calendar||!next.worldDate||validateWorldRange(calendar,next.worldDate,next.worldDateEnd)||validateEventClock(next,calendar))throw Error('banner_destination_calendar_invalid');
   next.date=timelineEventLabel(next,calendar);
  }
  next.updatedAt=Math.max(Date.now(),Number(current?.updatedAt??0)+1);
  const docs=new Map<string,EraDocument>(),touch=(r:EraDocumentRead)=>{let d=docs.get(r.document.root.id);if(!d){d=structuredClone(r.document);docs.set(r.document.root.id,d);}return d;};
  const diff:FieldChange[]=[];
  if(moved){const d=touch(source);d.children.timelineEvents=(d.children.timelineEvents??[]).filter(e=>e.id!==next.id);}
  const dest=touch(destination),existingRows=dest.children.timelineEvents??[];
  if(moved){
   const ordered=existingRows.filter(e=>e.id!==next.id).sort((a,b)=>Number(a.order)-Number(b.order)||a.id.localeCompare(b.id));ordered.splice(Math.max(0,Math.min(ordered.length,input.position??next.order)),0,next as unknown as EraRow);
   ordered.forEach((row,index)=>{if(row.id===next.id){next.order=index;return;}if(row.order!==index){diff.push({timelineId:next.timelineId,eventId:row.id,before:{order:row.order},after:{order:index}});row.order=index;}});
   dest.children.timelineEvents=ordered;
  }else dest.children.timelineEvents=current?existingRows.map(e=>e.id===next.id?next as unknown as EraRow:e):[...existingRows,next as unknown as EraRow];
  const keys=current?[...new Set([...Object.keys(current),...Object.keys(next)])].filter(k=>k!=='updatedAt'&&!same((current as unknown as Record<string,unknown>)[k],(next as unknown as Record<string,unknown>)[k])):[];
  diff.push({timelineId:source.document.root.id,eventId:next.id,before:current?Object.fromEntries(keys.map(k=>[k,(current as unknown as Record<string,unknown>)[k]])):null,after:current?Object.fromEntries(keys.map(k=>[k,(next as unknown as Record<string,unknown>)[k]])):structuredClone(next) as unknown as Record<string,unknown>});
  // For a move the receipt must explicitly carry its post-parent even if no other field differs.
  for(const[id,document]of docs){document.root.updatedAt=Math.max(Date.now(),Number(document.root.updatedAt??0)+1);await persist(scope,byId.get(id)!,document);}
  return diff;
 });
 return {id:input.event.id,receiptId:publish(scope,changes)};
}
function refers(value:unknown,owner:string,id:string):boolean {
 if(Array.isArray(value))return value.some(v=>refers(v,owner,id));
 if(!value||typeof value!=='object'||value instanceof Blob)return false;
 const obj=value as Record<string,unknown>;if(obj.ownerTimelineId===owner&&obj.id===id)return true;return Object.values(obj).some(v=>refers(v,owner,id));
}
export async function undoBannerChange(scope:WorldEraScope,receiptId:string){
 const receipt=receipts.get(receiptId);if(!receipt||receipt.scope.projectId!==scope.projectId||receipt.scope.eraId!==scope.eraId)throw Error('banner_receipt_missing');
 await db.transaction('rw',db.tables,async tx=>{
  if(receipt.claimed||receipts.get(receiptId)!==receipt)throw Error('banner_receipt_missing');
  let outer:Transaction=tx;while(outer.parent)outer=outer.parent;receipt.claimed=outer;outer.on('abort',()=>{receipt.claimed=undefined;});outer.on('complete',()=>receipts.delete(receiptId));
  const all=await reads(scope),byId=new Map(all.map(r=>[r.document.root.id,r])),docs=new Map<string,EraDocument>();
  const touch=(id:string)=>{let d=docs.get(id);if(!d){d=structuredClone(required(byId.get(id)).document);docs.set(id,d);}return d;};
  for(const change of receipt.changes){
   if(change.presetId){
    const d=touch(change.timelineId),catalog=(d.root as unknown as Timeline).bannerPresets??[],current=catalog.find(p=>p.id===change.presetId);
    if(!same(current,change.after))throw Error('banner_undo_stale');
    if(!change.before){for(const table of ['timelineEvents','worldEraVariants','documentArchives','documentHistory']){const source=db.tables.find(t=>t.name===table);if(source)for(const row of await source.where('projectId').equals(scope.projectId).toArray())if(refers(row,change.timelineId,change.presetId))throw Error('banner_has_later_work');}}
    const next=change.before?catalog.map(p=>p.id===change.presetId?structuredClone(change.before) as unknown as BannerPreset:p):catalog.filter(p=>p.id!==change.presetId);
    if(next.length||change.catalogPresent)(d.root as unknown as Timeline).bannerPresets=next;else delete d.root.bannerPresets;
   }else if(change.eventId){
    const read=all.find(r=>rows(r).some(e=>e.id===change.eventId)),row=read&&rows(read).find(e=>e.id===change.eventId);
    if(!row)throw Error('banner_undo_stale');
    if(change.before===null){if(!same(row,change.after)||all.some(r=>r.document.children.timelineConnections?.some(c=>c.sourceEventId===row.id||c.targetEventId===row.id)))throw Error('banner_undo_stale');const d=touch(read!.document.root.id);d.children.timelineEvents=d.children.timelineEvents!.filter(e=>e.id!==change.eventId);continue;}
    if(Object.entries(change.after??{}).some(([k,v])=>!same(row[k],v)))throw Error('banner_undo_stale');
    const restored=structuredClone(row);patch(restored,change.before);restored.updatedAt=Math.max(Date.now(),Number(row.updatedAt??0)+1);
    const from=touch(read!.document.root.id),to=touch(String(restored.timelineId));from.children.timelineEvents=from.children.timelineEvents!.filter(e=>e.id!==row.id);to.children.timelineEvents=[...(to.children.timelineEvents??[]).filter(e=>e.id!==row.id),restored];
   }
  }
  for(const[id,document]of docs){document.root.updatedAt=Math.max(Date.now(),Number(document.root.updatedAt??0)+1);await persist(scope,byId.get(id)!,document);}
 });announceEraChange(scope.projectId);return {restored:true};
}
