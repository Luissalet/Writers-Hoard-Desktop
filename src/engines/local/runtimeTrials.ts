import {db} from '@/db';
import {createProject,deleteProject,notifyProjectsChanged} from '@/db/operations';
import {notifyDataChanged} from '@/engines/_shared/dataChanged';
import {flushPendingWrites,getPendingWritesSnapshot} from '@/services/pendingWrites';
import type {Project} from '@/types';
import {getLocalToolDefinition,localToolEngineId} from './definitions';
import {pinLocalToolRelease} from './releases';
import {createSourceToolDocument} from './documents/store';
import {localToolNamespace} from './stateTypes';
import {localToolContentHash} from './releaseFormat.mjs';
import {validateLocalRuntimeTrial,type LocalRuntimeTrial} from './trialTypes';

export interface TrialSelection {namespace:string;contentHash:string}
export interface RuntimeTrialInput {contentHash:string;namespace:string;title:string;tools:TrialSelection[]}
const validSelection=(value:unknown):value is TrialSelection=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='contentHash,namespace'&&localToolNamespace((value as TrialSelection).namespace)&&localToolContentHash((value as TrialSelection).contentHash);
function announce(projectId:string){
  // A notification failure cannot turn a committed keep into a failed write.
  try{notifyProjectsChanged();}catch{/* The confirmed row remains authoritative. */}
  try{notifyDataChanged({source:'other',projectId});}catch{/* Live DB observers can reread the confirmed row. */}
}
function pending(){const value=getPendingWritesSnapshot();return value.pending>0||value.failed>0||value.dirty>0;}
async function marked(projectId:string,contentHash:string){
  if(typeof projectId!=='string'||!projectId||!localToolContentHash(contentHash))throw Error('local_runtime_trial_identity_invalid');
  const project=await db.projects.get(projectId);
  if(!project)throw Error('local_runtime_trial_project_not_found');
  validateLocalRuntimeTrial(project.id,project.localRuntimeTrial);
  if(!project.localRuntimeTrial||project.localRuntimeTrial.packageHash!==contentHash)throw Error('local_runtime_trial_marker_conflict');
  return project;
}
export async function createRuntimeTrial(input:RuntimeTrialInput){
  if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='contentHash,namespace,title,tools'||!validSelection({namespace:input.namespace,contentHash:input.contentHash})||typeof input.title!=='string'||!input.title.trim()||!Array.isArray(input.tools)||!input.tools.every(validSelection))throw Error('local_runtime_trial_selection_invalid');
  const requested=[{namespace:input.namespace,contentHash:input.contentHash},...input.tools.map(row=>({...row}))],selected=new Map(requested.map(row=>[row.namespace,row]));
  const title=input.title.trim(),entryNamespace=input.namespace,packageHash=input.contentHash;
  if(selected.size!==requested.length)throw Error('local_runtime_trial_selection_invalid');
  return db.transaction('rw',db.tables,async()=>{
    const definitions=new Map<string,NonNullable<ReturnType<typeof getLocalToolDefinition>>>();
    for(const row of requested){
      const packet=await db.localToolPackages.get(row.contentHash),member=packet?.manifest.members.find(item=>item.namespace===row.namespace);
      if(!packet||!member)throw Error('local_runtime_trial_package_not_found');
      const definition=getLocalToolDefinition(row.namespace,row.contentHash);
      if(!definition)throw Error('local_runtime_trial_release_unavailable');
      definitions.set(row.namespace,definition);
    }
    const required=new Set([entryNamespace]),queue=[entryNamespace];
    for(let index=0;index<queue.length;index++)for(const namespace of definitions.get(queue[index])?.app?.descriptor.tools??[]){
      if(!selected.has(namespace)||!definitions.get(namespace)?.document)throw Error('local_runtime_trial_dependency_required');
      if(!required.has(namespace)){required.add(namespace);queue.push(namespace);}
    }
    if(required.size!==selected.size)throw Error('local_runtime_trial_selection_extra');
    const projectId=crypto.randomUUID(),now=Date.now(),engines=requested.map(row=>localToolEngineId(row.namespace));
    const project:Project={id:projectId,title,mode:'custom',type:'standalone',color:'#c4973b',description:'',status:'draft',enabledEngines:engines,engineOrder:engines,createdAt:now,updatedAt:now};
    await createProject(project);
    for(const row of requested)await pinLocalToolRelease(projectId,row.namespace,row.contentHash,null);
    const definition=definitions.get(entryNamespace)!;
    const document=definition.document?await createSourceToolDocument({projectId},entryNamespace,title):undefined;
    const trial:LocalRuntimeTrial={projectId,packageHash,entryNamespace,...(document?{documentId:document.id}:{})};
    await db.projects.update(projectId,{localRuntimeTrial:trial});
    const query=document?'?document='+encodeURIComponent(document.id):'?legacy=1';
    return{projectId,...(document?{documentId:document.id}:{}),path:`/project/${encodeURIComponent(projectId)}/${localToolEngineId(entryNamespace)}${query}`,trial,selection:requested};
  });
}
export async function keepRuntimeTrial(projectId:string,contentHash:string){
  await db.transaction('rw',db.projects,async()=>{await marked(projectId,contentHash);await db.projects.where('id').equals(projectId).modify(project=>{delete project.localRuntimeTrial;});});
  announce(projectId);return{kept:true as const,projectId};
}
export async function discardRuntimeTrial(projectId:string,contentHash:string){
  await marked(projectId,contentHash);
  if(!(await flushPendingWrites()).ok||pending())throw Error('local_runtime_trial_pending');
  await db.transaction('rw',db.tables,async()=>{
    await marked(projectId,contentHash);
    if(pending())throw Error('local_runtime_trial_pending');
    await deleteProject(projectId);
    if(pending())throw Error('local_runtime_trial_pending');
  });
  return{discarded:true as const,projectId};
}
