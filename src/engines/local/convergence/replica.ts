import {RichRuns,richExclusions,type RichPlan,type RichBindings} from './richRuns';
import {captureBlockSplit,captureBlockJoin,validateBlockTextCapture,prepareBlockText,type RichBlockTextAction} from './blockText';
import {captureBlockEdit,prepareBlockEdit,isBlockEditingAction} from './blockEditing';
import {captureBlockEmptyItem,prepareBlockExit} from './blockExit';
import {RichBlocks,richBlockLeaves,type RichBlockDocument,type RichBlockBindings,type RichBlockPlan,type RichBlockAction,type RichBlockPlacement} from './blocks';
import {prepareRichSnapshotBindings,prepareRichSnapshotBatch,encodeRichSnapshotBindings,type StoredRichBindings,type PreparedRichSnapshot} from './richSnapshot';
import {validateRichDocument,type RichAction,type RichDocument,type RichRange,type RichSplitCapture,type RichJoinCapture,type RichSpan} from './richTypes';
import * as Y from 'yjs';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState,isLocalToolPlainField,localToolRichLinks,isLocalToolRichBlockField,type LocalToolStateCodec} from '../stateCodec';
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
type RichBindingChecks=Map<string,ReturnType<RichRuns['bindingValidator']>>;
type ValidView={data:LocalToolJson;bindings:Bindings;plainBindings?:PlainBindings;richBindings?:Record<string,RichBindings>;blockBindings?:Record<string,RichBlockBindings>};
type StoredValidView=Omit<ValidView,'richBindings'>&{richBindings?:Record<string,StoredRichBindings>};
type ActionPlan<T extends LocalToolJson>={actions:ReadyAction[];proposal:T;bindings:Bindings;changed:boolean;plainBindings?:PlainBindings;richBindings?:Record<string,RichBindings>;blockBindings?:Record<string,RichBlockBindings>;blockPlans?:Record<string,RichBlockPlan>;plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>;richPlans?:Record<string,RichPlan>;richPresence?:Record<string,boolean>};
type ReadyAction=Exclude<LocalToolStateAction,RichAction|RichBlockAction>&{placementId?:string;anchorPlacement?:string|null};
const clone=<T>(value:T):T=>convergenceClone(value);
const binding=(bindings:Binding[],id:string)=>bindings.find(value=>value.id===id)?.placementId;
const bind=(bindings:Binding[],id:string,placementId:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at<0)bindings.push({id,placementId});else bindings[at]={id,placementId};};
const unbind=(bindings:Binding[],id:string)=>{const at=bindings.findIndex(value=>value.id===id);if(at>=0)bindings.splice(at,1);};
const object=(value:unknown):value is ObjectData=>!!value&&typeof value==='object'&&!Array.isArray(value);
const listFields=(codec:LocalToolStateCodec)=>Object.entries(codec.fields).filter(([,field])=>field.kind==='list');
const order=(doc:Y.Doc,field:string)=>new JsonArray<Placement>(doc.getArray<string>('order:'+JSON.stringify(field)));
const roots=(doc:Y.Doc,codec:LocalToolStateCodec,provided?:Registers)=>{
 const registers=provided??new Registers(doc),plainRoots=new Map<string,PlainRuns>(),richRoots=new Map<string,RichRuns>();
 return{registers,rich:(field:string)=>{let rich=richRoots.get(field);if(!rich){rich=new RichRuns(doc,field,registers,!!provided,localToolRichLinks(codec.fields[field]));richRoots.set(field,rich);}return rich;},plain:(field:string)=>{let plain=plainRoots.get(field);if(!plain){plain=new PlainRuns(doc,field,registers);plainRoots.set(field,plain);}return plain;},scalar:registers.map<LocalToolJson>('scalar'),presence:registers.map<boolean>('presence'),valid:registers.map<StoredValidView>('authored-valid-snapshot'),
 map:(field:string)=>registers.map<LocalToolJson>('map:'+field),
 list:(field:string)=>({content:registers.map<ObjectData>('content:'+field),membership:registers.map<boolean>('membership:'+field),selected:registers.map<string>('selected:'+field),order:order(doc,field)}),codec,projectionReader:undefined as undefined|(()=>ValidView)};
};
type Roots=ReturnType<typeof roots>;
const blocks=(r:Roots,field:string)=>new RichBlocks(r.registers,field,localToolRichLinks(r.codec.fields[field]));
const blockField=(r:Roots,field:string)=>{const descriptor=r.codec.fields[field];return isLocalToolRichBlockField(descriptor);};
function leafData(r:Roots,field:string,data:unknown):RichDocument {
 if(blockField(r,field))return richBlockLeaves(data as RichBlockDocument,localToolRichLinks(r.codec.fields[field]));validateRichDocument(data,localToolRichLinks(r.codec.fields[field]));return data;
}
function initializeRoots(doc:Y.Doc,codec:LocalToolStateCodec):Roots {
 const r=roots(doc,codec);for(const[field,descriptor]of Object.entries(codec.fields)){if(descriptor.kind==='rich')r.rich(field);else if(descriptor.kind==='list')r.list(field);else if(isLocalToolPlainField(descriptor))r.plain(field);}return r;
}
/** Private RAW image only; acceptance/fallback/bindings/pending are never cached. */
function projection(r:Roots):ValidView {return r.projectionReader?r.projectionReader():projectRoots(r);}
function projectRoots(r:Roots):ValidView {
 const data:ObjectData={},bindings:Bindings={},plainBindings:PlainBindings={},richBindings:Record<string,RichBindings>={},blockBindings:Record<string,RichBlockBindings>={};
 for(const[field,value]of r.scalar)data[field]=clone(value);
 for(const[field,descriptor]of Object.entries(r.codec.fields)){
  if(descriptor.kind==='rich'){delete data[field];if(r.presence.get(field)){const rich=r.rich(field).materialize();if(blockField(r,field)){const view=blocks(r,field).project(rich);data[field]=view.data as unknown as LocalToolJson;richBindings[field]=view.rich.bindings;blockBindings[field]=view.bindings;}else{data[field]=rich.data as unknown as LocalToolJson;richBindings[field]=rich.bindings;}}}else if(isLocalToolPlainField(descriptor)){
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
 return{data,bindings,...(Object.keys(blockBindings).length?{blockBindings}:{}),...(Object.keys(richBindings).length?{richBindings}:{}),...(Object.values(r.codec.fields).some(isLocalToolPlainField)?{plainBindings}:{})};
}
/** Storage preflight: every field is prepared before logical unit arrays are built. */
function readRichSnapshot(rich:RichRuns,data:RichDocument,value:unknown):PreparedRichSnapshot {
 const registers=rich.registers,lengths=new Map<string,number>(),buffers=new Set<string>();
 return prepareRichSnapshotBindings(data,value,span=>{
  if(!buffers.has(span.buffer)){const buffer=rich.buffers.get(span.buffer);if(!buffer||!registers.transactionAvailable(buffer.txId))throw Error('local_tool_rich_dependency_missing');buffers.add(span.buffer);}
  const key=JSON.stringify([span.buffer,span.runId]);let length=lengths.get(key);
  if(length===undefined){const run=rich.plain(span.buffer).content.get(span.runId);if(!run||run.id!==span.runId||!registers.transactionAvailable(run.txId))throw Error('local_tool_rich_dependency_missing');if(!Number.isSafeInteger(run.length)||run.length<0)throw Error('local_tool_rich_bindings_invalid');length=run.length;lengths.set(key,length);}
  if(span.to>length)throw Error('local_tool_rich_bindings_invalid');
 },rich.links);
}
function readValidSnapshot(r:Roots,value:unknown):ValidView {
 if(!object(value)||!object(value.data)||!object(value.bindings))throw Error('local_tool_convergence_bindings_invalid');const view=value as unknown as StoredValidView,stored=view.richBindings??{};
 if(!object(stored))throw Error('local_tool_rich_bindings_invalid');const prepared:[string,PreparedRichSnapshot][]=[];
 for(const[field,bindings]of Object.entries(stored)){if(r.codec.fields[field]?.kind!=='rich')throw Error('local_tool_rich_bindings_invalid');const data=(view.data as ObjectData)[field];if(blockField(r,field))blocks(r,field).check(data as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings);prepared.push([field,readRichSnapshot(r.rich(field),leafData(r,field,data),bindings)]);}
 return{...view,...(Object.hasOwn(view,'richBindings')?{richBindings:Object.fromEntries(prepared.map(([field,bindings])=>[field,bindings.read()]))}:{})} as ValidView;
}
function writeValidSnapshot(r:Roots,view:ValidView):void {
 const packed:StoredValidView={...view,...(view.richBindings?{richBindings:Object.fromEntries(Object.entries(view.richBindings).map(([field,bindings])=>{const data=(view.data as ObjectData)[field];return[field,encodeRichSnapshotBindings(leafData(r,field,data),bindings,localToolRichLinks(r.codec.fields[field]))];}))}:{})};
 const before=r.registers.winner('authored-valid-snapshot','view',undefined,false);
 if(before?.present&&object(before.value)&&!localToolStateEqual(before.value,packed)){
  const rest=(v:object)=>Object.fromEntries(Object.entries(v).filter(([key])=>key!=='richBindings'));
  if(localToolStateEqual(rest(before.value),rest(view))){try{if(localToolStateEqual(readValidSnapshot(r,before.value),view))return;}catch{/* Invalid retained versions remain retained; author the checked current snapshot. */}}
 }
 r.valid.set('view',packed);
}
function checkBindings(r:Roots,view:ValidView,plainChecks?:PlainBindingChecks,richChecks?:RichBindingChecks):void {
 if(!object(view.data)||!object(view.bindings))throw Error('local_tool_convergence_bindings_invalid');checkRichBindings(r,view,richChecks);
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
function checkRichBindings(r:Roots,view:ValidView,checks?:RichBindingChecks):void {
 const bindings=view.richBindings??{};
 const structure=view.blockBindings??{};if(!object(structure)||Object.keys(structure).some(field=>!blockField(r,field)))throw Error('local_tool_blocks_bindings_invalid');
 if(Object.keys(bindings).some(field=>r.codec.fields[field]?.kind!=='rich'))throw Error('local_tool_rich_bindings_invalid');
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(descriptor.kind==='rich'){
  const data=(view.data as ObjectData)[field];if(data===undefined){if(Object.hasOwn(bindings,field)||Object.hasOwn(structure,field))throw Error('local_tool_rich_bindings_invalid');continue;}
  if(blockField(r,field))blocks(r,field).check(data as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings);const leaves=leafData(r,field,data);if(!bindings[field])throw Error('local_tool_rich_bindings_invalid');
  if(checks){let check=checks.get(field);if(!check){check=r.rich(field).bindingValidator();checks.set(field,check);}check({data:leaves,bindings:bindings[field]});}
  else r.rich(field).checkBindings({data:leaves,bindings:bindings[field]});
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
 const plainChecks:PlainBindingChecks=new Map(),richChecks:RichBindingChecks=new Map();
 const version=r.registers.winner('authored-valid-snapshot','view',version=>{
  if(!version.present||!object(version.value)||!accepts(contract,(version.value as unknown as ValidView).data))return false;
  try{checkBindings(r,readValidSnapshot(r,version.value),plainChecks,richChecks);return true;}catch{return false;}
 });
 if(!version)throw Error('local_tool_convergence_valid_snapshot_invalid');return clone(readValidSnapshot(r,version.value));
}
function inspect<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>):LocalToolConvergenceView<T> {
 const raw=projection(r);if(accepts(contract,raw.data))return{data:raw.data as T,conflict:null};
 const fallback=validFallback(r,contract);
 return{data:clone(fallback.data) as T,conflict:{kind:'validation',policy:'authored-valid-snapshot/1',validationId:contract.validationId,rawFingerprint:convergenceHash(raw.data),raw:clone(raw.data)}};
}
function currentBindings(r:Roots,contract:LocalToolConvergenceContract):Bindings {
 const raw=projection(r);return clone(accepts(contract,raw.data)?raw.bindings:validFallback(r,contract).bindings);
}
type SnapshotBindingProofs={context?:string;valid:Map<string,string>};
function semanticPending(r:Roots,proofs?:SnapshotBindingProofs):boolean {
 if(r.registers.pending())return true;
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(descriptor.kind==='rich'&&(r.rich(field).pending()||blockField(r,field)&&blocks(r,field).pending()))return true;
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(isLocalToolPlainField(descriptor)&&r.plain(field).pending())return true;
 let valid:Map<string,string>|undefined;
 if(proofs){
  try{const context=convergenceCanonical(r.codec);if(proofs.context!==context){proofs.valid.clear();proofs.context=context;}valid=proofs.valid;}
  catch{proofs.valid.clear();proofs.context=undefined;}
 }
 const plainChecks:PlainBindingChecks=new Map(),richChecks:RichBindingChecks=new Map();
 for(const version of r.registers.entries('authored-valid-snapshot'))if(version.present){
  const encoded=valid?r.registers.versions.inner.get(version.id):undefined;
  if(typeof encoded==='string'&&valid?.get(version.id)===encoded)continue;
  try{checkBindings(r,readValidSnapshot(r,version.value),plainChecks,richChecks);if(typeof encoded==='string')valid?.set(version.id,encoded);}catch{return true;}
 }
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
 const r=initializeRoots(doc,metadata.codec),bindings:Bindings={},plainBindings:PlainBindings={},richBindings:Record<string,RichBindings>={},plainFields=Object.keys(metadata.codec.fields).filter(field=>isLocalToolPlainField(metadata.codec.fields[field])).sort();
 doc.transact(()=>{
  new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).set('value',clone(identity));r.registers.begin();
  if(plainFields.length)new JsonMap<string[]>(doc.getMap('plain-fields')).set('value',plainFields);const richFields=Object.keys(metadata.codec.fields).filter(f=>metadata.codec.fields[f].kind==='rich').sort();if(richFields.length)new JsonMap<string[]>(doc.getMap('rich-fields')).set('value',richFields);const linkFields=richFields.filter(f=>localToolRichLinks(metadata.codec.fields[f]));if(linkFields.length)new JsonMap<string[]>(doc.getMap('rich-link-fields')).set('value',linkFields);const blockFields=richFields.filter(f=>blockField(r,f));if(blockFields.length)new JsonMap<string[]>(doc.getMap('block-fields')).set('value',blockFields);
  for(const[field,value]of Object.entries(data as ObjectData)){
   const descriptor=metadata.codec.fields[field];
   if(descriptor?.kind==='rich'){const draft=r.rich(field).draft();const leaves=leafData(r,field,value);draft.replace(leaves);if(blockField(r,field))blocks(r,field).seed(value as unknown as RichBlockDocument);const plan=draft.finish();r.rich(field).commit(plan);r.presence.set(field,true);richBindings[field]=plan.view.bindings;}else if(isLocalToolPlainField(descriptor)){
    const draft=r.plain(field).draft({text:'',bindings:[]});draft.replace(value as string);const plan=draft.finish();r.plain(field).commit(plan);r.presence.set(field,true);plainBindings[field]=plan.view.bindings;
   }else if(descriptor?.kind==='map'){
    r.presence.set(field,true);for(const[key,item]of Object.entries(value as ObjectData))r.map(field).set(key,clone(item));
   }else if(descriptor?.kind==='list'){
    r.presence.set(field,true);const list=r.list(field);bindings[field]=[];
    for(const item of value as ObjectData[]){const id=item[descriptor.idKey] as string,placementId=crypto.randomUUID();list.content.set(id,clone(item));list.membership.set(id,true);list.selected.set(id,placementId);list.order.push([{id,placementId}]);bind(bindings[field],id,placementId);}
   }else r.scalar.set(field,clone(value));
  }
  writeValidSnapshot(r,Object.keys(metadata.codec.fields).some(field=>blockField(r,field))?projectRoots(r):{data:clone(data),bindings,...(Object.keys(richBindings).length?{richBindings}:{}),...(plainFields.length?{plainBindings}:{})});r.registers.flush();
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
function prepareLegacyActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string,validateProposal=true):{actions:ReadyAction[];proposal:T;bindings:Bindings;changed:boolean} {
 const before=inspect(r,contract).data,{data:proposal}=mergeLocalToolActions(contract.codec,before,before,actions);
 if(validateProposal&&!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
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
function blockFields(doc:Y.Doc):string[]{
 const fields=new JsonMap<string[]>(doc.getMap('block-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string')||new Set(fields).size!==fields.length)throw Error('local_tool_blocks_fields_invalid');return fields;
}
function checkPlainDocument(r:Roots,doc:Y.Doc):void {
 const expected=Object.keys(r.codec.fields).filter(field=>isLocalToolPlainField(r.codec.fields[field])).sort();
 if(convergenceCanonical(plainFields(doc))!==convergenceCanonical(expected))throw Error('local_tool_plain_fields_invalid');
 for(const field of expected)r.plain(field).validate();
 const rich=Object.keys(r.codec.fields).filter(field=>r.codec.fields[field].kind==='rich').sort(),stored=new JsonMap<string[]>(doc.getMap('rich-fields')).get('value')??[];
 const linkFields=rich.filter(field=>localToolRichLinks(r.codec.fields[field])),storedLinks=new JsonMap<string[]>(doc.getMap('rich-link-fields')).get('value')??[];if(convergenceCanonical(linkFields)!==convergenceCanonical(storedLinks))throw Error('local_tool_rich_links_fields_invalid');
 if(convergenceCanonical(rich)!==convergenceCanonical(stored))throw Error('local_tool_rich_fields_invalid');
 const expectedBlocks=rich.filter(f=>blockField(r,f));if(convergenceCanonical(blockFields(doc))!==convergenceCanonical(expectedBlocks))throw Error('local_tool_blocks_fields_invalid');for(const field of rich){r.rich(field).pending();if(blockField(r,field))blocks(r,field).pending();}
}
function preparePlainActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string,identity:LocalToolConvergenceIdentity,baseline?:T,validateProposal=true):ActionPlan<T> {
 const initial=admitted(r,contract),before=initial.data as T;
 if(!Object.values(r.codec.fields).some(isLocalToolPlainField)){
  if(baseline!==undefined)mergeLocalToolActions(contract.codec,baseline,before,actions);return prepareLegacyActions(r,contract,actions,authorId,validateProposal);
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
 if(validateProposal&&!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const plainPlans=Object.fromEntries([...drafts].map(([field,value])=>[field,value.finish()]));
 const nonPlain=generic.filter(action=>!isLocalToolPlainField(contract.codec.fields[action.field])),raw=projection(r).data;
 let rawChanged=false;if(nonPlain.length){try{rawChanged=!localToolStateEqual(raw,mergeLocalToolActions(contract.codec,raw,raw,nonPlain).data);}catch{rawChanged=true;}}
 return{actions:prepared,proposal:proposal as T,bindings,plainBindings,plainPlans,plainPresence,changed:!localToolStateEqual(before,proposal)||Object.values(plainPlans).some(plan=>plan.changed)||rawChanged};
}
function validateRichCapture<T extends LocalToolJson>(r:Roots,doc:Y.Doc,contract:LocalToolConvergenceContract<T>,identity:LocalToolConvergenceIdentity,action:RichAction):RichSpan[]|undefined {
 if(action.type!=='rich-text-splice'&&action.type!=='rich-link'&&action.type!=='rich-mark'&&action.type!=='rich-split'&&action.type!=='rich-join')return;
 const capture=action.type==='rich-text-splice'||action.type==='rich-mark'||action.type==='rich-link'?action.range:action.capture;
 const range=capture.format==='writers-hoard-rich-split/1'?capture.range:capture.format==='writers-hoard-rich-range/1'?capture:undefined;
 const capturedIdentity=range?.identity??(capture as RichJoinCapture).identity,field=range?.field??(capture as RichJoinCapture).field,frontier=range?.frontier??(capture as RichJoinCapture).frontier;
 assertConvergenceIdentity(capturedIdentity,identity);if(field!==action.field||!Array.isArray(frontier))throw Error('local_tool_rich_capture_invalid');
 return r.registers.atFrontier(frontier,registers=>{
  const historical=roots(doc,contract.codec,registers),view=admitted(historical,contract),data=(view.data as ObjectData)[field],bindings=view.richBindings?.[field];
  const leaves=leafData(historical,field,data);if(!bindings)throw Error('local_tool_rich_capture_invalid');const admittedRich={data:leaves,bindings},rich=historical.rich(field);let expected:RichRange|RichSplitCapture|RichJoinCapture;
  if(range){
   const node=bindings.nodes.find(n=>n.id===range.nodeId);if(!node)throw Error('local_tool_rich_capture_invalid');
   const from=range.right===null?node.units.length:node.units.findIndex(u=>u.id===range.right);if(from<0||range.left!==(node.units[from-1]?.id??null)||!Array.isArray(range.deleteIds))throw Error('local_tool_rich_capture_invalid');
   expected=capture.format==='writers-hoard-rich-split/1'?rich.splitCapture(identity,range.nodeId,from,range.affinity,admittedRich):rich.range(identity,range.nodeId,from,from+range.deleteIds.length,range.affinity,admittedRich);
  }else{const join=capture as RichJoinCapture;expected=rich.joinCapture(identity,join.leftNodeId,join.rightNodeId,admittedRich);}
  if(convergenceCanonical(expected)!==convergenceCanonical(capture))throw Error('local_tool_rich_capture_invalid');
  if(capture.format==='writers-hoard-rich-split/1'||capture.format==='writers-hoard-rich-join/1'){
   return fieldRichExclusions(historical,contract,field,rich,bindings,capture.format==='writers-hoard-rich-split/1'?capture.suffix:capture.slices);
  }
 });
}

function fieldRichExclusions(historical:Roots,contract:LocalToolConvergenceContract,field:string,rich:RichRuns,bindings:RichBindings,slices:readonly {ids:string[]}[]):RichSpan[]{
   const observed=new Set(bindings.nodes.flatMap(n=>n.units.map(u=>u.id))),check=rich.bindingValidator();
   // These are witnesses of THIS FIELD under accepted data, not global fallbacks.
   // atFrontier excludes future versions; entries includes retained inactive ones.
   for(const version of historical.registers.entries('authored-valid-snapshot','view')){
    if(!version.present||!object(version.value)||!accepts(contract,(version.value as unknown as ValidView).data))continue;
    try{
     const stored=version.value as unknown as StoredValidView,value=(stored.data as ObjectData)[field];if(blockField(historical,field))blocks(historical,field).check(value as unknown as RichBlockDocument,stored.blockBindings?.[field] as RichBlockBindings);const leaves=leafData(historical,field,value);
     const prepared=readRichSnapshot(rich,leaves,stored.richBindings?.[field]),witness={data:leaves,bindings:prepared.read()};check(witness);
     for(const node of witness.bindings.nodes)for(const unit of node.units)observed.add(unit.id);
    }catch{/* Unverifiable field witnesses establish no observation. */}
   }
   return richExclusions(observed,new Set(slices.flatMap(slice=>slice.ids)));
}

function validateBlockCapture(r:Roots,contract:LocalToolConvergenceContract,identity:LocalToolConvergenceIdentity,action:Exclude<RichBlockAction,RichBlockTextAction>):void {
 const capture=action.capture;assertConvergenceIdentity(capture.identity,identity);if(capture.field!==action.field||!Array.isArray(capture.frontier))throw Error('local_tool_blocks_capture_invalid');
 r.registers.atFrontier(capture.frontier,registers=>{
  const historical=roots(r.registers.doc,contract.codec,registers),view=admitted(historical,contract),data=(view.data as ObjectData)[action.field] as unknown as RichBlockDocument,binding=view.blockBindings?.[action.field];
  if(!blockField(historical,action.field)||!binding)throw Error('local_tool_blocks_capture_invalid');const source=blocks(historical,action.field);
  const expected=action.type==='rich-block-exit-empty-item'?captureBlockEmptyItem(source,historical.rich(action.field),identity,data,binding,view.richBindings![action.field],action.capture.frame.leafId):isBlockEditingAction(action)?captureBlockEdit(source,identity,data,binding,action.capture.nodeIds,action.capture.destination):action.type==='rich-block-wrap'?source.capture(identity,data,binding,action.capture.nodeIds):source.moveCapture(identity,data,binding,action.capture.nodeId,action.capture.destination);
  if(convergenceCanonical(expected)!==convergenceCanonical(capture))throw Error('local_tool_blocks_capture_invalid');
 });
}


function validateTreeTextAction(r:Roots,contract:LocalToolConvergenceContract,identity:LocalToolConvergenceIdentity,action:RichBlockTextAction):RichSpan[]{
 assertConvergenceIdentity(action.capture.identity,identity);if(action.capture.field!==action.field||!blockField(r,action.field))throw Error('local_tool_blocks_capture_invalid');
 return r.registers.atFrontier(action.capture.frontier,registers=>{const historical=roots(r.registers.doc,contract.codec,registers),view=admitted(historical,contract),field=action.field,data=(view.data as ObjectData)[field] as unknown as RichBlockDocument,binding=view.blockBindings?.[field],text=view.richBindings?.[field];if(!binding||!text)throw Error('local_tool_blocks_capture_invalid');const rich=historical.rich(field);validateBlockTextCapture(blocks(historical,field),rich,identity,data,binding,text,action);return fieldRichExclusions(historical,contract,field,rich,text,action.type==='rich-block-split'?action.capture.text.suffix:action.capture.text.slices);});
}


function prepareActions<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,actions:readonly LocalToolStateAction[],authorId:string,identity:LocalToolConvergenceIdentity,baseline?:T):ActionPlan<T> {
 if(!Object.values(r.codec.fields).some(f=>f.kind==='rich'))return preparePlainActions(r,contract,actions,authorId,identity,baseline);
 if(!Array.isArray(actions)||!actions.length)throw Error('local_tool_actions_invalid');
 const before=admitted(r,contract),touchedRich=new Set<string>(),generic=actions.filter(a=>{const field=a.field;if(r.codec.fields[field]?.kind==='rich'){touchedRich.add(field);return false;}return true;});
 const base:ActionPlan<T>=generic.length?preparePlainActions(r,contract,generic,authorId,identity,baseline,false):{actions:[],proposal:clone(before.data) as T,bindings:clone(before.bindings),plainBindings:clone(before.plainBindings??{}),plainPlans:{},changed:false};
 const proposal=clone(base.proposal) as ObjectData,richBindings=clone(Object.fromEntries(Object.entries(before.richBindings??{}).filter(([field])=>!touchedRich.has(field)))),blockBindings=clone(before.blockBindings??{}),blockPlans:Record<string,RichBlockPlan>={},richPlans:Record<string,RichPlan>={},richPresence:Record<string,boolean>={};
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(descriptor.kind==='rich'){
  const own=actions.filter(a=>a.field===field);if(!own.length)continue;const old=(before.data as ObjectData)[field],binding=before.richBindings?.[field];const isBlocks=blockField(r,field);const draft=r.rich(field).draft(old!==undefined&&binding?{data:leafData(r,field,old),bindings:binding}:undefined);let present=typeof proposal[field]!=='undefined',structure=(isBlocks&&old!==undefined?clone(old):old) as unknown as RichBlockDocument;
  for(const action of own){
   if(action.type==='rich-block-split'||action.type==='rich-block-join'){
    if(!isBlocks||!present)throw Error('local_tool_blocks_action_invalid');const excludes=validateTreeTextAction(r,contract,identity,action),plan=prepareBlockText(blocks(r,field),structure,blockBindings[field],action);draft.apply(plan.textAction,identity,excludes);if(blockPlans[field])plan.writes=[...blockPlans[field].writes,...plan.writes];blockPlans[field]=plan;structure=plan.data;blockBindings[field]=plan.bindings;
    }else if(action.type==='rich-block-exit-empty-item'){
     if(!isBlocks||!present)throw Error('local_tool_blocks_action_invalid');validateBlockCapture(r,contract,identity,action);const plan=prepareBlockExit(blocks(r,field),structure,blockBindings[field],draft.finish().view.bindings,action);if(blockPlans[field])plan.writes=[...blockPlans[field].writes,...plan.writes];blockPlans[field]=plan;structure=plan.data;blockBindings[field]=plan.bindings;
    }else if(action.type==='rich-block-wrap'||action.type==='rich-block-move'||isBlockEditingAction(action)){
    if(!isBlocks||!present)throw Error('local_tool_blocks_action_invalid');validateBlockCapture(r,contract,identity,action);const plan=isBlockEditingAction(action)?prepareBlockEdit(blocks(r,field),structure,blockBindings[field],action,identity,draft.finish().view.bindings.nodes.at(-1)?.id??null):blocks(r,field).prepare(structure,blockBindings[field],action,identity);if('textActions'in plan)for(const textAction of plan.textActions as RichAction[])draft.apply(textAction,identity);if(blockPlans[field])plan.writes=[...blockPlans[field].writes,...plan.writes];blockPlans[field]=plan;structure=plan.data;blockBindings[field]=plan.bindings;
   }else if(action.type==='set'||action.type==='unset'){
    if(isBlocks)throw Error('local_tool_blocks_structural_actions_required');
    if(baseline!==undefined&&!localToolStateEqual((baseline as ObjectData)[field],(before.data as ObjectData)[field]))throw Error('conflict');
    const value=action.type==='set'?action.value:undefined;if(value!==undefined)validateRichDocument(value,localToolRichLinks(r.codec.fields[field]));if(value===undefined&&!present||value!==undefined&&present&&localToolStateEqual(draft.finish().view.data,value))continue;draft.replace(value);present=value!==undefined;
   }else{if(!present||!action.type.startsWith('rich-'))throw Error('local_tool_rich_action_invalid');if(isBlocks&&action.type!=='rich-text-splice'&&action.type!=='rich-mark'&&action.type!=='rich-link')throw Error('local_tool_blocks_structural_actions_required');const excludes=validateRichCapture(r,r.rich(field).doc,contract,identity,action as RichAction);draft.apply(action as RichAction,identity,excludes);}
  }
  const plan=draft.finish();touchedRich.delete(field);richPlans[field]=plan;richPresence[field]=present;if(present){
   if(isBlocks){const leaves=new Map(plan.view.data.content.map(p=>[p.id,p]));for(const b of structure.blocks)if(Object.hasOwn(b,'content'))b.content=clone(leaves.get(b.id)?.content??[]);proposal[field]=structure as unknown as LocalToolJson;richBindings[field]={nodes:richBlockLeaves(structure,localToolRichLinks(r.codec.fields[field])).content.map(p=>plan.view.bindings.nodes.find(n=>n.id===p.id)!)};}
   else{proposal[field]=plan.view.data as unknown as LocalToolJson;richBindings[field]=plan.view.bindings;}
  }else{delete proposal[field];delete richBindings[field];delete blockBindings[field];}
 }
 // A field observed by the initial partition need not be rebuilt after callbacks.
 for(const field of touchedRich)if(Object.hasOwn(before.richBindings??{},field))richBindings[field]=clone(before.richBindings![field]);
 if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 return{...base,proposal:proposal as T,plainPlans:base.plainPlans??{},richPlans,richPresence,richBindings,blockPlans,blockBindings,changed:base.changed||!localToolStateEqual(before.data,proposal)||Object.values(richPlans).some(p=>p.changed)||Object.values(blockPlans).some(p=>p.writes.length>0)};
}
function commitRich(r:Roots,plan:{richPlans?:Record<string,RichPlan>;richPresence?:Record<string,boolean>;blockPlans?:Record<string,RichBlockPlan>}):void {
 for(const[field,value]of Object.entries(plan.richPlans??{}))r.rich(field).commit(value);
 for(const[field,value]of Object.entries(plan.blockPlans??{}))blocks(r,field).commit(value);
 for(const[field,value]of Object.entries(plan.richPresence??{}))r.presence.set(field,value);
}


function commitPlain(r:Roots,plan:{plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>;richPlans?:Record<string,RichPlan>;richPresence?:Record<string,boolean>}):void {
 for(const[field,value]of Object.entries(plan.plainPlans??{}))r.plain(field).commit(value);
 for(const[field,present]of Object.entries(plan.plainPresence??{}))r.presence.set(field,present);
}
function mutateActions(r:Roots,plan:ActionPlan<LocalToolJson>):void {
 if(!plan.plainPlans){mutate(r,plan.actions);return;}
 mutate(r,plan.actions.filter(action=>action.type!=='text-splice'&&!isLocalToolPlainField(r.codec.fields[action.field])&&r.codec.fields[action.field]?.kind!=='rich'));commitPlain(r,plan);commitRich(r,plan);
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
function authorFallback<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,proposal:T,bindings:Bindings,plainBindings?:PlainBindings,richBindings?:Record<string,RichBindings>,blockBindings?:Record<string,RichBlockBindings>):void {
 const raw=projection(r);const fallback=accepts(contract,raw.data)?raw:{data:clone(proposal),bindings:clone(bindings),...(plainBindings?{plainBindings:clone(plainBindings)}:{}),...(richBindings?{richBindings:clone(richBindings)}:{}),...(blockBindings?{blockBindings:clone(blockBindings)}:{})};checkBindings(r,fallback);writeValidSnapshot(r,fallback);
}


type ReplacementWrite={root:'scalar'|'presence'|'map'|'membership';field:string;key:string;present:boolean;value?:LocalToolJson};
interface ReplacementPlan<T extends LocalToolJson>{proposal:T;bindings:Bindings;writes:ReplacementWrite[];actions:ReadyAction[];changed:boolean;plainBindings?:PlainBindings;richBindings?:Record<string,RichBindings>;plainPlans?:Record<string,PlainPlan>;plainPresence?:Record<string,boolean>;richPlans?:Record<string,RichPlan>;richPresence?:Record<string,boolean>}
function prepareLegacyReplacement<T extends LocalToolJson>(r:Roots,contract:LocalToolConvergenceContract<T>,data:T,authorId:string):ReplacementPlan<T> {
 const proposal=cloneLocalToolJson(data);if(!accepts(contract,proposal))throw Error('local_tool_convergence_authored_state_invalid');
 const before=inspect(r,contract).data as ObjectData,next=proposal as ObjectData,bindings=currentBindings(r,contract),writes:ReplacementWrite[]=[],actions:ReadyAction[]=[];
 for(const field of new Set([...Object.keys(before),...Object.keys(next)])){
  const descriptor=contract.codec.fields[field],old=before[field],desired=next[field];if(descriptor?.kind==='rich'||isLocalToolPlainField(descriptor)||localToolStateEqual(old,desired))continue;
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
 const plan=prepareLegacyReplacement(r,contract,data,authorId);if(!Object.values(r.codec.fields).some(f=>f.kind==='rich'||isLocalToolPlainField(f)))return plan;
 const current=admitted(r,contract),plainBindings=clone(current.plainBindings??{}),plainPlans:Record<string,PlainPlan>={},plainPresence:Record<string,boolean>={},richBindings=clone(current.richBindings??{}),richPlans:Record<string,RichPlan>={},richPresence:Record<string,boolean>={};
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(isLocalToolPlainField(descriptor)){
  const old=(current.data as ObjectData)[field],desired=(data as ObjectData)[field];if(localToolStateEqual(old,desired))continue;
  const draft=r.plain(field).draft({text:typeof old==='string'?old:'',bindings:plainBindings[field]??[]});
  if(desired===undefined){draft.clear();delete plainBindings[field];}else{draft.replace(desired as string);plainBindings[field]=draft.view().bindings;}
  plainPlans[field]=draft.finish();plainPresence[field]=desired!==undefined;
 }
 for(const[field,descriptor]of Object.entries(r.codec.fields))if(descriptor.kind==='rich'){
  const old=(current.data as ObjectData)[field],desired=(data as ObjectData)[field];if(localToolStateEqual(old,desired))continue;
  if(blockField(r,field))throw Error('local_tool_blocks_structural_actions_required');if(desired!==undefined)validateRichDocument(desired,localToolRichLinks(r.codec.fields[field]));const draft=r.rich(field).draft();draft.replace(desired);const prepared=draft.finish();richPlans[field]=prepared;richPresence[field]=desired!==undefined;
  if(desired===undefined)delete richBindings[field];else richBindings[field]=prepared.view.bindings;
 }
 return{...plan,plainBindings,plainPlans,plainPresence,richBindings,richPlans,richPresence};
}
function mutateReplacement(r:Roots,plan:ReplacementPlan<LocalToolJson>):void {
 for(const write of plan.writes){const target=write.root==='scalar'?r.scalar:write.root==='presence'?r.presence:write.root==='membership'?r.list(write.field).membership:r.map(write.field);
  if(write.present)target.set(write.key,clone(write.value) as never);else target.delete(write.key);
 }
 mutate(r,plan.actions);commitPlain(r,plan);commitRich(r,plan);
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
 let closed=false,captured:Uint8Array[]|null=null,projectionEpoch:object={};
 // Successful intrinsic binding proofs belong only to this private replica.
 // They survive only ordinary rich splices, whose writer retains old metadata.
 // Missing/invalid proofs and mutable validation-policy results are never cached.
 const snapshotProofs:SnapshotBindingProofs={valid:new Map()};
 const invalidateSnapshotProofs=()=>{snapshotProofs.valid.clear();snapshotProofs.context=undefined;};
 const proofMetadataChanged=(transaction:Y.Transaction)=>{
  if(!snapshotProofs.valid.size)return;
  const addedVersions=new Set<string>(),addedActivations:string[]=[];
  for(const[type,events]of transaction.changedParentTypes){
   if(type instanceof Y.Map){
    for(const event of events)for(const[key,change]of event.changes.keys){
     if(change.action!=='add'){invalidateSnapshotProofs();return;}
     if(type===r.registers.versions.inner)addedVersions.add(key);
     if(type===r.registers.activations.inner)addedActivations.push(key);
    }
   }else if(!(type instanceof Y.Array)||events.some(event=>event.changes.delta.some(part=>'delete'in part&&Number(part.delete)>0))){invalidateSnapshotProofs();return;}
  }
  // Fresh UUIDs are not assumed: same-key metadata or old activation changes
  // can invalidate historical provenance even when the snapshot bytes match.
  for(const id of addedVersions){const v=r.registers.versions.get(id);if(v&&/^rich3:.*:(routing|marks)$/.test(v.root)&&r.registers.entries(v.root,v.key).some(prior=>!addedVersions.has(prior.id))){invalidateSnapshotProofs();return;}}
  for(const id of addedActivations){const a=r.registers.activations.get(id);if(a&&!addedVersions.has(a.versionId)){invalidateSnapshotProofs();return;}}
 };
 doc.on('afterTransaction',proofMetadataChanged);
 const current=()=>{if(closed)throw Error('local_tool_convergence_destroyed');};
 const onUpdate=(update:Uint8Array)=>{captured?.push(update);};doc.on('update',onUpdate);
 try{
  Y.applyUpdate(doc,convergenceBytes(checkpoint.checkpointBase64));checkDocumentIdentity(doc,identity);r.registers.validate();checkPlainDocument(r,doc);
  if(convergenceBase64(Y.encodeStateVector(doc))!==checkpoint.stateVectorBase64)throw Error('local_tool_convergence_vector_invalid');inspect(r,contract);
  if(restore){validateLocalToolConvergenceReceipt(restore);assertConvergenceIdentity(restore.identity,identity);recipeRecord(restore,r);receipts.set(restore.id,clone(restore));(restore.mode==='undo'?undo:redo).push(restore.id);}
 }catch(error){doc.destroy();throw error;}
 // One private RAW image may survive quiet reads; policy, fallback and binding
 // validation still run on every call. No historical Roots share this reader.
 let cachedRaw:ValidView|undefined,rawEpoch:object|undefined,rawContext:string|undefined;
 const invalidateRaw=()=>{cachedRaw=undefined;rawEpoch=undefined;rawContext=undefined;projectionEpoch={};};
 doc.on('afterTransaction',invalidateRaw);
 r.projectionReader=()=>{
  // A validator method can alter this.codec. Non-JSON context disables reuse.
  let signature:string;try{signature=convergenceCanonical(r.codec);}catch{invalidateRaw();return projectRoots(r);}
  if(!cachedRaw||rawEpoch!==projectionEpoch||rawContext!==signature){const started=projectionEpoch,value=projectRoots(r);if(started!==projectionEpoch){invalidateRaw();return value;}cachedRaw=value;rawEpoch=started;rawContext=signature;}
  return cachedRaw;
 };
 const projectionMutation=<R>(run:()=>R):R=>{projectionEpoch={};try{return run();}finally{projectionEpoch={};}};
 const view=()=>{current();return inspect(r,contract);};
 const currentCheckpoint=()=>{current();return capsule(identity,doc);};
 const before=()=>({data:view().data,checkpoint:currentCheckpoint()});
 const result=(baseline:ReturnType<typeof before>):LocalToolConvergenceChange<T>=>({...clone(view()),changed:!localToolStateEqual(baseline.data,view().data),causalChanged:baseline.checkpoint.checkpointBase64!==currentCheckpoint().checkpointBase64,pending:pending(doc)||semanticPending(r,snapshotProofs)});
 const storeReceipt=(mode:'undo'|'redo',changes:Toggle[]):LocalToolConvergenceReceipt|null=>{
  if(!changes.length)return null;const id=options.authorId+':receipt:'+crypto.randomUUID(),heads=new Set(r.registers.transactions.keys());for(const tx of r.registers.transactions.values())for(const parent of tx.parents)heads.delete(parent);
  const receipt:LocalToolConvergenceReceipt={format:'writers-hoard-local-convergence-receipt/1',id,identity:clone(identity),mode,record:{format:'register-activation/1',changes:clone(changes),frontier:[...heads]} as unknown as LocalToolJson};receipts.set(id,receipt);(mode==='undo'?undo:redo).push(id);return receipt;
 };
 function author(plan:{proposal:T;bindings:Bindings;plainBindings?:PlainBindings;richBindings?:Record<string,RichBindings>;blockBindings?:Record<string,RichBlockBindings>;changed:boolean},mutations:()=>void):LocalToolReplicaEdit<T> {
  const baseline=before();if(!plan.changed)return{...result(baseline),update:packet(identity,Y.mergeUpdates([])),receiptId:null};
  captured=[];let ids:string[]=[];
  try{
   projectionMutation(()=>doc.transact(()=>{r.registers.begin();mutations();authorFallback(r,contract,plan.proposal,plan.bindings,plan.plainBindings,plan.richBindings,plan.blockBindings);ids=r.registers.flush();},options.authorId));
   for(const id of redo)receipts.delete(id);redo.length=0;const receipt=storeReceipt('undo',ids.map(id=>({id,enabled:false})));
   return{...result(baseline),update:packet(identity,Y.mergeUpdates(captured)),receiptId:receipt?.id??null};
  }finally{r.registers.cancel();captured=null;}
 }
 function reverse(id:string,isRedo:boolean):LocalToolReplicaEdit<T> {
  current();invalidateSnapshotProofs();projectionEpoch={};const from=isRedo?redo:undo,receipt=receipts.get(id);if(from.at(-1)!==id||!receipt)throw Error('local_tool_convergence_receipt_unavailable');
  const record=recipeRecord(receipt,r),baseline=before();captured=[];let inverse:Toggle[]=[];
  if(record.changes.some(change=>r.registers.versions.get(change.id)?.root.startsWith('blocks3:'))){
   // Structural inverses may retain derived ancestor/required-slot support.
   // Prepare the actual UUID-bearing delta, never mutate then validate or
   // regenerate a different toggle transaction when committing the result.
   captured=null;const epoch=projectionEpoch,context=convergenceCanonical([contract.namespace,contract.validationId,contract.schemaEpoch,contract.codec]),validator=contract.validateState;
   const admissionRequired=record.changes.some(change=>{const version=r.registers.versions.get(change.id);return version?.root.startsWith('blocks3:')&&version.root.endsWith(':membership')&&version.value===true;});
   const candidate=new Y.Doc({gc:false}),updates:Uint8Array[]=[];let prepared:LocalToolConvergenceView<T>,bytes:Uint8Array,unresolved=false;
   try{
    const reader=initializeRoots(candidate,contract.codec);Y.applyUpdate(candidate,convergenceBytes(baseline.checkpoint.checkpointBase64));candidate.on('update',update=>updates.push(update));
    candidate.transact(()=>{inverse=reader.registers.toggle(record.changes);},options.authorId);
    reader.registers.validate();checkPlainDocument(reader,candidate);prepared=inspect(reader,contract);
    unresolved=pending(candidate)||semanticPending(reader);
    if(admissionRequired&&(prepared.conflict||unresolved))throw Error('local_tool_convergence_authored_state_invalid');
    // Existing movement Undo/Redo can intentionally restore a concurrent cycle.
    // Preserve its explicit conflict/fallback contract rather than hiding it or
    // turning that established operation into a new rejection.
    if(!prepared.conflict)checkBindings(reader,projection(reader));bytes=Y.mergeUpdates(updates);
   }finally{candidate.destroy();}
   current();
   if(epoch!==projectionEpoch||from.at(-1)!==id||receipts.get(id)!==receipt||currentCheckpoint().checkpointBase64!==baseline.checkpoint.checkpointBase64||validator!==contract.validateState||context!==convergenceCanonical([contract.namespace,contract.validationId,contract.schemaEpoch,contract.codec]))throw Error('local_tool_convergence_preparation_stale');
   projectionMutation(()=>Y.applyUpdate(doc,bytes!,options.authorId));from.pop();receipts.delete(id);
   const next=storeReceipt(isRedo?'undo':'redo',inverse);
   // No second validator callback after commit: the admitted candidate is the
   // exact committed cut. A reentrant policy cannot invalidate it after writes.
   return{...clone(prepared!),changed:!localToolStateEqual(baseline.data,prepared!.data),causalChanged:baseline.checkpoint.checkpointBase64!==currentCheckpoint().checkpointBase64,pending:unresolved,update:packet(identity,bytes!),receiptId:next?.id??null};
  }
  try{
   projectionMutation(()=>doc.transact(()=>{inverse=r.registers.toggle(record.changes);},options.authorId));from.pop();receipts.delete(id);
   const next=storeReceipt(isRedo?'undo':'redo',inverse);return{...result(baseline),update:packet(identity,Y.mergeUpdates(captured)),receiptId:next?.id??null};
  }finally{captured=null;}
 }
 const applyObserved=(actions:readonly LocalToolStateAction[],baseline?:T)=>{current();if(Array.isArray(actions))actions=actions.map(action=>{
   const descriptor=Object.getOwnPropertyDescriptor(action,'type');if(!descriptor||!('value'in descriptor))throw Error('local_tool_convergence_format_invalid');
   const inline=['rich-text-splice','rich-insert-paragraph','rich-block-insert'].includes(descriptor.value);
   if(inline&&'link'in action&&!Object.hasOwn(action,'link'))throw Error('local_tool_convergence_format_invalid');
   return descriptor.value==='rich-link'||inline&&Object.hasOwn(action,'link')?clone(action):action;
  });if(!Array.isArray(actions)||!actions.length||actions.some(action=>action.type!=='rich-text-splice'))invalidateSnapshotProofs();projectionEpoch={};const plan=prepareActions(r,contract,actions,options.authorId,identity,baseline);return author(plan,()=>mutateActions(r,plan));};
 const textRange=(field:string,from:number,to:number):LocalToolPlainRange=>{
  current();if(!['2','3','4'].includes(identity.engine.version)||!isLocalToolPlainField(contract.codec.fields[field]))throw Error('local_tool_plain_range_invalid');const view=admitted(r,contract),text=(view.data as ObjectData)[field];
  if(typeof text!=='string')throw Error('local_tool_plain_range_invalid');return{format:'writers-hoard-local-plain-range/1',identity:clone(identity),field,...r.plain(field).range({text,bindings:view.plainBindings?.[field]??[]},from,to)};
 };
 const rich=(field:string)=>{current();if(!['3','4'].includes(identity.engine.version)||contract.codec.fields[field]?.kind!=='rich')throw Error('local_tool_rich_field_invalid');return r.rich(field);};
 const richView=(field:string)=>{const view=admitted(r,contract),data=leafData(r,field,(view.data as ObjectData)[field]),bindings=view.richBindings?.[field];if(!bindings)throw Error('local_tool_rich_bindings_invalid');return{data,bindings};};
 const replica:LocalToolReplica<T>=Object.freeze({
  richBlockEmptyItemCapture:(field:string,nodeId:string)=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return captureBlockEmptyItem(blocks(r,field),r.rich(field),identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings![field],view.richBindings![field],nodeId);},
  richBlockSplitCapture:(field:string,nodeId:string,at:number)=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return captureBlockSplit(blocks(r,field),r.rich(field),identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings![field],view.richBindings![field],nodeId,at);},
  richBlockJoinCapture:(field:string,leftNodeId:string,rightNodeId:string)=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return captureBlockJoin(blocks(r,field),r.rich(field),identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings![field],view.richBindings![field],leftNodeId,rightNodeId);},
  richBlockEditCapture:(field:string,nodeIds:string[],destination?:RichBlockPlacement)=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return captureBlockEdit(blocks(r,field),identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings,nodeIds,destination);},
  richBlockCapture:(field:string,options:{nodeIds:string[]})=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return blocks(r,field).capture(identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings,options.nodeIds);},
  richBlockMoveCapture:(field:string,nodeId:string,destination:RichBlockPlacement)=>{current();const view=admitted(r,contract);if(!blockField(r,field))throw Error('local_tool_blocks_field_invalid');return blocks(r,field).moveCapture(identity,(view.data as ObjectData)[field] as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings,nodeId,destination);},
  richRange:(field:string,nodeId:string,from:number,to:number,options?:{affinity:'left'|'right'})=>rich(field).range(identity,nodeId,from,to,options?.affinity,richView(field)),
  resolveRichPoint:(point:RichRange)=>{current();if(!point||!Array.isArray(point.deleteIds)||point.deleteIds.length)throw Error('local_tool_rich_point_invalid');validateRichCapture(r,doc,contract,identity,{type:'rich-mark',field:point.field,nodeId:point.nodeId,range:point,mark:'bold',enabled:true});return rich(point.field).resolvePoint(point,identity,richView(point.field));},
  richSplitCapture:(field:string,nodeId:string,at:number,options?:{affinity:'left'|'right'})=>rich(field).splitCapture(identity,nodeId,at,options?.affinity,richView(field)),
  richJoinCapture:(field:string,leftNodeId:string,rightNodeId:string)=>rich(field).joinCapture(identity,leftNodeId,rightNodeId,richView(field)),
  textRange,
  read:()=>clone(view().data),inspect:()=>clone(view()),checkpoint:currentCheckpoint,
  apply:applyObserved,
  undo:(id:string)=>reverse(id,false),redo:(id:string)=>reverse(id,true),
  receive(update:LocalToolConvergenceUpdate){
   current();invalidateSnapshotProofs();projectionEpoch={};validateLocalToolConvergenceUpdate(update);assertConvergenceIdentity(update,identity);const baseline=before(),bytes=convergenceBytes(update.updateBase64);
   // Validate a full candidate first. Invalid JSON/graph/bindings must not partially change this instance.
   const candidate=new Y.Doc({gc:false});try{const candidateRoots=initializeRoots(candidate,contract.codec);Y.applyUpdate(candidate,convergenceBytes(baseline.checkpoint.checkpointBase64));Y.applyUpdate(candidate,bytes);checkDocumentIdentity(candidate,identity);candidateRoots.registers.validate();checkPlainDocument(candidateRoots,candidate);inspect(candidateRoots,contract);}finally{candidate.destroy();}
   projectionMutation(()=>Y.applyUpdate(doc,bytes));return result(baseline);
  },
  export(stateVectorBase64?:string){current();return packet(identity,Y.encodeStateAsUpdate(doc,stateVectorBase64===undefined?undefined:convergenceBytes(stateVectorBase64)));},
  destroy(){if(!closed){invalidateSnapshotProofs();invalidateRaw();r.projectionReader=undefined;closed=true;receipts.clear();undo.length=redo.length=0;doc.off('update',onUpdate);doc.off('afterTransaction',proofMetadataChanged);doc.off('afterTransaction',invalidateRaw);doc.destroy();}},
 });
 return{replica,applyObserved,
  receipt(id:string|null){current();if(id===null)return null;const receipt=receipts.get(id);if(!receipt)throw Error('local_tool_convergence_receipt_unavailable');return clone(receipt);},
  replace(data:T){current();invalidateSnapshotProofs();projectionEpoch={};const plan=prepareReplacement(r,contract,data,options.authorId);return author(plan,()=>mutateReplacement(r,plan));},
  pending(){current();return pending(doc)||semanticPending(r,snapshotProofs);},
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
  const registers=new Registers(doc);registers.validate();let semantic=registers.pending();const linkFields=new JsonMap<string[]>(doc.getMap('rich-link-fields')).get('value')??[];if(!Array.isArray(linkFields)||new Set(linkFields).size!==linkFields.length||linkFields.some(f=>typeof f!=='string')||linkFields.length&&identity.engine.version!=='4')throw Error('local_tool_rich_links_fields_invalid');const links=new Set(linkFields);const richFields=new JsonMap<string[]>(doc.getMap('rich-fields')).get('value')??[];if(!Array.isArray(richFields)||new Set(richFields).size!==richFields.length||richFields.some(f=>typeof f!=='string')||richFields.length&&!['3','4'].includes(identity.engine.version))throw Error('local_tool_rich_fields_invalid');if(linkFields.some(field=>!richFields.includes(field)))throw Error('local_tool_rich_links_fields_invalid');for(const field of richFields)if(new RichRuns(doc,field,registers,false,links.has(field)).pending())semantic=true;
  const richChecks:RichBindingChecks=new Map(),blockSet=new Set(blockFields(doc));for(const field of blockSet){if(!richFields.includes(field))throw Error('local_tool_blocks_fields_invalid');if(new RichBlocks(registers,field,links.has(field)).pending())semantic=true;}
  for(const version of registers.versions.values()){
   if(!version.present)continue;
   if(version.root.startsWith('selected:')&&!order(doc,version.root.slice('selected:'.length)).toArray().some(place=>place.placementId===version.value))semantic=true;
   if(version.root==='authored-valid-snapshot'){
    const view=version.value as unknown as StoredValidView;
    if(!view||!object(view.bindings))throw Error('local_tool_convergence_bindings_invalid');
    const batch=prepareRichSnapshotBatch(Object.entries(view.richBindings??{}),([field,bindings])=>{
     if(!richFields.includes(field))throw Error('local_tool_rich_bindings_invalid');
     try{const raw=(view.data as ObjectData)[field];if(blockSet.has(field))new RichBlocks(registers,field,links.has(field)).check(raw as unknown as RichBlockDocument,view.blockBindings?.[field] as RichBlockBindings);const data=blockSet.has(field)?richBlockLeaves(raw as unknown as RichBlockDocument,links.has(field)):raw;validateRichDocument(data,links.has(field));return readRichSnapshot(new RichRuns(doc,field,registers,false,links.has(field)),data,bindings);}catch{semantic=true;return null;}
    });
    for(const{value:[field],prepared}of batch){try{const raw=(view.data as ObjectData)[field],data=blockSet.has(field)?richBlockLeaves(raw as unknown as RichBlockDocument,links.has(field)):raw;validateRichDocument(data,links.has(field));let check=richChecks.get(field);if(!check){check=new RichRuns(doc,field,registers,false,links.has(field)).bindingValidator();richChecks.set(field,check);}check({data,bindings:prepared.read()});}catch{semantic=true;}}
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

/** Same readonly reconstruction as the plain capture, without granting receipt authority. */
export function captureLocalToolRich<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,request:import('./richTypes').RichCaptureRequest){
 const host=instantiate(checkpoint,options);try{const p=host.replica;const capture=request.kind==='block-empty-item'?p.richBlockEmptyItemCapture(request.field,request.nodeId):request.kind==='block-split'?p.richBlockSplitCapture(request.field,request.nodeId,request.at):request.kind==='block-join'?p.richBlockJoinCapture(request.field,request.leftNodeId,request.rightNodeId):request.kind==='block-edit'?p.richBlockEditCapture(request.field,request.nodeIds,request.destination):request.kind==='blocks'?p.richBlockCapture(request.field,{nodeIds:request.nodeIds}):request.kind==='block-move'?p.richBlockMoveCapture(request.field,request.nodeId,request.destination):request.kind==='range'?p.richRange(request.field,request.nodeId,request.from,request.to,{affinity:request.affinity??'right'}):request.kind==='split'?p.richSplitCapture(request.field,request.nodeId,request.at,{affinity:request.affinity??'right'}):p.richJoinCapture(request.field,request.leftNodeId,request.rightNodeId);return{data:p.read(),capture};}finally{host.replica.destroy();}
}

/** Readonly Source reconstruction; captures retain no Undo authority. */
export function resolveLocalToolRichPoint<T extends LocalToolJson>(checkpoint:LocalToolConvergenceCheckpoint,options:LocalToolReplicaOptions<T>,point:RichRange){
 const replica=createLocalToolReplica(checkpoint,options);try{return{data:replica.read(),point:replica.resolveRichPoint(point)};}finally{replica.destroy();}
}
