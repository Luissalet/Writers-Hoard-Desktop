import * as Y from 'yjs';
import {JsonArray,JsonMap} from './json';
import type {LocalToolStateCodec} from '../stateCodecFormat';
import type {CausalTransaction,RegisterVersion,RegisterActivation} from './formatTypes';

export const SOURCE_LIST_FORMAT='writers-hoard-source-additive-list/1';
export const SOURCE_LIST_PLACEMENT_FORMAT='writers-hoard-source-list-placement/1';
export const SOURCE_LIST_AUTHORITY_ROOT='convergence-source-additive';
const invalid=():never=>{throw Error('local_tool_source_additive_history_invalid');};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v;
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
export const sourceListField=(codec:LocalToolStateCodec)=>codec.sourceDefault&&codec.fields[codec.sourceDefault.field]?.kind==='list'?codec.sourceDefault.field:undefined;
interface Witness {format:typeof SOURCE_LIST_PLACEMENT_FORMAT;field:string;txId:string;id:string;placementId:string}
interface Unit {client:number;clock:number;root:object;key:string|null;value:unknown;deleted:boolean;origin:Y.ID|null}
const point=(client:number,clock:number)=>client+':'+clock;

/** The two strings have consecutive physical clocks, even when Yjs merges/splits Items. */
export function appendSourceListPlacement(doc:Y.Doc,field:string,txId:string,id:string,placementId:string,insert:()=>void):void {
 if(![field,txId,id,placementId].every(text))return invalid();
 new JsonArray<Witness>(doc.getArray(SOURCE_LIST_AUTHORITY_ROOT)).push([{format:SOURCE_LIST_PLACEMENT_FORMAT,field,txId,id,placementId}]);
 insert();
}
function physical(doc:Y.Doc){
 const contents=new Map<Y.Item,unknown[]>();
 const values=(item:Y.Item)=>{let v=contents.get(item);if(!v){v=item.content.getContent();contents.set(item,v);}return v;};
 const unit=(item:Y.Item,offset:number):Unit=>{
  if(!(item.parent instanceof Y.AbstractType))return invalid();
  const v=values(item);if(v.length!==item.length)return invalid();
  return{client:item.id.client,clock:item.id.clock+offset,root:item.parent,key:item.parentSub,value:v[offset],deleted:item.deleted,origin:offset?Y.createID(item.id.client,item.id.clock+offset-1):item.origin};
 };
 const at=(client:number,clock:number):Unit|undefined=>{
  const structs=doc.store.clients.get(client);if(!structs)return undefined;
  let low=0,high=structs.length;
  while(low<high){const middle=(low+high)>>>1;if(structs[middle].id.clock+structs[middle].length<=clock)low=middle+1;else high=middle;}
  const item=structs[low];if(!item||item.id.clock>clock)return undefined;
  if(!(item instanceof Y.Item))return invalid();
  return unit(item,clock-item.id.clock);
 };
 const root=(type:object|undefined):Unit[]=>{
  if(!type)return[];const result:Unit[]=[];
  for(const structs of doc.store.clients.values())for(const item of structs)if(item instanceof Y.Item&&item.parent===type)for(let offset=0;offset<item.length;offset++)result.push(unit(item,offset));
  return result;
 };
 return{at,root};
}
const parse=(unit:Unit):Record<string,unknown>=>{
 if(typeof unit.value!=='string')return invalid();let v:unknown;try{v=JSON.parse(unit.value);}catch{return invalid();}
 if(!record(v))return invalid();return v;
};
/** No winning-map shortcut: retained/deleted register bodies can expose a forbidden old slot. */
export function sourceListRetainedRegisters(doc:Y.Doc):{versions:RegisterVersion[];activations:RegisterActivation[]}{
 // A GC struct no longer carries a parent/payload. A complete new-list proof cannot
 // invent its origin. Normal register/list Undo retains Items rather than deleting them.
 for(const structs of doc.store.clients.values())for(const item of structs)if(!(item instanceof Y.Item))return invalid();
 const read=physical(doc),versions:RegisterVersion[]=[],activations:RegisterActivation[]=[];
 for(const unit of read.root(doc.share.get('register-versions'))){
  const v=parse(unit);if(v.id!==unit.key||!text(v.id)||!text(v.root)||typeof v.key!=='string'||typeof v.present!=='boolean'||!text(v.txId)||!Object.hasOwn(v,'value'))return invalid();
  versions.push({id:v.id,root:v.root,key:v.key,present:v.present,value:v.value as RegisterVersion['value'],txId:v.txId});
 }
 for(const unit of read.root(doc.share.get('register-activations'))){
  const v=parse(unit);if(v.id!==unit.key||!text(v.id)||!text(v.versionId)||typeof v.enabled!=='boolean'||!text(v.txId))return invalid();
  activations.push({id:v.id,versionId:v.versionId,enabled:v.enabled,txId:v.txId});
 }
 return{versions,activations};
}
/** True means a valid physical prefix still lacks its semantic flush dependency. */
export function sourceListHistoryPending(doc:Y.Doc):boolean {
 const authority=doc.share.get(SOURCE_LIST_AUTHORITY_ROOT);if(!authority)return false;
 if(!(authority instanceof Y.Array))return invalid();
 const first=new JsonArray<{format?:string;target?:{codec?:LocalToolStateCodec};promotion?:{txId?:string}}>(authority).toArray()[0];
 if(first?.format!==SOURCE_LIST_FORMAT)return false;
 const codec=first.target?.codec;if(!codec)return invalid();const field=sourceListField(codec);if(field===undefined)return invalid();
 return inspectSourceListHistory(doc,field,first.promotion?.txId);
}
/** Definition-free placement birth proof. Ordinary lists and scalar/map authorities never call it. */
export function inspectSourceListHistory(doc:Y.Doc,field:string,promotionTxId?:string):boolean {
 const read=physical(doc),authority=doc.share.get(SOURCE_LIST_AUTHORITY_ROOT),order=doc.share.get('order:'+JSON.stringify(field));
 if(!(authority instanceof Y.Array))return invalid();
 const declarations=read.root(authority),headers=declarations.filter(unit=>parse(unit).format===SOURCE_LIST_FORMAT);
 if(headers.length!==1)return invalid();const header=headers[0];
 if(header.deleted||header.key!==null||header.origin!==null)return invalid();
 const transactions=read.root(doc.share.get('causal-transactions')),byTx=new Map<string,Unit[]>();
 for(const unit of transactions){if(unit.key===null)return invalid();const list=byTx.get(unit.key)??[];list.push(unit);byTx.set(unit.key,list);}
 const body=(id:string):Unit|undefined=>{
  const units=byTx.get(id);if(!units)return undefined;if(units.length!==1||units[0].deleted)return invalid();
  const v=parse(units[0]);if(v.id!==id||!Array.isArray(v.parents)||v.parents.some(p=>!text(p)||p===id)||new Set(v.parents).size!==v.parents.length)return invalid();return units[0];
 };
 const byClient=new Map<number,Unit[]>();
 for(const unit of transactions){const rows=byClient.get(unit.client)??[];rows.push(unit);byClient.set(unit.client,rows);}
 for(const rows of byClient.values())rows.sort((a,b)=>a.clock-b.clock);
 const nextTransaction=(client:number,clock:number):Unit|undefined=>{const rows=byClient.get(client)??[];let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle].clock<=clock)low=middle+1;else high=middle;}return rows[low];};
 const graph=new JsonMap<CausalTransaction>(doc.getMap('causal-transactions')),relations=new Map<string,boolean|undefined>();
 const relation=(id:string,seen=new Set<string>()):boolean|undefined=>{
  if(seen.has(id))return invalid();if(id===promotionTxId)return true;if(relations.has(id))return relations.get(id);
  const tx=graph.get(id);if(!tx){relations.set(id,undefined);return undefined;}
  if(tx.id!==id||!Array.isArray(tx.parents)||tx.parents.some(p=>!text(p)||p===id)||new Set(tx.parents).size!==tx.parents.length)return invalid();
  const next=new Set(seen);next.add(id);
  let missing=false,observes=false;
  for(const parent of tx.parents){const value=relation(parent,next);if(value===undefined)missing=true;else if(value)observes=true;}
  const result=missing?undefined:promotionTxId===undefined||observes;relations.set(id,result);return result;
 };
 if(promotionTxId){
  const tx=body(promotionTxId);if(!tx||tx.client!==header.client||tx.clock+1!==header.clock)return invalid();
 }
 const anchors=new Map<string,boolean>();
 const anchored=(start:Unit):boolean=>{
  const seen=new Set<string>(),path:string[]=[];let cursor:Unit|undefined=start,result=false;
  while(cursor){const id=point(cursor.client,cursor.clock);if(seen.has(id))return invalid();seen.add(id);path.push(id);
   if(cursor.deleted||cursor.root!==authority||cursor.key!==null)return invalid();
   if(cursor.client===header.client&&cursor.clock===header.clock){result=true;break;}
   if(anchors.has(id)){result=anchors.get(id)!;break;}
   if(!cursor.origin)break;cursor=read.at(cursor.origin.client,cursor.origin.clock);
  }
  for(const id of path)anchors.set(id,result);return result;
 };
 const witnesses=new Map<string,{unit:Unit;value:Witness}>();let pending=false;
 for(const unit of declarations){
  if(unit===header)continue;const v=parse(unit);
  if(unit.deleted||unit.key!==null||!exact(v,['format','field','txId','id','placementId'])||v.format!==SOURCE_LIST_PLACEMENT_FORMAT||v.field!==field||!text(v.txId)||!text(v.id)||!text(v.placementId)||!anchored(unit))return invalid();
  if(witnesses.has(v.placementId))return invalid();
  const witness:Witness={format:SOURCE_LIST_PLACEMENT_FORMAT,field,txId:v.txId,id:v.id,placementId:v.placementId};witnesses.set(v.placementId,{unit,value:witness});
  const placement=read.at(unit.client,unit.clock+1);
  if(!placement){pending=true;continue;}
  const p=parse(placement);
  if(placement.deleted||placement.root!==order||placement.key!==null||!exact(p,['id','placementId'])||p.id!==v.id||p.placementId!==v.placementId)return invalid();
  const tx=body(v.txId),next=nextTransaction(unit.client,placement.clock);
  if(next&&next.key!==v.txId)return invalid();
  if(!tx){pending=true;continue;}
  if(tx.client!==unit.client||tx.clock<=placement.clock||next!==tx||v.txId===promotionTxId)return invalid();
  const observes=relation(v.txId);if(observes===undefined)pending=true;else if(!observes)return invalid();
 }
 for(const unit of read.root(order)){
  const p=parse(unit);if(unit.deleted||unit.key!==null||!exact(p,['id','placementId'])||!text(p.id)||!text(p.placementId))return invalid();
  const witness=witnesses.get(p.placementId);
  if(!witness||witness.value.id!==p.id||witness.unit.client!==unit.client||witness.unit.clock+1!==unit.clock)return invalid();
 }
 for(const version of sourceListRetainedRegisters(doc).versions)if(version.root==='selected:'+field&&version.present){
  if(!text(version.value))return invalid();const witness=witnesses.get(version.value);
  if(!witness)pending=true;else if(witness.value.id!==version.key)return invalid();
 }
 return pending;
}

