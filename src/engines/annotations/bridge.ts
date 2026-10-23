import {db} from '@/db';
import {requireString,optString,resolveProjectId,BridgeError,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {readScopedAnnotation} from './scope';
import {mutateAnnotationThread,deleteAnnotationThread,undoAnnotationThread,markAnnotationThreadsRead,undoAnnotationReadBatch,type AnnotationThreadAction} from './threads';
import {isThreadUnread} from './readState';
import type {AnnotationMention,AnnotationUndo} from './types';
const scope=(args:ToolArgs)=>({projectId:resolveProjectId(args),eraId:optString(args,'eraId')});
const revision=(args:ToolArgs)=>{if(!Number.isSafeInteger(args.expectedRevision)||Number(args.expectedRevision)<0)throw new BridgeError('bad-args','Read the current thread revision before editing.');return args.expectedRevision as number;};
const mentions=(args:ToolArgs):AnnotationMention[]|undefined=>{if(args.mentions===undefined)return undefined;if(!Array.isArray(args.mentions))throw new BridgeError('bad-args','mentions must be local engine/entity references.');return args.mentions as AnnotationMention[];};
// Everything the bridge writes leaves the thread unread for the writer, and its replies count as new.
const mutate=(args:ToolArgs,action:AnnotationThreadAction)=>mutateAnnotationThread(scope(args),requireString(args,'id'),revision(args),action,'bridge');
export const ANNOTATION_THREAD_HANDLERS={
 async wh_annotation_thread_get(args:ToolArgs){const target=scope(args),annotation=await readScopedAnnotation(target,requireString(args,'id'));return{...annotation,revision:annotation.revision??0,replies:annotation.replies??[],mentions:annotation.mentions??[],resolved:!!annotation.resolvedAt,unread:isThreadUnread(annotation),readAt:annotation.readAt,reference:await db.annotationReferences.where('annotationId').equals(annotation.id).first()};},
 async wh_annotation_reply(args:ToolArgs){return mutate(args,{kind:'reply',body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_edit_reply(args:ToolArgs){return mutate(args,{kind:'edit-reply',replyId:requireString(args,'replyId'),body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_remove_reply(args:ToolArgs){return mutate(args,{kind:'remove-reply',replyId:requireString(args,'replyId')});},
 async wh_annotation_move(args:ToolArgs){if(typeof args.x!=='number'||typeof args.y!=='number')throw new BridgeError('bad-args','x and y are numbers: percent of the picture on a map, board coordinates on a board.');try{return await mutate(args,{kind:'move',x:args.x,y:args.y});}catch(error){if(error instanceof Error&&error.message==='annotation_not_on_map')throw new BridgeError('bad-args','Only comments left at a spot on a classic map or a board can be moved.');if(error instanceof Error&&error.message==='annotation_spot_invalid')throw new BridgeError('bad-args','On a map x and y are percent of the picture (0 to 100); on a board they are board coordinates.');throw error;}},
 async wh_annotation_update(args:ToolArgs){return mutate(args,{kind:'body',body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_mark_read(args:ToolArgs){if(args.read!==undefined&&typeof args.read!=='boolean')throw new BridgeError('bad-args','read must be true or false.');return mutateAnnotationThread(scope(args),requireString(args,'id'),revision(args),{kind:'read',read:args.read!==false},'bridge');},
 async wh_annotation_mark_all_read(args:ToolArgs){const engineId=optString(args,'engineId'),entityId=optString(args,'entityId');if(entityId&&!engineId)throw new BridgeError('bad-args','entityId needs engineId too: ids are only unique within an engine.');const done=await markAnnotationThreadsRead(scope(args),{engineId,entityId});return{marked:done.marked,undo:done.undo};},
 async wh_annotation_set_resolved(args:ToolArgs){if(typeof args.resolved!=='boolean')throw new BridgeError('bad-args','resolved must be true or false.');return mutate(args,{kind:'resolve',resolved:args.resolved});},
 async wh_annotation_delete(args:ToolArgs){return deleteAnnotationThread(scope(args),requireString(args,'id'),revision(args));},
 async wh_annotation_undo(args:ToolArgs){if(!args.receipt||typeof args.receipt!=='object'||Array.isArray(args.receipt))throw new BridgeError('bad-args','Use the receipt returned by a thread mutation.');const receipt=args.receipt as AnnotationUndo,target=scope(args);if(receipt.projectId!==target.projectId||receipt.eraId!==target.eraId||!['edit','delete','read-batch'].includes(receipt.kind))throw new BridgeError('bad-args','Receipt belongs to another comment context.');if(receipt.kind==='read-batch')return await undoAnnotationReadBatch(receipt);return{annotation:await undoAnnotationThread(receipt)};},
};
