import { db } from '@/db';
import type {Transaction} from 'dexie';
import type { WorldEraScope } from '@/services/worldEras/types';
import { assertWorldEra, announceEraChange } from '@/services/worldEras/store';
import { readScopedAnnotation, validateAnnotationMentions, validateAnnotationSource } from './scope';
import { AnnotationConflict, type Annotation, type AnnotationMention, type AnnotationThreadFields, type AnnotationUndo } from './types';
export type AnnotationThreadAction={kind:'move';x:number;y:number}|{kind:'body';body:string;mentions?:AnnotationMention[]}|{kind:'reply';body:string;mentions?:AnnotationMention[];replyId?:string}|{kind:'edit-reply';replyId:string;body:string;mentions?:AnnotationMention[]}|{kind:'remove-reply';replyId:string}|{kind:'resolve';resolved:boolean};
const fields=(row:Annotation):AnnotationThreadFields=>structuredClone({noteBody:row.noteBody,mentions:row.mentions,replies:row.replies,resolvedAt:row.resolvedAt,...(row.anchor?.type==='map_point'?{anchor:row.anchor}:{})});
function expect(row:Annotation,revision:number){if(!Number.isSafeInteger(revision)||revision<0||(row.revision??0)!==revision)throw new AnnotationConflict();}
function body(value:string):string{if(typeof value!=='string'||!value.trim())throw Error('annotation_body_required');return value;}
const notify=(scope:WorldEraScope)=>announceEraChange(scope.projectId);
// Session receipts identify an Undo action, not another copy of comment history.
const receipts=new Map<string,{projectId:string;eraId?:string;annotationId:string;kind:AnnotationUndo['kind'];expectedRevision?:number;orphanSource?:{engineId:string;entityId:string};claimed?:Transaction}>();
function outerTransaction(tx:Transaction):Transaction{while(tx.parent)tx=tx.parent;return tx;}
function issue<T extends Omit<Extract<AnnotationUndo,{kind:'edit'}>,'receiptId'>|Omit<Extract<AnnotationUndo,{kind:'delete'}>,'receiptId'>>(tx:Transaction,receipt:T):T&{receiptId:string}{
 const receiptId=crypto.randomUUID(),entry={projectId:receipt.projectId,eraId:receipt.eraId,annotationId:receipt.annotationId,kind:receipt.kind,expectedRevision:receipt.kind==='edit'?receipt.expectedRevision:undefined,orphanSource:receipt.kind==='delete'&&receipt.before.isOrphaned?{engineId:receipt.before.sourceEngineId,entityId:receipt.before.sourceEntityId}:undefined};
 receipts.set(receiptId,entry);outerTransaction(tx).on('abort',()=>{receipts.delete(receiptId);});return{...receipt,receiptId};
}
function claim(tx:Transaction,receipt:AnnotationUndo){
 const entry=receipts.get(receipt.receiptId);
 if(!entry||entry.claimed||entry.projectId!==receipt.projectId||entry.eraId!==receipt.eraId||entry.annotationId!==receipt.annotationId||entry.kind!==receipt.kind||entry.expectedRevision!==(receipt.kind==='edit'?receipt.expectedRevision:undefined))throw new AnnotationConflict();
 const outer=outerTransaction(tx);entry.claimed=outer;
 outer.on('complete',()=>{receipts.delete(receipt.receiptId);});
 outer.on('abort',()=>{if(receipts.get(receipt.receiptId)===entry)entry.claimed=undefined;});
 return entry;
}
export async function mutateAnnotationThread(scope:WorldEraScope,id:string,expectedRevision:number,action:AnnotationThreadAction):Promise<{annotation:Annotation;undo:AnnotationUndo}>{
 const result=await db.transaction('rw',db.tables,async tx=>{
  const current=await readScopedAnnotation(scope,id);expect(current,expectedRevision);const before=fields(current),next=structuredClone(current),now=Math.max(Date.now(),current.updatedAt+1);
  if(action.kind==='move'){if(current.anchor.type!=='map_point')throw Error('annotation_not_on_map');const inRange=(value:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;if(!inRange(action.x)||!inRange(action.y))throw Error('annotation_spot_invalid');next.anchor={...current.anchor,x:action.x,y:action.y};}
  else if(action.kind==='body'){if(current.noteType!=='text')throw Error('annotation_text_required');next.noteBody=body(action.body);next.mentions=await validateAnnotationMentions(scope,action.mentions??current.mentions);}
  else if(action.kind==='resolve'){if(typeof action.resolved!=='boolean')throw Error('annotation_status_invalid');next.resolvedAt=action.resolved?now:undefined;}
  else{const replies=[...current.replies??[]];if(action.kind==='reply'){const replyId=action.replyId??crypto.randomUUID();if(replies.some(reply=>reply.id===replyId))throw Error('annotation_reply_exists');replies.push({id:replyId,body:body(action.body),mentions:await validateAnnotationMentions(scope,action.mentions),createdAt:now,updatedAt:now});}
   else{const index=replies.findIndex(reply=>reply.id===action.replyId);if(index<0)throw Error('annotation_reply_missing');if(action.kind==='remove-reply')replies.splice(index,1);else replies[index]={...replies[index],body:body(action.body),mentions:await validateAnnotationMentions(scope,action.mentions??replies[index].mentions),updatedAt:now};}next.replies=replies;}
  next.revision=(current.revision??0)+1;next.updatedAt=now;await db.annotations.put(next);return{annotation:next,undo:issue(tx,{...scope,annotationId:id,expectedRevision:next.revision,kind:'edit' as const,before})};
 });notify(scope);return result;
}
export async function deleteAnnotationThread(scope:WorldEraScope,id:string,expectedRevision:number):Promise<{undo:AnnotationUndo}>{const result=await db.transaction('rw',db.annotations,db.annotationReferences,db.projects,async tx=>{const before=await readScopedAnnotation(scope,id);expect(before,expectedRevision);const reference=await db.annotationReferences.where('annotationId').equals(id).first();await db.annotationReferences.where('annotationId').equals(id).delete();await db.annotations.delete(id);return{undo:issue(tx,{...scope,annotationId:id,kind:'delete' as const,before,reference})};});notify(scope);return result;}
export async function undoAnnotationThread(receipt:AnnotationUndo):Promise<Annotation>{
 const scope={projectId:receipt.projectId,eraId:receipt.eraId};const result=await db.transaction('rw',db.tables,async tx=>{
  await assertWorldEra(scope);
  const issued=claim(tx,receipt);
  if(receipt.kind==='delete'){if(await db.annotations.get(receipt.annotationId))throw new AnnotationConflict();const row=structuredClone(receipt.before);if(row.id!==receipt.annotationId||row.projectId!==scope.projectId||row.eraId!==scope.eraId)throw Error('annotation_undo_scope_invalid');if(issued.orphanSource){if(!row.isOrphaned||row.sourceEngineId!==issued.orphanSource.engineId||row.sourceEntityId!==issued.orphanSource.entityId)throw Error('annotation_undo_source_invalid');}else await validateAnnotationSource(row);row.revision=(row.revision??0)+1;row.updatedAt=Math.max(Date.now(),row.updatedAt+1);await db.annotations.add(row);if(receipt.reference){if(receipt.reference.annotationId!==row.id)throw Error('annotation_reference_invalid');await db.annotationReferences.add(receipt.reference);}return row;}
  const current=await readScopedAnnotation(scope,receipt.annotationId);expect(current,receipt.expectedRevision);const before=receipt.before;
  await validateAnnotationMentions(scope,before.mentions);for(const reply of before.replies??[])await validateAnnotationMentions(scope,reply.mentions);
  const next={...current,...fields(before as Annotation),revision:(current.revision??0)+1,updatedAt:Math.max(Date.now(),current.updatedAt+1)};await db.annotations.put(next);return next;
 });notify(scope);return result;
}
