/** Host-only Source operations; the existing Source mutation owns every write. */
import {db} from '@/db';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {LocalToolDefinition,LocalToolJson,LocalToolSnapshot,LocalToolStateAction} from '../sdk';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergencePreparation,LocalToolConvergenceReceipt,LocalToolConvergenceUpdate,LocalToolReplicaOptions} from '../convergence/types';
import {convergenceHash} from '../convergence/format';
import {createLocalToolGenesis,exportLocalToolConvergenceCheckpoint,prepareLocalToolActions,prepareLocalToolReceive,prepareLocalToolReverse} from '../convergence/replica';
import {mergeLocalToolActions} from '../stateActions';
import {readSourceToolDocument,readSourceToolState,sourceToolSnapshot,transformSourceToolDocument,sourceConvergenceContract,prepareSourceConvergenceContext,type SourceToolRead,type SourceConvergenceOptions} from './store';
import type {SourceToolConvergence,SourceToolDocument} from './types';
export type {SourceConvergenceOptions} from './store';
export interface SourceConvergenceReadOptions {stateVectorBase64?:string}
interface StoredPlan {
 checkpoint:LocalToolConvergenceCheckpoint|null;update:LocalToolConvergenceUpdate|null;
 changed:boolean;causalChanged:boolean;pending:boolean;
 receipt?:LocalToolConvergenceReceipt|null;consumeReceiptId?:string|null;
}
export type SourceConvergenceResult<T extends LocalToolJson> = StoredPlan&{snapshot:LocalToolSnapshot<T>};
function source(read:SourceToolRead|undefined,id:string,namespace:string):SourceToolRead{
 if(!read||read.document.id!==id||read.document.namespace!==namespace)throw Error('source_tool_document_missing');return read;
}
function baseline<T extends LocalToolJson>(read:SourceToolRead,value:LocalToolSnapshot<T>,id:string,namespace:string,strict:boolean){
 if(!value.document||value.document.id!==id||value.document.namespace!==namespace||value.document.lineage!==read.lineage)throw Error('source_tool_document_lineage_conflict');
 if(value.revision===null||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>read.document.revision)throw Error('local_tool_actions_baseline_invalid');
 if(strict&&(value.revision!==read.document.revision||value.document.version!==read.version))throw Error('conflict');
}
function state<T extends LocalToolJson>(prepared:LocalToolConvergencePreparation<T>):SourceToolConvergence{return{checkpoint:prepared.checkpoint,...(prepared.conflict?{conflict:prepared.conflict}:{})};}
const touch=(document:SourceToolDocument):SourceToolDocument=>({...document,revision:document.revision+1,updatedAt:Math.max(Date.now(),document.updatedAt+1)});
async function result<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,plan:StoredPlan):Promise<SourceConvergenceResult<T>>{
 return{...plan,snapshot:await readSourceToolState(scope,id,definition)};
}
/** Snapshot and causal bytes are collected in the same RW; an outer owner still controls commit. */
export function startSourceToolConvergence<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,value:LocalToolSnapshot<T>,options:SourceConvergenceOptions):Promise<SourceConvergenceResult<T>>{
 return db.transaction('rw',db.tables,async()=>{
  const plan=await transformSourceToolDocument<StoredPlan>(scope,id,read=>{
   const actual=source(read,id,definition.namespace);baseline(actual,value,id,definition.namespace,true);
   const inherited=!!scope.eraId&&actual.provenance==='base';
   if(actual.document.convergence){
    const prepared=prepareSourceConvergenceContext(actual.document,definition,options,inherited);
    return{next:prepared.reset?touch(prepared.document):undefined,result:{checkpoint:prepared.checkpoint,update:null,changed:false,causalChanged:prepared.reset,pending:prepared.view.pending}};
   }
   const contract=sourceConvergenceContract(actual.document,definition,options),checkpoint=createLocalToolGenesis(actual.document.data as T,contract);
   return{next:{...touch(actual.document),generation:crypto.randomUUID(),codec:structuredClone(contract.codec),convergence:{checkpoint}},result:{checkpoint,update:null,changed:false,causalChanged:true,pending:false}};
  });return result(scope,id,definition,plan);
 });
}
/** An old epoch is exported without interpreting it with a newly pinned validator. */
export function exportSourceToolConvergence<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,options:SourceConvergenceReadOptions={}):Promise<SourceConvergenceResult<T>>{
 return db.transaction('r',[db.projects,db.worldEraVariants],async()=>{
  const read=source(await readSourceToolDocument(scope,id,definition.namespace),id,definition.namespace),checkpoint=read.document.convergence?.checkpoint;
  if(!checkpoint)return{snapshot:sourceToolSnapshot(read,definition,false),checkpoint:null,update:null,changed:false,causalChanged:false,pending:false};
  const exported=exportLocalToolConvergenceCheckpoint(checkpoint,options.stateVectorBase64);
  return{snapshot:sourceToolSnapshot(read,definition,false),checkpoint,update:exported.update,changed:false,causalChanged:false,pending:exported.pending};
 });
}
async function prepare<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,options:SourceConvergenceOptions,guard:(read:SourceToolRead,inherited:boolean)=>void,change:(read:SourceToolRead,checkpoint:LocalToolConvergenceCheckpoint,replicaOptions:LocalToolReplicaOptions<T>,reset:boolean)=>LocalToolConvergencePreparation<T>):Promise<SourceConvergenceResult<T>>{
 return db.transaction('rw',db.tables,async()=>{
  const plan=await transformSourceToolDocument<StoredPlan>(scope,id,read=>{
   const actual=source(read,id,definition.namespace),inherited=!!scope.eraId&&actual.provenance==='base';
   guard(actual,inherited); // CAS/lineage is checked before any new branch or epoch is prepared.
   const context=prepareSourceConvergenceContext(actual.document,definition,options,inherited),{checkpoint,replicaOptions}=context;
   const prepared=change(actual,checkpoint,replicaOptions,context.reset);
   if(prepared.beforeFingerprint!==convergenceHash(checkpoint))throw Error('conflict');
   const convergence=state(prepared),metadataChanged=convergenceHash(context.document.convergence)!==convergenceHash(convergence);
   const next=context.reset||prepared.changed||prepared.causalChanged||metadataChanged?{...touch(context.document),data:prepared.data,convergence}:undefined;
   return{next,result:{checkpoint:prepared.checkpoint,update:prepared.update,changed:prepared.changed,causalChanged:context.reset||prepared.causalChanged,pending:prepared.pending,receipt:prepared.receipt,consumeReceiptId:prepared.consumeReceiptId}};
  });return result(scope,id,definition,plan);
 });
}
export function importSourceToolConvergence<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,update:LocalToolConvergenceUpdate,options:SourceConvergenceOptions){
 return prepare(scope,id,definition,options,(_read,inherited)=>{
  if(inherited)throw Error('local_tool_convergence_era_start_required');
 },(_read,checkpoint,replicaOptions)=>prepareLocalToolReceive(checkpoint,replicaOptions,update));
}
export function applySourceToolConvergence<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,value:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[],options:SourceConvergenceOptions){
 return prepare(scope,id,definition,options,read=>{
  baseline(read,value,id,definition.namespace,false);
  const codec=sourceConvergenceContract(read.document,definition,options).codec;
  // Retain the existing three-way field/item conflict semantics.
  mergeLocalToolActions<LocalToolJson>(codec,value.data,read.document.data,actions);
 },(_read,checkpoint,replicaOptions)=>prepareLocalToolActions(checkpoint,replicaOptions,actions));
}
export function reverseSourceToolConvergence<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,receipt:LocalToolConvergenceReceipt,options:SourceConvergenceOptions){
 return prepare(scope,id,definition,options,(_read,inherited)=>{
  if(inherited)throw Error('local_tool_convergence_receipt_unavailable');
 },(_read,checkpoint,replicaOptions,reset)=>{
  if(reset)throw Error('local_tool_convergence_receipt_unavailable');return prepareLocalToolReverse(checkpoint,replicaOptions,receipt);
 });
}
