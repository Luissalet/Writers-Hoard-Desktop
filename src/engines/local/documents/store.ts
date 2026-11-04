import {resolveProjectLocalTool} from '../releases';
import Dexie from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {notifyDataChanged} from '@/engines/_shared/dataChanged';
import {announceEraChange} from '@/services/worldEras/store';
import type {WorldEraScope,EraRow,WorldEraVariant,WorldEraVariantState} from '@/services/worldEras/types';
import {archiveMetadataWithMutation} from '@/services/documentArchive/metadata';
import type {LocalToolDefinition,LocalToolSnapshot} from '../sdk';
import {parseLocalToolState} from '../clientContract';
import {cloneLocalToolJson,LocalToolStateError,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState} from '../stateCodec';
import {validateSourceToolDocument,type SourceToolDocument} from './types';
import {forkSourceToolDocument} from './portability';
import {assertSourceAdditiveTarget,parseSourceToolDocumentState} from './additive';
import {priorSourceCodec} from '../convergence/sourceAdditive';
import type {LocalToolConvergenceContract} from '../convergence/types';
import {isRichImageEngine} from '../convergence/imageFormat';
import {assertTableAxesOrigin,convergenceCanonical,convergenceCodecHash,convergenceEngine,convergenceHash,convergenceIdentityOf,validateConvergenceMetadata} from '../convergence/format';
import {effectiveRichAdoptionContract} from '../convergence/richAdoption';
import {createLocalToolGenesis,inspectLocalToolConvergence,prepareLocalToolReplacement} from '../convergence/replica';
function announce(projectId:string){let tx=Dexie.currentTransaction;const emit=()=>Dexie.ignoreTransaction(()=>{notifyProjectsChanged();notifyDataChanged({source:'other',projectId});});if(!tx){emit();return;}while(tx.parent)tx=tx.parent;tx.on('complete',emit);}
export async function readSourceToolDocument(scope:WorldEraScope,id:string,namespace?:string){const project=await db.projects.get(scope.projectId);if(!project)throw Error('project_missing');if(scope.eraId&&!project.worldEras?.some(era=>era.id===scope.eraId))throw Error('world_era_missing');let variant:WorldEraVariant|undefined;let document=project.sourceToolDocuments?.find(row=>row.id===id),provenance:'base'|'variant'='base';if(scope.eraId){variant=await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId,scope.eraId,'local-tool',id]).first();if(variant&&!variant.archived){if(variant.hidden)return undefined;document=variant.document?.root as unknown as SourceToolDocument;provenance='variant';}}if(!document||namespace&&document.namespace!==namespace)return undefined;validateSourceToolDocument(document);const epoch=variant?[...variant.history??[],variant].filter(state=>state.archived||state.hidden).at(-1)?.revision??0:0;return{document:structuredClone(document),provenance,lineage:JSON.stringify([document.generation??document.createdAt,epoch]),version:JSON.stringify([document.generation??document.createdAt,document.revision,document.updatedAt,variant?.id??null,variant?.revision??null,!!variant?.archived])};}
export async function listSourceToolDocuments(scope:WorldEraScope,namespace?:string):Promise<SourceToolDocument[]>{const project=await db.projects.get(scope.projectId);if(!project)throw Error('project_missing');if(scope.eraId&&!project.worldEras?.some(era=>era.id===scope.eraId))throw Error('world_era_missing');const ids=new Set((project.sourceToolDocuments??[]).map(row=>row.id));if(scope.eraId)await db.worldEraVariants.where('[projectId+eraId]').equals([scope.projectId,scope.eraId]).each(row=>{if(row.kind==='local-tool')ids.add(row.entityId);});const values=await Promise.all([...ids].map(id=>readSourceToolDocument(scope,id,namespace)));return values.flatMap(value=>value?[value.document]:[]).sort((a,b)=>a.title.localeCompare(b.title));}
// JSON-only source documents have a revision on their root. Compare and commit
// that revision inside the existing outer RW; no asynchronous content hash or
// second transaction is needed, including on the first inherited era write.
function retain(previous?:WorldEraVariant):WorldEraVariantState[]{if(!previous)return [];const {revision,updatedAt,hidden,archived,document}=previous;return [...previous.history??[],{revision,updatedAt,hidden,archived,document}];}
export type SourceToolRead=NonNullable<Awaited<ReturnType<typeof readSourceToolDocument>>>;
/** One existing RW boundary, including no-op plans. Callers validate original CAS before preparing a fork. */
export async function transformSourceToolDocument<R>(scope:WorldEraScope,id:string,change:(read:SourceToolRead|undefined)=>{next?:SourceToolDocument;result:R}):Promise<R>{
 return db.transaction('rw',db.tables,async()=>{
  const read=await readSourceToolDocument(scope,id),plan=change(read),next=plan.next;
  if(!next)return plan.result;
  validateSourceToolDocument(next);
  if(next.id!==id||read&&next.namespace!==read.document.namespace)throw Error('source_tool_document_identity_mismatch');
  if(scope.eraId){
   const previous=await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId,scope.eraId,'local-tool',id]).first();
   const history=retain(previous);let revision=(previous?.revision??0)+1;
   if(next.convergence&&read?.provenance==='base'){
    // Keep this inherited causal source recoverable even if Base changes later.
    const sourceRevision=previous?revision++:0;
    history.push({revision:sourceRevision,updatedAt:read.document.updatedAt,document:{root:structuredClone(read.document) as unknown as EraRow,children:{}}});
   }
   await db.worldEraVariants.put({id:previous?.id??crypto.randomUUID(),projectId:scope.projectId,eraId:scope.eraId,kind:'local-tool',entityId:id,revision,updatedAt:next.updatedAt,document:{root:next as unknown as EraRow,children:{}},history});
   announceEraChange(scope.projectId);return plan.result;
  }
  const project=await db.projects.get(scope.projectId);if(!project)throw Error('project_missing');
  // The normal DBCore history hook captures the displaced complete root before this update, in this RW.
  await db.projects.update(scope.projectId,{sourceToolDocuments:[...(project.sourceToolDocuments??[]).filter(row=>row.id!==id),next],updatedAt:Math.max(Date.now(),project.updatedAt+1)});
  announce(scope.projectId);return plan.result;
 });
}
function checkSourceCAS(read:SourceToolRead|undefined,expected:number|null,expectedVersion:string|null){
 if((read?.document.revision??null)!==expected||(read?.version??null)!==expectedVersion)throw new LocalToolStateError('conflict');
}
async function mutate(scope:WorldEraScope,id:string,expected:number|null,expectedVersion:string|null,change:(current?:SourceToolDocument)=>SourceToolDocument):Promise<SourceToolDocument>{
 return transformSourceToolDocument(scope,id,read=>{
  checkSourceCAS(read,expected,expectedVersion);let current=read?.document;
  if(current?.convergence&&scope.eraId&&read?.provenance==='base')current={...forkSourceToolDocument(current),generation:crypto.randomUUID()};
  const next=change(current);return{next,result:next};
 });
}
export interface SourceConvergenceOptions {authorId:string;validationId:string;schemaEpoch:string;/** Host-only local flag; not a commit notification. */onPrepared?:(causalChanged:boolean)=>void}
/** Current executable validation comes from the selected host, never old persisted metadata. */
export function sourceConvergenceContract<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>,options:Omit<SourceConvergenceOptions,'authorId'>,adopting=false,promoting=false):LocalToolConvergenceContract<T>{
 const codec=definition.codec??document.codec;if(!codec)throw Error('local_tool_convergence_codec_required');
 if(!promoting&&(definition.sourceAdditive||document.codec?.sourceDefault||document.convergence?.checkpoint.engine.version==='8'))assertSourceAdditiveTarget(document,definition);
 if(document.convergence?.checkpoint.engine.version==='1'&&document.codec&&!promoting&&convergenceEngine(codec).version==='1'){
  const added=Object.keys(codec.fields).filter(field=>!Object.hasOwn(document.codec!.fields,field));
  if(added.length===1&&codec.fields[added[0]].kind==='scalar'&&convergenceCanonical(priorSourceCodec(codec,added[0]))===convergenceCanonical(document.codec))throw Error('local_tool_source_additive_required');
 }
 assertTableAxesOrigin(codec,document.codec,document.convergence?.checkpoint.engine.version);
 const contract={namespace:definition.namespace,codec,validationId:options.validationId,schemaEpoch:options.schemaEpoch,validateState:definition.validateState,...(definition.richAdoption?{richAdoption:definition.richAdoption}:{})};
 validateConvergenceMetadata(contract);return document.convergence&&!adopting?effectiveRichAdoptionContract(document.convergence.checkpoint,contract):contract;
}
/** Pure preparation: no DB/history/receipt consumption. The caller commits its final intent once. */
export function prepareSourceConvergenceContext<T extends LocalToolJson>(original:SourceToolDocument,definition:LocalToolDefinition<T>,options:SourceConvergenceOptions,inherited=false,adopting=false){
 if(!original.convergence)throw Error('local_tool_convergence_not_started');
 const contract=sourceConvergenceContract(original,definition,options,adopting),stored=original.convergence.checkpoint;
 const knownAdoption=adopting&&!!contract.richAdoption&&stored.engine.version==='3';if(knownAdoption)effectiveRichAdoptionContract(stored,contract);
 const epochChanged=!knownAdoption&&(stored.validationId!==contract.validationId||stored.schemaEpoch!==contract.schemaEpoch||stored.codecHash!==convergenceCodecHash(contract.codec));
 if(epochChanged&&stored.engine.version==='8')throw Error('local_tool_source_additive_incompatible');
 if(epochChanged&&isRichImageEngine(stored.engine.version))throw Error('local_tool_convergence_identity_mismatch');
 let document=original;
 if(epochChanged){
  const checkpoint=createLocalToolGenesis(original.data as T,contract);
  document={...original,generation:crypto.randomUUID(),codec:structuredClone(contract.codec),convergence:{checkpoint}};
 }else if(inherited)document={...forkSourceToolDocument(original),generation:crypto.randomUUID()};
 const checkpoint=document.convergence!.checkpoint,replicaOptions={authorId:options.authorId,contract};
 const view=inspectLocalToolConvergence(checkpoint,replicaOptions);
 if(convergenceHash(view.data)!==convergenceHash(document.data)||convergenceHash(view.conflict)!==convergenceHash(document.convergence!.conflict??null))throw Error('source_tool_convergence_projection_mismatch');
 return{document,checkpoint,replicaOptions,view,reset:epochChanged||inherited,epochChanged};
}
export async function createSourceToolDocument(scope:WorldEraScope,namespace:string,title:string):Promise<SourceToolDocument>{return db.transaction('rw',db.tables,()=>Dexie.Promise.resolve(db.projects.get(scope.projectId)).then(project=>{if(!project)throw Error('project_missing');const definition=resolveProjectLocalTool(namespace,project);if(!definition.document||!title.trim())throw Error('source_tool_document_title_required');const id=crypto.randomUUID(),now=Date.now(),data=parseLocalToolState(definition,definition.initialState),spec=definition.codec?.sourceDefault;
 if(spec&&data&&typeof data==='object'&&!Array.isArray(data)&&Object.hasOwn(data,spec.field)&&convergenceCanonical(data[spec.field])===convergenceCanonical(spec.defaultValue))delete data[spec.field];
 return mutate(scope,id,null,null,()=>({id,generation:crypto.randomUUID(),namespace,title:title.trim(),revision:1,createdAt:now,updatedAt:now,data,...(definition.codec?{codec:structuredClone(definition.codec)}:{}),...(definition.preview?{preview:structuredClone(definition.preview)}:{}),...(definition.index?{index:structuredClone(definition.index)}:{})}));}));}
export async function renameSourceToolDocument(scope:WorldEraScope,id:string,namespace:string,title:string,expected:number,expectedVersion:string){if(!title.trim())throw Error('source_tool_document_title_required');return mutate(scope,id,expected,expectedVersion,current=>{if(!current||current.namespace!==namespace)throw Error('source_tool_document_missing');return{...current,title:title.trim(),revision:current.revision+1,updatedAt:Math.max(Date.now(),current.updatedAt+1)};});}
export async function archiveSourceToolDocument(scope:WorldEraScope,id:string,namespace:string,expected:number,expectedVersion:string):Promise<void>{await db.transaction('rw',db.tables,async()=>{const read=await readSourceToolDocument(scope,id,namespace);if(!read||read.document.revision!==expected||read.version!==expectedVersion)throw new LocalToolStateError('conflict');if(scope.eraId){const previous=await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId,scope.eraId,'local-tool',id]).first();await db.worldEraVariants.put({id:previous?.id??crypto.randomUUID(),projectId:scope.projectId,eraId:scope.eraId,kind:'local-tool',entityId:id,hidden:true,document:{root:read.document as unknown as EraRow,children:{}},history:retain(previous),revision:(previous?.revision??0)+1,updatedAt:Date.now()});announceEraChange(scope.projectId);return;}await archiveMetadataWithMutation('local-tool',scope.projectId,id,async()=>{const project=await db.projects.get(scope.projectId);if(!project)throw Error('project_missing');await db.projects.update(scope.projectId,{sourceToolDocuments:(project.sourceToolDocuments??[]).filter(row=>row.id!==id),updatedAt:Math.max(Date.now(),project.updatedAt+1)});announce(scope.projectId);});});}
/** Export may copy its already-admitted old-epoch view without executing a newly pinned validator. */
export function sourceToolSnapshot<T extends LocalToolJson>(read:SourceToolRead,definition:LocalToolDefinition<T>,validate=true):LocalToolSnapshot<T>{
 const document=read.document,convergence=document.convergence;
 return{revision:document.revision,updatedAt:document.updatedAt,data:validate?parseSourceToolDocumentState(definition,document):cloneLocalToolJson(document.data) as T,provenance:read.provenance,document:{id:document.id,namespace:definition.namespace,title:document.title,version:read.version,lineage:read.lineage},...(convergence?{convergence:{...convergenceIdentityOf(convergence.checkpoint),...(convergence.conflict?{conflict:structuredClone(convergence.conflict)}:{})}}:{})};
}
export async function readSourceToolState<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>):Promise<LocalToolSnapshot<T>>{
 const read=await readSourceToolDocument(scope,id,definition.namespace);if(!read)throw Error('source_tool_document_missing');return sourceToolSnapshot(read,definition);
}
export async function saveSourceToolState<T extends LocalToolJson>(scope:WorldEraScope,id:string,definition:LocalToolDefinition<T>,data:T,expected:number|null,expectedVersion?:string,convergenceOptions?:SourceConvergenceOptions):Promise<LocalToolSnapshot<T>>{
 if(definition.sourceAdditive)throw Error('local_tool_source_additive_write_unavailable');
 const safe=parseLocalToolState(definition,data);if(!expectedVersion)throw Error('source_tool_document_version_required');
 return db.transaction('rw',db.tables,async()=>{
  await transformSourceToolDocument(scope,id,read=>{
   checkSourceCAS(read,expected,expectedVersion);if(!read||read.document.namespace!==definition.namespace)throw Error('source_tool_document_missing');
   let current=read.document,nextData=cloneLocalToolJson(safe);
   if(current.codec?.sourceDefault||current.convergence?.checkpoint.engine.version==='8')throw Error('local_tool_source_additive_write_unavailable');
   if(current.convergence){
    if(!convergenceOptions)throw Error('source_tool_convergence_context_required');
    const context=prepareSourceConvergenceContext(current,definition,convergenceOptions,!!scope.eraId&&read.provenance==='base');
    const prepared=prepareLocalToolReplacement(context.checkpoint,context.replicaOptions,safe);
    if(prepared.beforeFingerprint!==convergenceHash(context.checkpoint))throw new LocalToolStateError('conflict');
    convergenceOptions.onPrepared?.(context.reset||prepared.causalChanged);
    current={...context.document,convergence:{checkpoint:prepared.checkpoint,...(prepared.conflict?{conflict:prepared.conflict}:{})}};nextData=prepared.data;
   }
   const codec=current.convergence?current.codec??definition.codec:definition.codec??current.codec;if(codec)validateLocalToolCodecState(nextData,codec);
   const next={...current,data:nextData,revision:current.revision+1,updatedAt:Math.max(Date.now(),current.updatedAt+1),...(codec?{codec:structuredClone(codec)}:{}),...(definition.index?{index:structuredClone(definition.index)}:{})};
   if(!definition.index)delete next.index;return{next,result:undefined};
  });return readSourceToolState(scope,id,definition);
 });
}
