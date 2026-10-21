import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createAnnotation,deleteAnnotation} from '@/engines/annotations/operations';
import {deleteAnnotationThread,mutateAnnotationThread,undoAnnotationThread} from '@/engines/annotations/threads';
import type {Annotation,AnnotationUndo} from '@/engines/annotations/types';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
async function rejects(run:()=>Promise<unknown>){let rejected=false;try{await run();}catch{rejected=true;}assert(rejected,'Undo should reject');}
export async function testCommentThreadReceipts(){
 const P='comment-receipt-rollback',scope={projectId:P};await db.projects.put({id:P,title:P,type:'standalone',mode:'custom',description:'',status:'draft',color:'#777777',enabledEngines:['annotations','codex'],engineOrder:[],createdAt:1,updatedAt:1});
 await db.codexEntries.put({id:P+'-source',projectId:P,title:'Source',type:'custom',fields:{},content:'Original prose',tags:[],relations:[],createdAt:1,updatedAt:1});
 const annotation=(id:string):Annotation=>({id,projectId:P,sourceEngineId:'codex',sourceEntityId:P+'-source',anchor:{type:'entity'},noteType:'text',noteBody:'Original',isOrphaned:false,position:0,createdAt:1,updatedAt:1});
 try{
  const row=annotation(P+'-thread'),reference={id:P+'-ref',annotationId:row.id,targetEngineId:'codex',targetEntityId:P+'-source',createdAt:1};await createAnnotation(row,reference);
  const deleted=await deleteAnnotationThread(scope,row.id,0);
  // A real later write reuses the freed reference key: Undo adds the comment,
  // then its reference insert fails. Both DB writes must roll back, not the receipt.
  const other=annotation(P+'-other');await createAnnotation(other,{...reference,annotationId:other.id});
  await rejects(()=>undoAnnotationThread(structuredClone(deleted.undo)));
  assert(!await db.annotations.get(row.id),'Failed reference restore left partial comment');assert((await db.annotationReferences.get(reference.id))?.annotationId===other.id,'Failed restore changed unrelated reference');
  await db.annotationReferences.delete(reference.id);const restored=await undoAnnotationThread(structuredClone(deleted.undo));assert(restored.id===row.id&&(await db.annotationReferences.get(reference.id))?.annotationId===row.id,'Same receipt could not retry after failed commit');
  const reply=await mutateAnnotationThread(scope,row.id,restored.revision!,{kind:'reply',body:'Newer reply'}),second=await deleteAnnotationThread(scope,row.id,reply.annotation.revision!);await rejects(()=>undoAnnotationThread(deleted.undo));assert(!await db.annotations.get(row.id),'Consumed delete restored obsolete thread');
  const winners=await Promise.allSettled([undoAnnotationThread(structuredClone(second.undo)),undoAnnotationThread(structuredClone(second.undo))]);assert(winners.filter(result=>result.status==='fulfilled').length===1,'Concurrent receipt consumption did not have exactly one winner');assert((await db.annotations.get(row.id))!.replies![0].body==='Newer reply','Concurrent replay lost reply');
  const current=(await db.annotations.get(row.id))!,edited=await mutateAnnotationThread(scope,row.id,current.revision!,{kind:'body',body:'Temporary edit'});await undoAnnotationThread(edited.undo);await rejects(()=>undoAnnotationThread(edited.undo));
  const outerDelete=await deleteAnnotationThread(scope,row.id,(await db.annotations.get(row.id))!.revision!);
  await rejects(()=>db.transaction('rw',db.tables,async()=>{await undoAnnotationThread(outerDelete.undo);throw Error('synthetic_outer_commit_abort');}));assert(!await db.annotations.get(row.id),'Outer abort left restored comment');await undoAnnotationThread(outerDelete.undo);assert((await db.annotations.get(row.id))!.replies![0].body==='Newer reply','Outer abort consumed receipt or lost content');
  let aborted:AnnotationUndo|undefined;await rejects(()=>db.transaction('rw',db.tables,async()=>{aborted=(await deleteAnnotationThread(scope,row.id,(await db.annotations.get(row.id))!.revision!)).undo;throw Error('synthetic_delete_outer_abort');}));assert(await db.annotations.get(row.id),'Delete abort lost comment');await deleteAnnotation(row.id,scope);await rejects(()=>undoAnnotationThread(aborted!));assert(!await db.annotations.get(row.id),'Aborted delete issued a usable receipt');
  return['Real reference-key restore failure rolls back the comment and leaves its exact receipt retryable','Consumed edit/delete receipts cannot replay; concurrent cloned receipts have exactly one winner and preserve later replies','Outer transaction abort preserves Undo availability; aborted deletion cannot issue a usable receipt'];
 }finally{await deleteProject(P);}
}
export async function testCommentOrphanReceipts(){
 const P='comment-orphan-receipts',Q=P+'-foreign';let clone:string|undefined;
 const project=(id:string)=>({id,title:id,type:'standalone' as const,mode:'custom' as const,description:'',status:'draft' as const,color:'#777777',enabledEngines:['annotations','codex'],engineOrder:[],createdAt:1,updatedAt:1});
 try{await db.projects.bulkPut([project(P),project(Q)]);await db.codexEntries.put({id:Q+'-card',projectId:Q,title:'Foreign source',type:'custom',fields:{},content:'',tags:[],relations:[],createdAt:1,updatedAt:1});
  const payload=await exportProjectData(P);payload.annotations=[{id:P+'-legacy',projectId:P,sourceEngineId:'outline',sourceEntityId:'missing-legacy',anchor:{type:'entity'},noteType:'text',noteBody:'Retained orphan',isOrphaned:true,position:0,createdAt:1,updatedAt:1,replies:[{id:'reply',body:'Retained answer',createdAt:1,updatedAt:1}]}];clone=await importProjectData(payload);const row=(await db.annotations.where('projectId').equals(clone).toArray())[0],scope={projectId:clone},deleted=await deleteAnnotationThread(scope,row.id,row.revision??0);
  const altered=structuredClone(deleted.undo);assert(altered.kind==='delete','Deletion receipt kind');altered.before.sourceEngineId='codex';altered.before.sourceEntityId=Q+'-card';await rejects(()=>undoAnnotationThread(altered));assert(!await db.annotations.get(row.id),'Changed orphan source was accepted');
  await rejects(()=>createAnnotation({...row,id:'new-orphan-with-foreign-source',sourceEngineId:'codex',sourceEntityId:Q+'-card'}));assert(!await db.annotations.get('new-orphan-with-foreign-source'),'New foreign-source orphan accepted');
  const restored=await undoAnnotationThread(deleted.undo);assert(restored.isOrphaned&&restored.sourceEntityId===row.sourceEntityId&&restored.noteBody===row.noteBody&&restored.replies![0].body==='Retained answer','Original orphan receipt cannot retry or lost discussion');
  return['Normal imported orphan restores its exact source/text/replies after rejected altered-source receipt; new foreign-source comments remain rejected'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);await deleteProject(Q);}
}
