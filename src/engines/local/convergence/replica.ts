import * as Y from 'yjs';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState,isLocalToolPlainField,type LocalToolStateCodec} from '../stateCodec';
import {mergeLocalToolActions,localToolStateEqual,type LocalToolStateAction} from '../stateActions';
import {assertConvergenceIdentity,convergenceBase64,convergenceBytes,convergenceCanonical,convergenceHash,convergenceIdentity,convergenceIdentityOf,convergenceClone,validateConvergenceMetadata,validateLocalToolConvergenceCheckpoint,validateLocalToolConvergenceUpdate,validateLocalToolConvergenceReceipt,validateLocalToolPlainRange} from './format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceContract,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,LocalToolConvergenceUpdate,LocalToolConvergenceView,LocalToolReplicaOptions,LocalToolReplica,LocalToolReplicaEdit,LocalToolConvergenceChange,LocalToolConvergenceReceipt,LocalToolConvergencePreparation,LocalToolPlainRange} from './types';

import {JsonMap,JsonArray,Registers,type Toggle} from './registers';
import {PlainRuns,type PlainSpan,type PlainPlan,type PlainDraft} from './plainRuns';

type ObjectData=Record<string,LocalToolJson>;
type Binding={id:string;placementId:string};
type Bindings=Record<string,Binding[]>;
type Placement={id:string;placementId:string};
type PlainBindings=Record<string,PlainSpan[]>;
type PlainBindingChecks=Map<string,ReturnType<PlainRuns['bindingValidator']>>;
type ValidView={data:LocalToolJson;bindings:Bindings;plainBindings?:PlainBindings};
type ActionPlan<T extends LocalToolJson>={actions:ReadyAction[];proposal:T;bindings:Bindings;changed:boolean;plainBindings?:PlainBindings;plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>};
type ReadyAction=LocalToolStateAction&{placementId?:string;anchorPlacement?:string|null};
const clone=<T>(value:T):T=>convergenceClone(value);
const binding=(bindings:Binding[],id:string)=>bindings.find(value=>value.id===id)?.placementId;
const bind=(bindings:Binding[],id:string,placementId:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at<0)bindings.push({id,placementId});else bindings[at]={id,placementId};};
const unbind=(bindings:Binding[],id:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at>=0)bindings.splice(at,1);};
const object=(value:unknown):value is ObjectData=>!!value&&typeof value==='object'&&!Array.isArray(value);
const listFields=(codec:LocalToolStateCodec)=>Object.entries(codec.fields).filter(([,field])=>field.kind==='list');
const order=(doc:Y.Doc,field:string)=>new JsonArray<Placement>(doc.getArray<string>('order:'+JSON.stringify(field)));
const roots=(doc:Y.Doc,codec:LocalToolStateCodec)=>{
 const registers=new Registers(doc),plainRoots=new Map<string,PlainRuns>();
 return{registers,plain:(field:string)=>{let plain=plainRoots.get(field);if(!plain){plain=new PlainRuns(doc,field,registers);plainRoots.set(field,plain);}return plain;},scalar:registers.map<LocalToolJson>('scalar'),presence:registers.map<boolean>('presence'),valid:registers.map<ValidView>('authored-valid-snapshot'),
 map:(field:string)=>registers.map<LocalToolJson>('map:'+field),
 list:(field:string)=>({content:registers.map<ObjectData>('content:'+field),membership:registers.map<boolean>('membership:'+field),selected:registers.map<string>('selected:'+field),order:order(doc,field)}),codec};
};
type Roots=ReturnType<typeof roots>;
function initializeRoots(doc:Y.Doc,codec:LocalToolStateCodec):Roots {
 const r=roots(doc,codec);for(const[field,descriptor]of Object.entries(codec.fields)){if(descriptor.kind==='list')r.list(field);else if(isLocalToolPlainField(descriptor))r.plain(field);}return r;
}
function projection(r:Roots):ValidView {
 const data:ObjectData={},bindings:Bindings={},plainBindings:PlainBindings={};
 for(const[field,value]of r.scalar)data[field]=clone(value);
 for(const[field,descriptor]of Object.entries(r.codec.fields)){
  if(isLocalToolPlainField(descriptor)){
   delete data[field];if(r.presence.get(field)){const view=r.plain(field).materialize();data[field]=view.text;plainBindings[field]=view.bindings;}
  }else if(descriptor.kind==='map'){
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
 return{data,bindings,...(Object.values(r.codec.fields).some(isLocalToolPlainField)?{plainBindings}:{})};
}
function checkBindings(r:Roots,view:ValidView,plainChecks?:PlainBindingChecks):void {
 if(!object(view.data)||!object(view.bindings))throw Error('local_tool_convergence_bindings_invalid');
 for(const[field,descriptor]of listFields(r.codec)){
  if(descriptor.kind!=='list')continue;const rows=view.data[field];
  if(rows===undefined){if(Object.hasOwn(view.bindings,field))throw Error('local_tool_convergence_bindings_invalid');continue;}
  const bindings=view.bindings[field],placements=new Map(r.list(field).order.toArray().map(place=>[place.placementId,place.id]));
  if(!Array.isArray(rows)||!Array.isArray(bindings)||bindings.length!==rows.length||new Set(bindings.map(value=>value.id)).size!==bindings.length)throw Error('local_tool_convergence_bindings_invalid');
  for(const row of rows){const id=(row as ObjectData)[descriptor.idKey] as string;const place=binding(bindings,id);if(typeof place!=='string'||placements.get(place)!==id)throw Error('local_tool_convergence_bindings_invalid');}
 }
 if(Object.keys(view.bindings).some(field=>r.codec.fields[field]?.kind!=='list'))throw Error('local_tool_convergence_bindings_invalid');
 const plain=view.plainBindings??{};if(!object(plain)||Object.keys(plain).some(field=>!isLocalToolPlainField(r.codec.fields[field])))throw Error('local_tool_convergence_bindings_invalid');
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(isLocalToolPlainField(descriptor)){
  const value=(view.data as ObjectData)[field];if(value===undefined){if(Object.hasOwn(plain,field))throw Error('local_tool_convergence_bindings_invalid');continue;}
  if(typeof value!=='string'||!Array.isArray(plain[field]))throw Error('local_tool_convergence_bindings_invalid');
  if(plainChecks){
   let check=plainChecks.get(field);if(!check){check=r.plain(field).bindingValidator();plainChecks.set(field,check);}
   check({text:value,bindings:plain[field]});
  }else r.plain(field).checkBindings({text:value,bindings:plain[field]});
 }
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
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(isLocalToolPlainField(descriptor)&&r.plain(field).pending())return true;
 const plainChecks:PlainBindingChecks=new Map();
 for(const version of r.registers.entries('authored-valid-snapshot'))if(version.present){try{checkBindings(r,version.value as unknown as ValidView,plainChecks);}catch{return true;}}
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
 const r=initializeRoots(doc,metadata.codec),bindings:Bindings={},plainBindings:PlainBindings={},plainFields=Object.keys(metadata.codec.fields).filter(field=>isLocalToolPlainField(metadata.codec.fields[field])).sort();
 doc.transact(()=>{
  new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).set('value',clone(identity));r.registers.begin();
  if(plainFields.length)new JsonMap<string[]>(doc.getMap('plain-fields')).set('value',plainFields);
  for(const[field,value]of Object.entries(data as ObjectData)){
   const descriptor=metadata.codec.fields[field];
   if(isLocalToolPlainField(descriptor)){
    const draft=r.plain(field).draft({text:'',bindings:[]});draft.replace(value as string);const plan=draft.finish();r.plain(field).commit(plan);r.presence.set(field,true);plainBindings[field]=plan.view.bindings;
   }else if(descriptor?.kind==='map'){
    r.presence.set(field,true);for(const[key,item]of Object.entries(value as ObjectData))r.map(field).set(key,clone(item));
   }else if(descriptor?.kind==='list'){
    r.presence.set(field,true);const list=r.list(field);bindings[field]=[];
    for(const item of value as ObjectData[]){const id=item[descriptor.idKey] as string,placementId=crypto.randomUUID();list.content.set(id,clone(item));list.membership.set(id,true);list.selected.set(id,placementId);list.order.push([{id,placementId}]);bind(bindings[field],id,placementId);}
   }else r.scalar.set(field,clone(value));
  }
  r.valid.set('view',{data:clone(data),bindings,...(plainFields.length?{plainBindings}:{})});r.registers.flush();
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
function prepareLegacyActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string):{actions:ReadyAction[];proposal:T;bindings:Bindings;changed:boolean} {
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
function admitted(r:Roots,contract:LocalToolConvergenceContract):ValidView {
 const raw=projection(r);return accepts(contract,raw.data)?raw:validFallback(r,contract);
}
function plainFields(doc:Y.Doc):string[]{
 const fields=new JsonMap<string[]>(doc.getMap('plain-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string')||new Set(fields).size!==fields.length)throw Error('local_tool_plain_fields_invalid');return fields;
}
function checkPlainDocument(r:Roots,doc:Y.Doc):void {
 const expected=Object.keys(r.codec.fields).filter(field=>isLocalToolPlainField(r.codec.fields[field])).sort();
 if(convergenceCanonical(plainFields(doc))!==convergenceCanonical(expected))throw Error('local_tool_plain_fields_invalid');
 for(const field of expected)r.plain(field).validate();
}
function prepareActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string,identity:LocalToolConvergenceIdentity,baseline?:T):ActionPlan<T> {
 const initial=admitted(r,contract),before=initial.data as T;
 if(!Object.values(r.codec.fields).some(isLocalToolPlainField)){
  if(baseline!==undefined)mergeLocalToolActions(contract.codec,baseline,before,actions);return prepareLegacyActions(r,contract,actions,authorId);
 }
 if(!Array.isArray(actions)||!actions.length)throw Error('local_tool_actions_invalid');
 const generic=actions.filter(action=>action.type!=='text-splice');if(generic.length)mergeLocalToolActions(contract.codec,baseline??before,before,generic);
 const prepared=clone(actions) as ReadyAction[],bindings=currentBindings(r,contract),plainBindings=clone(initial.plainBindings??{}),drafts=new Map<string,PlainDraft>(),plainPresence:Record<string,boolean>={};
 let proposal=clone(before) as ObjectData;
 const draft=(field:string)=>{let value=drafts.get(field);if(!value){const old=(initial.data as ObjectData)[field];value=r.plain(field).draft({text:typeof old==='string'?old:'',bindings:plainBindings[field]??[]});drafts.set(field,value);}return value;};
 for(const action of prepared){
  const descriptor=contract.codec.fields[action.field];
  if(action.type==='text-splice'){
   if(Object.keys(action).length!==4||!isLocalToolPlainField(descriptor)||typeof action.text!=='string')throw Error('local_tool_plain_range_invalid');validateLocalToolPlainRange(action.range);
   if(action.field!==action.range.field||typeof proposal[action.field]!=='string')throw Error('local_tool_plain_range_invalid');assertConvergenceIdentity(action.range.identity,identity);
   const next=draft(action.field);next.splice(action.range,action.text);const view=next.view();proposal[action.field]=view.text;plainBindings[action.field]=view.bindings;continue;
  }
  // Three-way conflict checks already covered the generic subsequence. Apply in original order to the proposal overlay.
  proposal=mergeLocalToolActions(contract.codec,proposal,proposal,[action]).data as ObjectData;
  if(isLocalToolPlainField(descriptor)){
   const next=draft(action.field);if(action.type==='set')next.replace(action.value as string);else if(action.type==='unset')next.clear();else throw Error('local_tool_action_kind_invalid');
   plainPresence[action.field]=action.type!=='unset';if(action.type==='unset')delete plainBindings[action.field];else plainBindings[action.field]=next.view().bindings;continue;
  }
  if(action.type==='list-delete')unbind(bindings[action.field],action.id);
  else if(action.type==='list-insert'||action.type==='list-move'){
   if(descriptor?.kind!=='list')throw Error('local_tool_convergence_list_invalid');action.anchorPlacement=action.afterId===null?null:binding(bindings[action.field],action.afterId);
   if(action.anchorPlacement===undefined)throw Error('local_tool_convergence_anchor_invalid');action.placementId=authorId+':'+crypto.randomUUID();const id=action.type==='list-insert'?action.item[descriptor.idKey] as string:action.id;bind(bindings[action.field],id,action.placementId);
  }
 }
 if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const plainPlans=Object.fromEntries([...drafts].map(([field,value])=>[field,value.finish()]));
 const nonPlain=generic.filter(action=>!isLocalToolPlainField(contract.codec.fields[action.field])),raw=projection(r).data;
 let rawChanged=false;if(nonPlain.length){try{rawChanged=!localToolStateEqual(raw,mergeLocalToolActions(contract.codec,raw,raw,nonPlain).data);}catch{rawChanged=true;}}
 return{actions:prepared,proposal:proposal as T,bindings,plainBindings,plainPlans,plainPresence,changed:!localToolStateEqual(before,proposal)||Object.values(plainPlans).some(plan=>plan.changed)||rawChanged};
}
function commitPlain(r:Roots,plan:{plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>}):void {
 for(const[field,value]of Object.entries(plan.plainPlans??{}))r.plain(field).commit(value);
 for(const[field,present]of Object.entries(plan.plainPresence??{}))r.presence.set(field,present);
}
function mutateActions(r:Roots,plan:ActionPlan<LocalToolJson>):void {
 if(!plan.plainPlans){mutate(r,plan.actions);return;}
 mutate(r,plan.actions.filter(action=>action.type!=='text-splice'&&!isLocalToolPlainField(r.codec.fields[action.field])));commitPlain(r,plan);
}

function mutate(r:Roots,actions:readonly ReadyAction[]):void {
 for(const action of actions){if(action.type==='text-splice')throw Error('local_tool_plain_convergence_required');const field=action.field;
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
function authorFallback<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,proposal:T,bindings:Bindings,plainBindings?:PlainBindings):void {
 const raw=projection(r);const fallback=accepts(contract,raw.data)?raw:{data:clone(proposal),bindings:clone(bindings),...(plainBindings?{plainBindings:clone(plainBindings)}:{})};checkBindings(r,fallback);r.valid.set('view',fallback);
}


type ReplacementWrite={root:'scalar'|'presence'|'map'|'membership';field:string;key:string;present:boolean;value?:LocalToolJson};
interface ReplacementPlan<T extends LocalToolJson>{proposal:T;bindings:Bindings;writes:ReplacementWrite[];actions:ReadyAction[];changed:boolean;plainBindings?:PlainBindings;plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>}
function prepareLegacyReplacement<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,data:T,authorId:string):ReplacementPlan<T> {
 const proposal=cloneLocalToolJson(data);if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const before=inspect(r,contract).data as ObjectData,next=proposal as ObjectData,bindings=currentBindings(r,contract),writes:ReplacementWrite[]=[],actions:ReadyAction[]=[];
 for(const field of new Set([...Object.keys(before),...Object.keys(next)])){
  const descriptor=contract.codec.fields[field],old=before[field],desired=next[field];if(isLocalToolPlainField(descriptor)||localToolStateEqual(old,desired))continue;
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
function prepareReplacement<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,data:T,authorId:string):ReplacementPlan<T> {
 const plan=prepareLegacyReplacement(r,contract,data,authorId);if(!Object.values(r.codec.fields).some(isLocalToolPlainField))return plan;
 const current=admitted(r,contract),plainBindings=clone(current.plainBindings??{}),plainPlans:Record<string,PlainPlan>={},plainPresence:Record<string,boolean>={};
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(isLocalToolPlainField(descriptor)){
  const old=(current.data as ObjectData)[field],desired=(data as ObjectData)[field];if(localToolStateEqual(old,desired))continue;
  const draft=r.plain(field).draft({text:typeof old==='string'?old:'',bindings:plainBindings[field]??[]});
  if(desired===undefined){draft.clear();delete plainBindings[field];}else{draft.replace(desired as string);plainBindings[field]=draft.view().bindings;}
  plainPlans[field]=draft.finish();plainPresence[field]=desired!==undefined;
 }
 return{...plan,plainBindings,plainPlans,plainPresence};
}
function mutateReplacement(r:Roots,plan:ReplacementPlan<LocalToolJson>):void {
 for(const write of plan.writes){const target=write.root==='scalar'?r.scalar:write.root==='presence'?r.presence:write.root==='membership'?r.list(write.field).membership:r.map(write.field);
  if(write.present)target.set(write.key,clone(write.value) as never);else target.delete(write.key);
 }
 mutate(r,plan.actions);commitPlain(r,plan);
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
  Y.applyUpdate(doc,convergenceBytes(checkpoint.checkpointBase64));checkDocumentIdentity(doc,identity);r.registers.validate();checkPlainDocument(r,doc);
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
 function author(plan:{proposal:T;bindings:Bindings;plainBindings?:PlainBindings;changed:boolean},mutations:()=>void):LocalToolReplicaEdit<T> {
  const baseline=before();if(!plan.changed)return{...result(baseline),update:packet(identity,Y.mergeUpdates([])),receiptId:null};
  captured=[];let ids:string[]=[];
  try{
   doc.transact(()=>{r.registers.begin();mutations();authorFallback(r,contract,plan.proposal,plan.bindings,plan.plainBindings);ids=r.registers.flush();},options.authorId);
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
 const applyObserved=(actions:readonly LocalToolStateAction[],baseline?:T)=>{current();const plan=prepareActions(r,contract,actions,options.authorId,identity,baseline);return author(plan,()=>mutateActions(r,plan));};
 const textRange=(field:string,from:number,to:number):LocalToolPlainRange=>{
  current();if(identity.engine.version!=='2'||!isLocalToolPlainField(contract.codec.fields[field]))throw Error('local_tool_plain_range_invalid');const view=admitted(r,contract),text=(view.data as ObjectData)[field];
  if(typeof text!=='string')throw Error('local_tool_plain_range_invalid');return{format:'writers-hoard-local-plain-range/1',identity:clone(identity),field,...r.plain(field).range({text,bindings:view.plainBindings?.[field]??[]},from,to)};
 };
 const replica:LocalToolReplica<T>=Object.freeze({
  textRange,
  read:()=>clone(view().data),inspect:()=>clone(view()),checkpoint:currentCheckpoint,
  apply:applyObserved,
  undo:(id:string)=>reverse(id,false),redo:(id:string)=>reverse(id,true),
  receive(update:LocalToolConvergenceUpdate){
   current();validateLocalToolConvergenceUpdate(update);assertConvergenceIdentity(update,identity);const baseline=before(),bytes=convergenceBytes(update.updateBase64);
   // Validate a full candidate first. Invalid JSON/graph/bindings must not partially change this instance.
   const candidate=new Y.Doc({gc:false});try{const candidateRoots=initializeRoots(candidate,contract.codec);Y.applyUpdate(candidate,convergenceBytes(baseline.checkpoint.checkpointBase64));Y.applyUpdate(candidate,bytes);checkDocumentIdentity(candidate,identity);candidateRoots.registers.validate();checkPlainDocument(candidateRoots,candidate);inspect(candidateRoots,contract);}finally{candidate.destroy();}
   Y.applyUpdate(doc,bytes);return result(baseline);
  },
  export(stateVectorBase64?:string){current();return packet(identity,Y.encodeStateAsUpdate(doc,stateVectorBase64===undefined?undefined:convergenceBytes(stateVectorBase64)));},
  destroy(){if(!closed){closed=true;receipts.clear();undo.length=redo.length=0;doc.off('update',onUpdate);doc.destroy();}},
 });
 return{replica,applyObserved,
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
export function prepareLocalToolActions<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,actions:readonly LocalToolStateAction[],baseline?:T):LocalToolConvergencePreparation<T> {return prepare(checkpoint,options,host=>host.applyObserved(actions,baseline));}
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
    for(const[field,bindings]of Object.entries(view.plainBindings??{})){try{new PlainRuns(doc,field,registers).checkBindings({text:(view.data as ObjectData)[field] as string,bindings});}catch{semantic=true;}}
    for(const[field,bindings]of Object.entries(view.bindings)){const places=new Map(order(doc,field).toArray().map(place=>[place.placementId,place.id]));if(!Array.isArray(bindings))throw Error('local_tool_convergence_bindings_invalid');for(const {id,placementId}of bindings)if(places.get(placementId)!==id)semantic=true;}
   }
  }
  for(const field of plainFields(doc)){const plain=new PlainRuns(doc,field,registers);plain.validate();if(plain.pending())semantic=true;}
  return{update:packet(identity,Y.encodeStateAsUpdate(doc,stateVectorBase64===undefined?undefined:convergenceBytes(stateVectorBase64))),pending:pending(doc)||semantic};
 }finally{doc.destroy();}
}

/** Host-only readonly capture; no initialization, migration or receipt. */
export function captureLocalToolPlainRange<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,field:string,from:number,to:number):{data:T;range:LocalToolPlainRange}{
 const host=instantiate(checkpoint,options);try{return{data:host.replica.read(),range:host.replica.textRange(field,from,to)};}finally{host.replica.destroy();}
}
