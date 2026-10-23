import Dexie from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {resolveEraDocumentAssets} from '@/services/worldEras/assets';
import type {Writing} from '@/types';
import type {EraDocument} from '@/services/worldEras/types';
import {structuralManuscriptOwners,assertManuscriptOwner,MAIN_MANUSCRIPT,manuscriptMetadata,validateManuscriptProject,writingManuscriptId,type Manuscript,type MainManuscriptMetadata,type ManuscriptCatalog} from './manuscripts';

export interface ManuscriptReceipt {id:string;before:Manuscript|MainManuscriptMetadata|null;after:Manuscript|MainManuscriptMetadata}
export async function listManuscripts(projectId:string){const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');validateManuscriptProject(project);return{projectId,revision:project.manuscriptCatalog?.revision??0,manuscripts:[{...manuscriptMetadata(project),id:MAIN_MANUSCRIPT},...project.manuscriptCatalog?.entries??[]]};}
export async function setManuscript(projectId:string,id:string,action:'create'|'update'|'archive'|'restore',patch:Partial<Manuscript>,expectedRevision:number){
 if(id===MAIN_MANUSCRIPT&&Object.keys(patch).some(key=>!['title','author','blurb'].includes(key)))throw Error('manuscript_main_invalid');
 const result=await db.transaction('rw',db.projects,async()=>{
  const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');validateManuscriptProject(project);
  const previous=project.manuscriptCatalog;if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||(previous?.revision??0)!==expectedRevision)throw Error('manuscript_conflict');
  const catalog:ManuscriptCatalog=structuredClone(previous??{revision:0,entries:[]}),current=id===MAIN_MANUSCRIPT?catalog.main:catalog.entries.find(row=>row.id===id);
  if(!id||id==='library'||action==='create'&&(id===MAIN_MANUSCRIPT||current)||action!=='create'&&id!==MAIN_MANUSCRIPT&&!current)throw Error('manuscript_missing');
  const now=Math.max(Date.now(),project.updatedAt+1),before=structuredClone(current??null);
  const fields:MainManuscriptMetadata={...(patch.title!==undefined?{title:patch.title}:{}),...(patch.author!==undefined?{author:patch.author}:{}),...(patch.blurb!==undefined?{blurb:patch.blurb}:{})};
  let next:Manuscript|MainManuscriptMetadata=id===MAIN_MANUSCRIPT?{...current,...fields}:{...current,...fields,...(patch.coverImage!==undefined?{coverImage:patch.coverImage}:{}),id,title:patch.title??current?.title??'',createdAt:(current as Manuscript|undefined)?.createdAt??now,updatedAt:now};
  if(action==='archive')next={...next,archivedAt:now};if(action==='restore')delete next.archivedAt;
  if(id===MAIN_MANUSCRIPT)catalog.main=next;else catalog.entries=current?catalog.entries.map(row=>row.id===id?next as Manuscript:row):[...catalog.entries,next as Manuscript];
  catalog.revision++;validateManuscriptProject({manuscriptCatalog:catalog});await db.projects.update(projectId,{manuscriptCatalog:catalog,updatedAt:now});
  return{projectId,revision:catalog.revision,manuscript:next,receipt:{id,before,after:structuredClone(next)} satisfies ManuscriptReceipt};
 });notifyProjectsChanged();return result;
}
function refers(value:unknown,id:string):boolean{
 if(!value||typeof value!=='object')return false;if(Array.isArray(value))return value.some(row=>refers(row,id));
 const row=value as Record<string,unknown>;if(row.manuscriptId===id||row.kind==='manuscript'&&row.id===id)return true;
 return Object.values(row).some(child=>refers(child,id));
}
export async function undoManuscript(projectId:string,receipt:ManuscriptReceipt){
 await db.transaction('rw',db.tables,async()=>{
  const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');const catalog=structuredClone(project.manuscriptCatalog);if(!catalog)throw Error('manuscript_conflict');
  const current=receipt.id===MAIN_MANUSCRIPT?catalog.main:catalog.entries.find(row=>row.id===receipt.id);
  if(JSON.stringify(current)!==JSON.stringify(receipt.after))throw Error('manuscript_conflict');
  if(receipt.before===null&&receipt.id!==MAIN_MANUSCRIPT){
   for(const table of ['writings','worldEraVariants','documentArchives','publishingProfiles'])for(const row of await db.table(table).where('projectId').equals(projectId).toArray())if(refers(row,receipt.id))throw Error('manuscript_has_later_work');
   if(refers(project.publishedEditions,receipt.id)||(current as Manuscript).reader||(current as Manuscript).eraCovers)throw Error('manuscript_has_later_work');
  }
  if(receipt.id===MAIN_MANUSCRIPT){if(receipt.before===null)delete catalog.main;else catalog.main=structuredClone(receipt.before);}else catalog.entries=receipt.before===null?catalog.entries.filter(row=>row.id!==receipt.id):catalog.entries.map(row=>row.id===receipt.id?structuredClone(receipt.before) as Manuscript:row);
  catalog.revision++;validateManuscriptProject({manuscriptCatalog:catalog});await db.projects.update(projectId,{manuscriptCatalog:catalog,updatedAt:Math.max(Date.now(),project.updatedAt+1)});
 });notifyProjectsChanged();
}
/** Structural owner of the logical chapter, independent of its active era.
 * Dexie continuations keep this read composable with atomic era promotions. */
export function structuralWritingOwner(projectId:string,id:string):Promise<string|undefined>{
 return Dexie.Promise.all([
  db.writings.get(id),
  db.worldEraVariants.where('projectId').equals(projectId).filter(row=>row.kind==='writings'&&row.entityId===id).toArray(),
  db.documentArchives.where('projectId').equals(projectId).filter(row=>row.kind==='writings'&&row.sourceId===id).toArray(),
 ]).then(([base,variants,archives])=>Dexie.Promise.all(variants.map(variant=>
  Dexie.Promise.all([variant,...variant.history??[]].map(state=>state.document?Dexie.Promise.resolve(resolveEraDocumentAssets(projectId,state.document)).then(document=>({...state,document})):Dexie.Promise.resolve(state)))
   .then(states=>({...states[0],kind:'writings',history:states.slice(1)})),
 )).then(resolved=>structuralManuscriptOwners(base?.projectId===projectId?[base]:[],resolved,archives).get(id)));
}
export function assertWritingOwnerUnchanged(previous:Writing,changes:Partial<Writing>){
 if(Object.hasOwn(changes,'manuscriptId')&&writingManuscriptId(changes)!==writingManuscriptId(previous))throw Error('manuscript_owner_immutable');
}
export function validateWritingOwner(row:Writing):Promise<Writing>{
 return Dexie.Promise.resolve(structuralWritingOwner(row.projectId,row.id)).then(previous=>{
  const owner=row.manuscriptId===undefined&&previous!==undefined?previous:writingManuscriptId(row);
  if(previous!==undefined&&previous!==owner)throw Error('manuscript_owner_immutable');
  const next=owner===MAIN_MANUSCRIPT?row:{...row,manuscriptId:owner};
  if(owner===MAIN_MANUSCRIPT)return next;
  return db.projects.get(row.projectId).then(project=>{if(!project)throw Error('project_missing');assertManuscriptOwner(project,next);return next;});
 });
}
export function projectWritingOwner(projectId:string,document:EraDocument):Promise<EraDocument>{
 if(document.root.projectId!==projectId)return Dexie.Promise.reject(Error('manuscript_project_mismatch'));
 return Dexie.Promise.resolve(validateWritingOwner(document.root as unknown as Writing)).then(row=>row===(document.root as unknown as Writing)?document:{...document,root:row as unknown as EraDocument['root']});
}
