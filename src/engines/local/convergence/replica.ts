import * as Y from 'yjs';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState,type LocalToolStateCodec} from '../stateCodec';
import {mergeLocalToolActions,localToolStateEqual,type LocalToolStateAction} from '../stateActions';
import {assertConvergenceIdentity,convergenceBase64,convergenceBytes,convergenceCanonical,convergenceHash,convergenceIdentity,convergenceIdentityOf,convergenceClone,validateConvergenceMetadata,validateLocalToolConvergenceCheckpoint,validateLocalToolConvergenceUpdate,validateLocalToolConvergenceReceipt} from './format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceContract,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,LocalToolConvergenceUpdate,LocalToolConvergenceView,LocalToolReplicaOptions,LocalToolReplica,LocalToolReplicaEdit,LocalToolConvergenceChange,LocalToolConvergenceReceipt,LocalToolConvergencePreparation} from './types';

type ObjectData=Record<string,LocalToolJson>;
type Binding={id:string;placementId:string};
type Bindings=Record<string,Binding[]>;
type Placement={id:string;placementId:string};
type ValidView={data:LocalToolJson;bindings:Bindings};
type ReadyAction=LocalToolStateAction&{placementId?:string;anchorPlacement?:string|null};
const clone=<T>(value:T):T=>convergenceClone(value);
const binding=(bindings:Binding[],id:string)=>bindings.find(value=>value.id===id)?.placementId;
const bind=(bindings:Binding[],id:string,placementId:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at<0)bindings.push({id,placementId});else bindings[at]={id,placementId};};
const unbind=(bindings:Binding[],id:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at>=0)bindings.splice(at,1);};
const object=(value:unknown):value is ObjectData=>!!value&&typeof value==='object'&&!Array.isArray(value);
const listFields=(codec:LocalToolStateCodec)=>Object.entries(codec.fields).filter(([,field])=>field.kind==='list');
/** JSON text protects opaque UTF-16 strings from the engine's UTF-8 Any encoding. */
class JsonMap<T>{
 constructor(inner:Y.Map<string>){this.inner=inner;}
 readonly inner:Y.Map<string>;
 get(key:string):T|undefined{const text=this.inner.get(key);if(text===undefined)return undefined;if(typeof text!=='string')throw Error('local_tool_convergence_json_invalid');return JSON.parse(text) as T;}
 has(key:string){return this.inner.has(key);}
 set(key:string,value:T){this.inner.set(key,JSON.stringify(value));}
 keys(){return this.inner.keys();}
 *values():IterableIterator<T>{for(const key of this.keys())yield this.get(key)!;}
 *[Symbol.iterator]():IterableIterator<[string,T]>{for(const key of this.keys())yield[key,this.get(key)!];}
 observe(callback:()=>void){this.inner.observe(callback);}
}
class JsonArray<T>{
 constructor(inner:Y.Array<string>){this.inner=inner;}
 readonly inner:Y.Array<string>;
 toArray():T[]{return this.inner.toArray().map(text=>{if(typeof text!=='string')throw Error('local_tool_convergence_json_invalid');return JSON.parse(text) as T;});}
 insert(index:number,values:T[]){this.inner.insert(index,values.map(value=>JSON.stringify(value)));}
 push(values:T[]){this.inner.push(values.map(value=>JSON.stringify(value)));}
}
const order=(doc:Y.Doc,field:string)=>new JsonArray<Placement>(doc.getArray<string>('order:'+JSON.stringify(field)));
interface CausalTransaction {id:string;parents:string[]}
interface RegisterVersion {id:string;root:string;key:string;present:boolean;value:LocalToolJson;txId:string}
interface RegisterActivation {id:string;versionId:string;enabled:boolean;txId:string}
interface Toggle {id:string;enabled:boolean}
class Registers {
 readonly transactions:JsonMap<CausalTransaction>;
 readonly versions:JsonMap<RegisterVersion>;
 readonly activations:JsonMap<RegisterActivation>;
 private groups:Map<string,RegisterVersion[]>|null=null;
 private activationGroups:Map<string,RegisterActivation[]>|null=null;
 private completeMemo=new Map<string,boolean|null>();
 private ancestorMemo=new Map<string,Set<string>>();
 private context:{id:string;parents:string[];writes:Map<string,RegisterVersion>}|null=null;
 constructor(doc:Y.Doc){
  this.doc=doc;
  this.transactions=new JsonMap(doc.getMap('causal-transactions'));this.versions=new JsonMap(doc.getMap('register-versions'));this.activations=new JsonMap(doc.getMap('register-activations'));
  this.transactions.observe(()=>this.invalidate());this.versions.observe(()=>this.invalidate());this.activations.observe(()=>this.invalidate());
 }
 readonly doc:Y.Doc;
 private invalidate(){this.groups=null;this.activationGroups=null;this.completeMemo.clear();this.ancestorMemo.clear();}
 entries(root:string,key?:string):RegisterVersion[]{
  if(!this.groups){this.groups=new Map();for(const version of this.versions.values()){const group=convergenceCanonical([version.root,version.key]);const values=this.groups.get(group)??[];values.push(version);this.groups.set(group,values);}}
  return key===undefined?[...this.groups.values()].flat().filter(version=>version.root===root):this.groups.get(convergenceCanonical([root,key]))??[];
 }
 complete(txId:string):boolean {
  if(this.completeMemo.has(txId))return this.completeMemo.get(txId)===true;
  const tx=this.transactions.get(txId);if(!tx)return false;this.completeMemo.set(txId,null);
  const complete=tx.parents.every(parent=>this.complete(parent));this.completeMemo.set(txId,complete);return complete;
 }
 ancestors(txId:string,visiting=new Set<string>()):Set<string> {
  const cached=this.ancestorMemo.get(txId);if(cached)return cached;if(visiting.has(txId))throw Error('local_tool_convergence_transaction_cycle');
  const all=new Set<string>(),next=new Set(visiting);next.add(txId);
  for(const parent of this.transactions.get(txId)?.parents??[]){all.add(parent);for(const ancestor of this.ancestors(parent,next))all.add(ancestor);}
  this.ancestorMemo.set(txId,all);return all;
 }
 private maximum<T extends {id:string;txId:string}>(values:T[]):T|undefined {
  let chosen:T|undefined;
  for(const value of values){if(values.some(other=>other.txId!==value.txId&&this.ancestors(other.txId).has(value.txId)))continue;if(!chosen||value.id>chosen.id)chosen=value;}
  return chosen;
 }
 activation(versionId:string):RegisterActivation|undefined {
  if(!this.activationGroups){this.activationGroups=new Map();for(const activation of this.activations.values()){const values=this.activationGroups.get(activation.versionId)??[];values.push(activation);this.activationGroups.set(activation.versionId,values);}}
  return this.maximum((this.activationGroups.get(versionId)??[]).filter(activation=>this.complete(activation.txId)));
 }
 winner(root:string,key:string,eligible?:(version:RegisterVersion)=>boolean,includePending=true):RegisterVersion|undefined {
  const staged=includePending?this.context?.writes.get(convergenceCanonical([root,key])):undefined;if(staged&&(!eligible||eligible(staged)))return staged;
  return this.maximum(this.entries(root,key).filter(version=>this.complete(version.txId)&&this.activation(version.id)?.enabled===true&&(!eligible||eligible(version))));
 }
 private heads():string[]{const heads=new Set(this.transactions.keys());for(const tx of this.transactions.values())for(const parent of tx.parents)heads.delete(parent);return [...heads];}
 begin():void {if(this.context)throw Error('local_tool_convergence_transaction_nested');this.context={id:crypto.randomUUID(),parents:this.heads(),writes:new Map()};}
 cancel():void {this.context=null;}
 flush():string[]{
  const context=this.context;if(!context)throw Error('local_tool_convergence_transaction_missing');this.context=null;
  if(!context.writes.size)return[];this.transactions.set(context.id,{id:context.id,parents:context.parents});const ids:string[]=[];
  for(const version of context.writes.values()){this.versions.set(version.id,version);const activationId=crypto.randomUUID();this.activations.set(activationId,{id:activationId,versionId:version.id,enabled:true,txId:context.id});ids.push(version.id);}
  this.invalidate();return ids;
 }
 write(root:string,key:string,present:boolean,value:LocalToolJson=null):void {
  if(!this.context)throw Error('local_tool_convergence_transaction_missing');
  const group=convergenceCanonical([root,key]),before=this.winner(root,key,undefined,false);
  if(before&&before.present===present&&(!present||localToolStateEqual(before.value,value))){this.context.writes.delete(group);return;}
  if(!before&&!present){this.context.writes.delete(group);return;}
  const previous=this.context.writes.get(group),id=previous?.id??crypto.randomUUID();
  this.context.writes.set(group,{id,root,key,present,value:present?clone(value):null,txId:this.context.id});
 }
 toggle(changes:readonly Toggle[]):Toggle[]{
  if(this.context)throw Error('local_tool_convergence_transaction_nested');const effective:Toggle[]=[],inverse:Toggle[]=[];
  for(const change of changes){if(!this.versions.has(change.id))throw Error('local_tool_convergence_receipt_unavailable');const enabled=this.activation(change.id)?.enabled??false;
   if(enabled!==change.enabled){effective.push(clone(change));inverse.push({id:change.id,enabled});}
  }
  if(!effective.length)return[];const txId=crypto.randomUUID(),parents=this.heads();this.transactions.set(txId,{id:txId,parents});
  for(const change of effective){const id=crypto.randomUUID();this.activations.set(id,{id,versionId:change.id,enabled:change.enabled,txId});}this.invalidate();return inverse;
 }
 map<T>(root:string){
  function* iterate(registers:Registers):IterableIterator<[string,T]>{const keys=new Set([...registers.entries(root).map(version=>version.key),...[...(registers.context?.writes.values()??[])].filter(version=>version.root===root).map(version=>version.key)]);for(const key of keys){const version=registers.winner(root,key);if(version?.present)yield[key,clone(version.value) as T];}}
  return{
  get:(key:string):T|undefined=>{const version=this.winner(root,key);return version?.present?clone(version.value) as T:undefined;},
  set:(key:string,value:T)=>{this.write(root,key,true,value as LocalToolJson);},
  delete:(key:string)=>{this.write(root,key,false);},
  [Symbol.iterator]:()=>iterate(this),
 };}
 pending():boolean {
  return [...this.transactions.keys()].some(id=>!this.complete(id))||[...this.versions.values()].some(version=>!this.complete(version.txId)||!this.activation(version.id))||[...this.activations.values()].some(activation=>!this.versions.has(activation.versionId)||!this.complete(activation.txId));
 }
 validate():void {
  for(const[id,tx]of this.transactions){if(!tx||tx.id!==id||!Array.isArray(tx.parents)||tx.parents.some(parent=>typeof parent!=='string'||parent===id)||new Set(tx.parents).size!==tx.parents.length)throw Error('local_tool_convergence_transaction_invalid');this.ancestors(id);}
  for(const[id,version]of this.versions){if(!version||version.id!==id||typeof version.root!=='string'||typeof version.key!=='string'||typeof version.present!=='boolean'||typeof version.txId!=='string')throw Error('local_tool_convergence_register_invalid');convergenceClone(version);}
  for(const[id,activation]of this.activations)if(!activation||activation.id!==id||typeof activation.versionId!=='string'||typeof activation.enabled!=='boolean'||typeof activation.txId!=='string')throw Error('local_tool_convergence_activation_invalid');
 }
}
const roots=(doc:Y.Doc,codec:LocalToolStateCodec)=>{
 const registers=new Registers(doc);
 return{registers,scalar:registers.map<LocalToolJson>('scalar'),presence:registers.map<boolean>('presence'),valid:registers.map<ValidView>('authored-valid-snapshot'),
 map:(field:string)=>registers.map<LocalToolJson>('map:'+field),
 list:(field:string)=>({content:registers.map<ObjectData>('content:'+field),membership:registers.map<boolean>('membership:'+field),selected:registers.map<string>('selected:'+field),order:order(doc,field)}),codec};
};
type Roots=ReturnType<typeof roots>;
function initializeRoots(doc:Y.Doc,codec:LocalToolStateCodec):Roots {
 const r=roots(doc,codec);for(const[field,descriptor]of Object.entries(codec.fields)){if(descriptor.kind==='list')r.list(field);}return r;
}
function projection(r:Roots):ValidView {
 const data:ObjectData={},bindings:Bindings={};
 for(const[field,value]of r.scalar)data[field]=clone(value);
 for(const[field,descriptor]of Object.entries(r.codec.fields)){
  if(descriptor.kind==='map'){
   delete data[field];if(r.presence.get(field))data[field]=Object.fromEntries([...r.map(field)].map(([key,value])=>[key,clone(value)]));
  }else if(descriptor.kind==='list'){
   delete data[field];if(!r.presence.get(field))continue;
   const list=r.list(field),items:ObjectData[]=[],anchors:Binding[]=[],order=list.order.toArray(),known=new Set(order.map(place=>place.placementId));
   for(const place of order)if(list.membership.get(place.id)===true&&r.registers.winner('selected:'+field,place.id,version=>!version.present||known.has(version.value as string))?.value===place.placementId){
    const item=list.content.get(place.id);if(!item||item[descriptor.idKey]!==place.id)throw Error('local_tool_convergence_list_invalid');
    items.push(clone(item));bind(anchors,place.id,place.placementId);
   }
   data[field]=items;bindings[field]=anchors;
  }
 }
 return{data,bindings};
}
function checkBindings(r:Roots,view:ValidView):void {
 if(!object(view.data)||!object(view.bindings))throw Error('local_tool_convergence_bindings_invalid');
 for(const[field,descriptor]of listFields(r.codec)){
  if(descriptor.kind!=='list')continue;const rows=view.data[field];
  if(rows===undefined){if(Object.hasOwn(view.bindings,field))throw Error('local_tool_convergence_bindings_invalid');continue;}
  const bindings=view.bindings[field],placements=new Map(r.list(field).order.toArray().map(place=>[place.placementId,place.id]));
  if(!Array.isArray(rows)||!Array.isArray(bindings)||bindings.length!==rows.length||new Set(bindings.map(value=>value.id)).size!==bindings.length)throw Error('local_tool_convergence_bindings_invalid');
  for(const row of rows){const id=(row as ObjectData)[descriptor.idKey] as string;const place=binding(bindings,id);if(typeof place!=='string'||placements.get(place)!==id)throw Error('local_tool_convergence_bindings_invalid');}
 }
 if(Object.keys(view.bindings).some(field=>r.codec.fields[field]?.kind!=='list'))throw Error('local_tool_convergence_bindings_invalid');
}
function contractCopy<T extends LocalToolJson>(contract:LocalToolConvergenceContract<T>):LocalToolConvergenceContract<T> {
 validateConvergenceMetadata(contract);if(typeof contract.validateState!=='function')throw Error('local_tool_convergence_validator_required');
 return{namespace:contract.namespace,codec:clone(contract.codec),validationId:contract.validationId,schemaEpoch:contract.schemaEpoch,validateState:contract.validateState};
}
function accepts(contract:LocalToolConvergenceContract,data:LocalToolJson):boolean {
 try{validateLocalToolCodecState(data,contract.codec);return contract.validateState(cloneLocalToolJson(data))===true;}catch{return false;}
}
function validFallback<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>):ValidView {
 const version=r.registers.winner('authored-valid-snapshot','view',version=>{
  if(!version.present||!object(version.value)||!accepts(contract,(version.value as unknown as ValidView).data))return false;
  try{checkBindings(r,version.value as unknown as ValidView);return true;}catch{return false;}
 });
 if(!version)throw Error('local_tool_convergence_valid_snapshot_invalid');return clone(version.value) as unknown as ValidView;
}
function inspect<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>):LocalToolConvergenceView<T> {
 const raw=projection(r);if(accepts(contract,raw.data))return{data:raw.data as T,conflict:null};
 const fallback=validFallback(r,contract);
 return{data:clone(fallback.data) as T,conflict:{kind:'validation',policy:'authored-valid-snapshot/1',validationId:contract.validationId,rawFingerprint:convergenceHash(raw.data),raw:clone(raw.data)}};
}
function currentBindings(r:Roots,contract:LocalToolConvergenceContract):Bindings {
 const raw=projection(r);return clone(accepts(contract,raw.data)?raw.bindings:validFallback(r,contract).bindings);
}
function semanticPending(r:Roots):boolean {
 if(r.registers.pending())return true;
 for(const version of r.registers.entries('authored-valid-snapshot'))if(version.present){try{checkBindings(r,version.value as unknown as ValidView);}catch{return true;}}
 for(const[field]of listFields(r.codec)){
  const placements=new Set(r.list(field).order.toArray().map(place=>place.placementId));
  if(r.registers.entries('selected:'+field).some(version=>version.present&&!placements.has(version.value as string)))return true;
 }
 return false;
}
function checkDocumentIdentity(doc:Y.Doc,identity:LocalToolConvergenceIdentity):void {
 if(convergenceCanonical(new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).get('value'))!==convergenceCanonical(identity))throw Error('local_tool_convergence_identity_mismatch');
}
function capsule(identity:LocalToolConvergenceIdentity,doc:Y.Doc):LocalToolConvergenceCheckpoint {
 return{format:'writers-hoard-local-convergence/1',...clone(identity),checkpointBase64:convergenceBase64(Y.encodeStateAsUpdate(doc)),stateVectorBase64:convergenceBase64(Y.encodeStateVector(doc))};
}
function packet(identity:LocalToolConvergenceIdentity,update:Uint8Array):LocalToolConvergenceUpdate {
 return{format:'writers-hoard-local-convergence-update/1',...clone(identity),updateBase64:convergenceBase64(update)};
}
/** decodeUpdate and decodeStateVector are public Yjs APIs; no doc.store or UndoManager internals. */
function pending(doc:Y.Doc):boolean {
 const decoded=Y.decodeUpdate(Y.encodeStateAsUpdate(doc)),vector=Y.decodeStateVector(Y.encodeStateVector(doc));
 for(const struct of decoded.structs)if(struct.id.clock+struct.length>(vector.get(struct.id.client)??0))return true;
 for(const[client,ranges]of decoded.ds.clients)for(const range of ranges)if(range.clock+range.len>(vector.get(client)??0))return true;
 return false;
}
function seed(doc:Y.Doc,metadata:LocalToolConvergenceMetadata,data:LocalToolJson,identity:LocalToolConvergenceIdentity):void {
 const r=initializeRoots(doc,metadata.codec),bindings:Bindings={};
 doc.transact(()=>{
  new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).set('value',clone(identity));r.registers.begin();
  for(const[field,value]of Object.entries(data as ObjectData)){
   const descriptor=metadata.codec.fields[field];
   if(descriptor?.kind==='map'){
    r.presence.set(field,true);for(const[key,item]of Object.entries(value as ObjectData))r.map(field).set(key,clone(item));
   }else if(descriptor?.kind==='list'){
    r.presence.set(field,true);const list=r.list(field);bindings[field]=[];
    for(const item of value as ObjectData[]){const id=item[descriptor.idKey] as string,placementId=crypto.randomUUID();list.content.set(id,clone(item));list.membership.set(id,true);list.selected.set(id,placementId);list.order.push([{id,placementId}]);bind(bindings[field],id,placementId);}
   }else r.scalar.set(field,clone(value));
  }
  r.valid.set('view',{data:clone(data),bindings});r.registers.flush();
 },'genesis');
}
/** Pure portable fork: trusted engine, no registry/factory or executable package validator. */
export function forkLocalToolGenesis(data:LocalToolJson,metadata:LocalToolConvergenceMetadata):LocalToolConvergenceCheckpoint {
 validateConvergenceMetadata(metadata);const safe=cloneLocalToolJson(data);validateLocalToolCodecState(safe,metadata.codec);
 const doc=new Y.Doc({gc:false}),identity=convergenceIdentity(metadata,crypto.randomUUID());try{seed(doc,metadata,safe,identity);return capsule(identity,doc);}finally{doc.destroy();}
}
export function createLocalToolGenesis<T extends LocalToolJson>(data:T,contract:LocalToolConvergenceContract<T>):LocalToolConvergenceCheckpoint {
 const frozen=contractCopy(contract),safe=cloneLocalToolJson(data);if(!accepts(frozen,safe))throw Error('local_tool_convergence_authored_state_invalid');return forkLocalToolGenesis(safe,frozen);
}
function prepareActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string):{actions:ReadyAction[];proposal:T;bindings:Bindings;changed:boolean} {
 const before=inspect(r,contract).data,{data:proposal}=mergeLocalToolActions(contract.codec,before,before,actions);
 if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const prepared=clone(actions) as ReadyAction[],bindings=currentBindings(r,contract);
 for(const action of prepared){
  if(action.type==='list-delete')unbind(bindings[action.field],action.id);
  else if(action.type==='list-insert'||action.type==='list-move'){
   const descriptor=contract.codec.fields[action.field];if(descriptor.kind!=='list')throw Error('local_tool_convergence_list_invalid');
   action.anchorPlacement=action.afterId===null?null:binding(bindings[action.field],action.afterId);
   if(action.anchorPlacement===undefined)throw Error('local_tool_convergence_anchor_invalid');
   action.placementId=authorId+':'+crypto.randomUUID();const id=action.type==='list-insert'?action.item[descriptor.idKey] as string:action.id;bind(bindings[action.field],id,action.placementId);
  }
 }
 const raw=projection(r).data;let rawChanged=true;try{rawChanged=!localToolStateEqual(raw,mergeLocalToolActions(contract.codec,raw,raw,actions).data);}catch{/* An intent valid on fallback can target an absent/different raw list identity. */}
 return{actions:prepared,proposal,bindings,changed:!localToolStateEqual(before,proposal)||rawChanged};
}
function mutate(r:Roots,actions:readonly ReadyAction[]):void {
 for(const action of actions){const field=action.field;
  if(action.type==='set')r.scalar.set(field,clone(action.value));else if(action.type==='unset')r.scalar.delete(field);
  else if(action.type==='map-set')r.map(field).set(action.key,clone(action.value));else if(action.type==='map-delete')r.map(field).delete(action.key);
  else{
   const descriptor=r.codec.fields[field];if(descriptor.kind!=='list')throw Error('local_tool_convergence_list_invalid');
   const id=action.type==='list-insert'?action.item[descriptor.idKey] as string:action.id,list=r.list(field);
   if(action.type==='list-delete')list.membership.set(id,false);
   else if(action.type==='list-update')list.content.set(id,clone(action.item));
   else{
    if(action.type==='list-insert'){list.content.set(id,clone(action.item));list.membership.set(id,true);}
    const at=action.anchorPlacement===null?-1:list.order.toArray().findIndex(place=>place.placementId===action.anchorPlacement);
    if(action.anchorPlacement!==null&&at<0)throw Error('local_tool_convergence_anchor_invalid');
    list.order.insert(at+1,[{id,placementId:action.placementId!}]);list.selected.set(id,action.placementId!);
   }
  }
 }
}
function authorFallback<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,proposal:T,bindings:Bindings):void {
 const raw=projection(r);const fallback=accepts(contract,raw.data)?raw:{data:clone(proposal),bindings:clone(bindings)};checkBindings(r,fallback);r.valid.set('view',fallback);
}


type ReplacementWrite={root:'scalar'|'presence'|'map'|'membership';field:string;key:string;present:boolean;value?:LocalToolJson};
interface ReplacementPlan<T extends LocalToolJson>{proposal:T;bindings:Bindings;writes:ReplacementWrite[];actions:ReadyAction[];changed:boolean}
function prepareReplacement<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,data:T,authorId:string):ReplacementPlan<T> {
 const proposal=cloneLocalToolJson(data);if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const before=inspect(r,contract).data as ObjectData,next=proposal as ObjectData,bindings=currentBindings(r,contract),writes:ReplacementWrite[]=[],actions:ReadyAction[]=[];
 for(const field of new Set([...Object.keys(before),...Object.keys(next)])){
  const descriptor=contract.codec.fields[field],old=before[field],desired=next[field];if(localToolStateEqual(old,desired))continue;
  if(descriptor?.kind==='map'){
   writes.push({root:'presence',field,key:field,present:true,value:desired!==undefined});
   const oldMap={...Object.fromEntries(r.map(field)),...((old??{}) as ObjectData)},nextMap=(desired??{}) as ObjectData;
   for(const key of new Set([...Object.keys(oldMap),...Object.keys(nextMap)]))if(!localToolStateEqual(oldMap[key],nextMap[key]))writes.push({root:'map',field,key,present:Object.hasOwn(nextMap,key),...(Object.hasOwn(nextMap,key)?{value:clone(nextMap[key])}:{})});
  }else if(descriptor?.kind==='list'){
   writes.push({root:'presence',field,key:field,present:true,value:desired!==undefined});
   const newRows=(desired??[]) as ObjectData[],wanted=new Set(newRows.map(row=>row[descriptor.idKey] as string)),known=new Set(r.registers.entries('membership:'+field).map(version=>version.key));bindings[field]=[];
   for(const id of known)if(!wanted.has(id))writes.push({root:'membership',field,key:id,present:true,value:false});
   for(let index=0;index<newRows.length;index++){
    const item=newRows[index],id=item[descriptor.idKey] as string,afterId=index===0?null:newRows[index-1][descriptor.idKey] as string,placementId=authorId+':'+crypto.randomUUID(),anchorPlacement=afterId===null?null:binding(bindings[field],afterId);
    writes.push({root:'membership',field,key:id,present:true,value:true});
    actions.push(known.has(id)?{type:'list-move',field,id,afterId,placementId,anchorPlacement}:{type:'list-insert',field,item:clone(item),afterId,placementId,anchorPlacement});
    if(known.has(id))actions.push({type:'list-update',field,id,item:clone(item)});bind(bindings[field],id,placementId);
   }
   if(desired===undefined)delete bindings[field];
  }else writes.push({root:'scalar',field,key:field,present:Object.hasOwn(next,field),...(Object.hasOwn(next,field)?{value:clone(desired)}:{})});
 }
 return{proposal,bindings,writes,actions,changed:!localToolStateEqual(before,proposal)};
}
function mutateReplacement(r:Roots,plan:ReplacementPlan<LocalToolJson>):void {
 for(const write of plan.writes){const target=write.root==='scalar'?r.scalar:write.root==='presence'?r.presence:write.root==='membership'?r.list(write.field).membership:r.map(write.field);
  if(write.present)target.set(write.key,clone(write.value) as never);else target.delete(write.key);
 }
 mutate(r,plan.actions);
}

type ActivationRecipe={format:'register-activation/1';changes:Toggle[];frontier:string[]};
function recipeRecord(receipt:LocalToolConvergenceReceipt,r:Roots):ActivationRecipe {
 const record=receipt.record as unknown as ActivationRecipe;
 if(!record||record.format!=='register-activation/1'||!Array.isArray(record.changes)||!Array.isArray(record.frontier)||new Set(record.changes.map(change=>change.id)).size!==record.changes.length||record.changes.some(change=>!change||typeof change.id!=='string'||typeof change.enabled!=='boolean'||!r.registers.versions.has(change.id))||record.frontier.some(id=>typeof id!=='string'||!r.registers.transactions.has(id)))throw Error('local_tool_convergence_receipt_unavailable');
 return clone(record);
}
function instantiate<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,restore?:LocalToolConvergenceReceipt){
 validateLocalToolConvergenceCheckpoint(checkpoint);const contract=contractCopy(options.contract);
 if(typeof options.authorId!=='string'||!options.authorId)throw Error('local_tool_convergence_author_required');
 const identity=convergenceIdentity(contract,checkpoint.genesisId);assertConvergenceIdentity(checkpoint,identity);
 const doc=new Y.Doc({gc:false}),r=initializeRoots(doc,contract.codec),receipts=new Map<string,LocalToolConvergenceReceipt>(),undo:string[]=[],redo:string[]=[];
 let closed=false,captured:Uint8Array[]|null=null;
 const current=()=>{if(closed)throw Error('local_tool_convergence_destroyed');};
 const onUpdate=(update:Uint8Array)=>{captured?.push(update);};doc.on('update',onUpdate);
 try{
  Y.applyUpdate(doc,convergenceBytes(checkpoint.checkpointBase64));checkDocumentIdentity(doc,identity);r.registers.validate();
  if(convergenceBase64(Y.encodeStateVector(doc))!==checkpoint.stateVectorBase64)throw Error('local_tool_convergence_vector_invalid');inspect(r,contract);
  if(restore){validateLocalToolConvergenceReceipt(restore);assertConvergenceIdentity(restore.identity,identity);recipeRecord(restore,r);receipts.set(restore.id,clone(restore));(restore.mode==='undo'?undo:redo).push(restore.id);}
 }catch(error){doc.destroy();throw error;}
 const view=()=>{current();return inspect(r,contract);};
 const currentCheckpoint=()=>{current();return capsule(identity,doc);};
 const before=()=>({data:view().data,checkpoint:currentCheckpoint()});
 const result=(baseline:ReturnType<typeof before>):LocalToolConvergenceChange<T>=>({...view(),changed:!localToolStateEqual(baseline.data,view().data),causalChanged:baseline.checkpoint.checkpointBase64!==currentCheckpoint().checkpointBase64,pending:pending(doc)||semanticPending(r)});
 const storeReceipt=(mode:'undo'|'redo',changes:Toggle[]):LocalToolConvergenceReceipt|null=>{
  if(!changes.length)return null;const id=options.authorId+':receipt:'+crypto.randomUUID(),heads=new Set(r.registers.transactions.keys());for(const tx of r.registers.transactions.values())for(const parent of tx.parents)heads.delete(parent);
  const receipt:LocalToolConvergenceReceipt={format:'writers-hoard-local-convergence-receipt/1',id,identity:clone(identity),mode,record:{format:'register-activation/1',changes:clone(changes),frontier:[...heads]} as unknown as LocalToolJson};receipts.set(id,receipt);(mode==='undo'?undo:redo).push(id);return receipt;
 };
 function author(plan:{proposal:T;bindings:Bindings;changed:boolean},mutations:()=>void):LocalToolReplicaEdit<T> {
  const baseline=before();if(!plan.changed)return{...result(baseline),update:packet(identity,Y.mergeUpdates([])),receiptId:null};
  captured=[];let ids:string[]=[];
  try{
   doc.transact(()=>{r.registers.begin();mutations();authorFallback(r,contract,plan.proposal,plan.bindings);ids=r.registers.flush();},options.authorId);
   for(const id of redo)receipts.delete(id);redo.length=0;const receipt=storeReceipt('undo',ids.map(id=>({id,enabled:false})));
   return{...result(baseline),update:packet(identity,Y.mergeUpdates(captured)),receiptId:receipt?.id??null};
  }finally{r.registers.cancel();captured=null;}
 }
 function reverse(id:string,isRedo:boolean):LocalToolReplicaEdit<T> {
  current();const from=isRedo?redo:undo,receipt=receipts.get(id);if(from.at(-1)!==id||!receipt)throw Error('local_tool_convergence_receipt_unavailable');
  const record=recipeRecord(receipt,r),baseline=before();captured=[];let inverse:Toggle[]=[];
  try{
   doc.transact(()=>{inverse=r.registers.toggle(record.changes);},options.authorId);from.pop();receipts.delete(id);
   const next=storeReceipt(isRedo?'undo':'redo',inverse);return{...result(baseline),update:packet(identity,Y.mergeUpdates(captured)),receiptId:next?.id??null};
  }finally{captured=null;}
 }
 const replica:LocalToolReplica<T>=Object.freeze({
  read:()=>clone(view().data),inspect:()=>clone(view()),checkpoint:currentCheckpoint,
  apply(actions:readonly LocalToolStateAction[]){current();const plan=prepareActions(r,contract,actions,options.authorId);return author(plan,()=>mutate(r,plan.actions));},
  undo:(id:string)=>reverse(id,false),redo:(id:string)=>reverse(id,true),
  receive(update:LocalToolConvergenceUpdate){
   current();validateLocalToolConvergenceUpdate(update);assertConvergenceIdentity(update,identity);const baseline=before(),bytes=convergenceBytes(update.updateBase64);
   // Validate a full candidate first. Invalid JSON/graph/bindings must not partially change this instance.
   const candidate=new Y.Doc({gc:false});try{const candidateRoots=initializeRoots(candidate,contract.codec);Y.applyUpdate(candidate,convergenceBytes(baseline.checkpoint.checkpointBase64));Y.applyUpdate(candidate,bytes);checkDocumentIdentity(candidate,identity);candidateRoots.registers.validate();inspect(candidateRoots,contract);}finally{candidate.destroy();}
   Y.applyUpdate(doc,bytes);return result(baseline);
  },
  export(stateVectorBase64?:string){current();return packet(identity,Y.encodeStateAsUpdate(doc,stateVectorBase64===undefined?undefined:convergenceBytes(stateVectorBase64)));},
  destroy(){if(!closed){closed=true;receipts.clear();undo.length=redo.length=0;doc.off('update',onUpdate);doc.destroy();}},
 });
 return{replica,
  receipt(id:string|null){current();if(id===null)return null;const receipt=receipts.get(id);if(!receipt)throw Error('local_tool_convergence_receipt_unavailable');return clone(receipt);},
  replace(data:T){current();const plan=prepareReplacement(r,contract,data,options.authorId);return author(plan,()=>mutateReplacement(r,plan));},
  pending(){current();return pending(doc)||semanticPending(r);},
 };
}
/** The returned object exposes public SDK capabilities only. */
export function createLocalToolReplica<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>):LocalToolReplica<T> {return instantiate(checkpoint,options).replica;}
function prepare<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,operation:(host:ReturnType<typeof instantiate<T>>)=>LocalToolReplicaEdit<T>|LocalToolConvergenceChange<T>,restore?:LocalToolConvergenceReceipt):LocalToolConvergencePreparation<T> {
 const host=instantiate(checkpoint,options,restore);try{
  const reply=operation(host),receiptId='receiptId'in reply?reply.receiptId:null,update='update'in reply?reply.update:host.replica.export(checkpoint.stateVectorBase64);
  return{data:reply.data,conflict:reply.conflict,changed:reply.changed,causalChanged:reply.causalChanged,pending:reply.pending,beforeFingerprint:convergenceHash(checkpoint),checkpoint:host.replica.checkpoint(),update,consumeReceiptId:restore?.id??null,receipt:host.receipt(receiptId)};
 }finally{host.replica.destroy();}
}
/** Host-only: no token is consumed until the existing Source writer's onCommit hook. */
export function prepareLocalToolActions<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,actions:readonly LocalToolStateAction[]):LocalToolConvergencePreparation<T> {return prepare(checkpoint,options,host=>host.replica.apply(actions));}
export function prepareLocalToolReplacement<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,data:T):LocalToolConvergencePreparation<T> {return prepare(checkpoint,options,host=>host.replace(data));}
export function prepareLocalToolReceive<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,update:LocalToolConvergenceUpdate):LocalToolConvergencePreparation<T> {return prepare(checkpoint,options,host=>host.replica.receive(update));}
export function prepareLocalToolReverse<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,receipt:LocalToolConvergenceReceipt):LocalToolConvergencePreparation<T> {return prepare(checkpoint,options,host=>receipt.mode==='undo'?host.replica.undo(receipt.id):host.replica.redo(receipt.id),receipt);}
export function inspectLocalToolConvergence<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>):LocalToolConvergenceView<T>&{pending:boolean} {
 const host=instantiate(checkpoint,options);try{return{...host.replica.inspect(),pending:host.pending()};}finally{host.replica.destroy();}
}

/** Readonly export also works when the current installed definition has a different epoch. */
export function exportLocalToolConvergenceCheckpoint(checkpoint:LocalToolConvergenceCheckpoint,stateVectorBase64?:string):{update:LocalToolConvergenceUpdate;pending:boolean} {
 validateLocalToolConvergenceCheckpoint(checkpoint);const identity=convergenceIdentityOf(checkpoint),doc=new Y.Doc({gc:false});
 try{
  Y.applyUpdate(doc,convergenceBytes(checkpoint.checkpointBase64));checkDocumentIdentity(doc,identity);
  if(convergenceBase64(Y.encodeStateVector(doc))!==checkpoint.stateVectorBase64)throw Error('local_tool_convergence_vector_invalid');
  const registers=new Registers(doc);registers.validate();let semantic=registers.pending();
  for(const version of registers.versions.values()){
   if(!version.present)continue;
   if(version.root.startsWith('selected:')&&!order(doc,version.root.slice('selected:'.length)).toArray().some(place=>place.placementId===version.value))semantic=true;
   if(version.root==='authored-valid-snapshot'){
    const view=version.value as unknown as ValidView;
    if(!view||!object(view.bindings))throw Error('local_tool_convergence_bindings_invalid');
    for(const[field,bindings]of Object.entries(view.bindings)){const places=new Map(order(doc,field).toArray().map(place=>[place.placementId,place.id]));if(!Array.isArray(bindings))throw Error('local_tool_convergence_bindings_invalid');for(const {id,placementId}of bindings)if(places.get(placementId)!==id)semantic=true;}
   }
  }
  return{update:packet(identity,Y.encodeStateAsUpdate(doc,stateVectorBase64===undefined?undefined:convergenceBytes(stateVectorBase64))),pending:pending(doc)||semantic};
 }finally{doc.destroy();}
}
