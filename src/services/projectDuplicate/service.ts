import Dexie from 'dexie';
import { db } from '@/db';
import { deleteProject, notifyProjectsChanged } from '@/db/operations';
import { suppressDocumentHistoryForTransaction } from '@/services/documentHistory/context';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
import { captureProjectDuplicate, duplicateSnapshotVersion, readProjectDuplicate, snapshotManagedPaths } from './capture';
import { remapDuplicateSnapshot } from './remap';
import type { DuplicateExternalSnapshot, DuplicateProjectInput, ProjectDuplicateNative, ProjectDuplicatePreview, ProjectDuplicateReceipt, ProjectDuplicateResult, ProjectDuplicateSnapshot } from './types';

const receiptKey=(id:string)=>`projectDuplicate.operation.${id}`;
const native=()=>typeof window==='undefined'?undefined:(window.electronAPI as unknown as {projectDuplicate?:ProjectDuplicateNative}|undefined)?.projectDuplicate;
const noExternal:DuplicateExternalSnapshot={version:'browser-no-native-storage',files:[],bindings:[],missing:[]};
function identity(value:string){if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('project_duplicate_operation_invalid');}
const counts=(snapshot:ProjectDuplicateSnapshot)=>Object.fromEntries([['projects',1],...Object.entries(snapshot.tables).map(([key,rows])=>[key,rows.length])]) as Record<string,number>;
const targetVersion=(snapshot:ProjectDuplicateSnapshot)=>duplicateSnapshotVersion({...snapshot,parent:undefined});
async function external(snapshot:ProjectDuplicateSnapshot){const paths=snapshotManagedPaths(snapshot),bridge=native();if(bridge)return bridge.inspect({projectId:snapshot.project.id,paths});if(paths.length)throw Error('project_duplicate_desktop_assets_required');return noExternal;}
async function version(snapshot:ProjectDuplicateSnapshot,resources:DuplicateExternalSnapshot){return eraDocumentVersion({root:{id:'duplicate-source',source:await duplicateSnapshotVersion(snapshot),external:resources.version},children:{}});}
async function receipt(id:string):Promise<ProjectDuplicateReceipt|undefined>{const row=await db.settings.get(receiptKey(id));return row?.value?JSON.parse(row.value) as ProjectDuplicateReceipt:undefined;}
async function saveReceipt(row:ProjectDuplicateReceipt){await db.settings.put({id:receiptKey(row.operationId),key:receiptKey(row.operationId),value:JSON.stringify(row)});}
function result(row:ProjectDuplicateReceipt):ProjectDuplicateResult{return{projectId:row.projectId,operationId:row.operationId,complete:row.complete,unfinished:row.unfinished,counts:row.counts};}

/** The ordinary dialog can resume a committed copy after its window or app closed. */
export async function pendingProjectDuplicate(sourceProjectId:string):Promise<ProjectDuplicateReceipt|undefined>{
  const rows=await db.settings.filter(row=>row.key.startsWith('projectDuplicate.operation.')).toArray();
  const pending=rows.map(row=>JSON.parse(row.value) as ProjectDuplicateReceipt).filter(row=>row.sourceProjectId===sourceProjectId&&!row.complete&&!row.undone).sort((a,b)=>b.createdAt-a.createdAt);
  for(const row of pending)if(await db.projects.get(row.projectId))return row;
}
export async function resumeProjectDuplicate(operationId:string):Promise<ProjectDuplicateResult>{
  identity(operationId);const saved=await receipt(operationId);if(!saved)throw Error('project_duplicate_receipt_missing');return finish(saved);
}

export async function previewProjectDuplicate(input:{projectId:string;title?:string}):Promise<ProjectDuplicatePreview>{
  const snapshot=await readProjectDuplicate(input.projectId),resources=await external(snapshot);
  return {projectId:input.projectId,title:input.title??`${snapshot.project.title} · Copy`,sourceVersion:await version(snapshot,resources),externalVersion:resources.version,counts:counts(snapshot),files:resources.files,
    shared:{parentId:snapshot.parent?.id,referenceDocuments:new Set(snapshot.tables.projectReferenceLinks.map(row=>row.documentId)).size,nativeBindings:resources.bindings.length},
    findings:resources.missing.map(path=>`managed_asset_missing:${path}`),canDuplicate:!resources.missing.length};
}
async function finish(row:ProjectDuplicateReceipt):Promise<ProjectDuplicateResult>{
  if(row.undone)throw Error('project_duplicate_operation_undone');
  if(!await db.projects.get(row.projectId))throw Error('project_duplicate_target_missing');
  if(row.complete)return result(row);
  const bridge=native();
  try{
    const finished=bridge?await bridge.finalize({operationId:row.operationId,projectId:row.projectId}):{complete:true,unfinished:[]};
    const externalTargetVersion=finished.complete&&bridge?(await external(await readProjectDuplicate(row.projectId))).version:row.externalTargetVersion;
    const updated={...row,...finished,externalTargetVersion};await saveReceipt(updated);return result(updated);
  }catch(error){const updated={...row,complete:false,unfinished:[error instanceof Error?error.message:String(error)]};await saveReceipt(updated);return result(updated);}
}
const running=new Map<string,{signature:string;promise:Promise<ProjectDuplicateResult>}>();
/** Reusing the operation ID always resumes its one reserved destination. */
export function duplicateProject(input:DuplicateProjectInput):Promise<ProjectDuplicateResult>{
  identity(input.operationId);const signature=JSON.stringify({...input,title:input.title.trim()}),current=running.get(input.operationId);if(current){if(current.signature!==signature)throw Error('project_duplicate_operation_conflict');return current.promise;}
  const promise=apply(input).finally(()=>running.delete(input.operationId));running.set(input.operationId,{signature,promise});return promise;
}
async function apply(input:DuplicateProjectInput):Promise<ProjectDuplicateResult>{
  const previous=await receipt(input.operationId);
  if(previous){if(previous.sourceProjectId!==input.projectId||previous.sourceVersion!==input.expectedSourceVersion||previous.title!==input.title.trim())throw Error('project_duplicate_operation_conflict');return finish(previous);}
  if(!input.title.trim())throw Error('project_duplicate_title_required');
  const snapshot=await readProjectDuplicate(input.projectId),resources=await external(snapshot);
  if(await version(snapshot,resources)!==input.expectedSourceVersion)throw Error('project_duplicate_source_conflict');
  if(resources.missing.length)throw Error('project_duplicate_managed_asset_missing');
  const targetProjectId=`proj_copy_${input.operationId}`,bridge=native();
  let staged=false,committed=false;
  try{
    const stage=bridge?await bridge.stage({operationId:input.operationId,sourceProjectId:input.projectId,targetProjectId:targetProjectId,paths:snapshotManagedPaths(snapshot),expectedExternalVersion:resources.version}):undefined;staged=!!stage;
    const transformed=await remapDuplicateSnapshot(snapshot,targetProjectId,input.title.trim(),stage?.pathMap),createdAt=Date.now();
    const pristine=await targetVersion(transformed);
    if(bridge&&(await external(snapshot)).version!==resources.version)throw Error('project_duplicate_external_conflict');
    const saved:ProjectDuplicateReceipt={projectId:targetProjectId,operationId:input.operationId,sourceProjectId:input.projectId,sourceVersion:input.expectedSourceVersion,title:input.title.trim(),targetVersion:pristine,createdAt,complete:!bridge,unfinished:bridge?['native_resources_pending']:[],counts:counts(transformed)};
    await db.transaction('rw',db.tables,async tx=>{
      const already=await tx.table('settings').get(receiptKey(input.operationId));if(already)throw Error('project_duplicate_operation_conflict');
      const current=await captureProjectDuplicate(tx,input.projectId),currentVersion=await duplicateSnapshotVersion(current);
      if(currentVersion!==await duplicateSnapshotVersion(snapshot))throw Error('project_duplicate_source_conflict');
      if(bridge&&(await Dexie.waitFor(bridge.inspect({projectId:input.projectId,paths:snapshotManagedPaths(snapshot)}))).version!==resources.version)throw Error('project_duplicate_external_conflict');
      // No helper with ambient reads after hashing; requests remain bound to this transaction.
      if(await tx.table('projects').get(targetProjectId))throw Error('project_duplicate_target_occupied');
      for(const[table,rows]of Object.entries(transformed.tables))for(const row of rows){const key=table==='aiProjectSettings'?row.projectId:row.id;if(key!==undefined&&await tx.table(table).get(key as string))throw Error(`project_duplicate_target_occupied:${table}`);}
      suppressDocumentHistoryForTransaction();
      await tx.table('projects').add(transformed.project);
      for(const[table,rows]of Object.entries(transformed.tables))if(rows.length)await tx.table(table).bulkAdd(rows);
      if(current.parent)await tx.table('projects').put({...current.parent,children:[...new Set([...current.parent.children??[],targetProjectId])],updatedAt:Math.max(Date.now(),current.parent.updatedAt+1)});
      await tx.table('settings').add({id:receiptKey(input.operationId),key:receiptKey(input.operationId),value:JSON.stringify(saved)});
    });committed=true;notifyProjectsChanged();
    return finish(saved);
  }catch(error){if(staged&&!committed)await bridge!.discard({operationId:input.operationId}).catch(()=>undefined);throw error;}
}
export async function undoProjectDuplicate(operationId:string):Promise<{projectId:string;undone:boolean;unfinished:string[]}>{
  identity(operationId);const saved=await receipt(operationId);if(!saved)throw Error('project_duplicate_receipt_missing');
  if(saved.undone){const unfinished:string[]=[];try{await native()?.discard({operationId,removeCommitted:true});}catch(error){unfinished.push(error instanceof Error?error.message:String(error));}return{projectId:saved.projectId,undone:true,unfinished};}
  if(!saved.complete)throw Error('project_duplicate_undo_pending');
  if(saved.externalTargetVersion&&(!native()||(await external(await readProjectDuplicate(saved.projectId))).version!==saved.externalTargetVersion))throw Error('project_duplicate_undo_resources_changed');
  await db.transaction('rw',db.tables,async tx=>{
    const locked=await tx.table('settings').get(receiptKey(operationId));if(locked?.value!==JSON.stringify(saved))throw Error('project_duplicate_operation_conflict');
    const snapshot=await captureProjectDuplicate(tx,saved.projectId);
    if(await targetVersion(snapshot)!==saved.targetVersion)throw Error('project_duplicate_undo_changed');
    await deleteProject(saved.projectId);
    await tx.table('settings').put({id:receiptKey(operationId),key:receiptKey(operationId),value:JSON.stringify({...saved,undone:true})});
  });
  const unfinished:string[]=[];
  try{await native()?.discard({operationId,removeCommitted:true});}catch(error){unfinished.push(error instanceof Error?error.message:String(error));}
  return{projectId:saved.projectId,undone:true,unfinished};
}
