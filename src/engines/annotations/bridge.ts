import {db} from '@/db';
import {requireString,optString,resolveProjectId,BridgeError,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {readScopedAnnotation} from './scope';
import {mutateAnnotationThread,deleteAnnotationThread,undoAnnotationThread,type AnnotationThreadAction} from './threads';
import type {AnnotationMention,AnnotationUndo} from './types';
const scope=(args:ToolArgs)=>({projectId:resolveProjectId(args),eraId:optString(args,'eraId')});
const revision=(args:ToolArgs)=>{if(!Number.isSafeInteger(args.expectedRevision)||Number(args.expectedRevision)<0)throw new BridgeError('bad-args','Read the current thread revision before editing.');return args.expectedRevision as number;};
const mentions=(args:ToolArgs):AnnotationMention[]|undefined=>{if(args.mentions===undefined)return undefined;if(!Array.isArray(args.mentions))throw new BridgeError('bad-args','mentions must be local engine/entity references.');return args.mentions as AnnotationMention[];};
const mutate=(args:ToolArgs,action:AnnotationThreadAction)=>mutateAnnotationThread(scope(args),requireString(args,'id'),revision(args),action);
export const ANNOTATION_THREAD_HANDLERS={
 async wh_annotation_thread_get(args:ToolArgs){const target=scope(args),annotation=await readScopedAnnotation(target,requireString(args,'id'));return{...annotation,revision:annotation.revision??0,replies:annotation.replies??[],mentions:annotation.mentions??[],resolved:!!annotation.resolvedAt,reference:await db.annotationReferences.where('annotationId').equals(annotation.id).first()};},
 async wh_annotation_reply(args:ToolArgs){return mutate(args,{kind:'reply',body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_edit_reply(args:ToolArgs){return mutate(args,{kind:'edit-reply',replyId:requireString(args,'replyId'),body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_remove_reply(args:ToolArgs){return mutate(args,{kind:'remove-reply',replyId:requireString(args,'replyId')});},
 async wh_annotation_update(args:ToolArgs){return mutate(args,{kind:'body',body:requireString(args,'body'),mentions:mentions(args)});},
 async wh_annotation_set_resolved(args:ToolArgs){if(typeof args.resolved!=='boolean')throw new BridgeError('bad-args','resolved must be true or false.');return mutate(args,{kind:'resolve',resolved:args.resolved});},
 async wh_annotation_delete(args:ToolArgs){return deleteAnnotationThread(scope(args),requireString(args,'id'),revision(args));},
 async wh_annotation_undo(args:ToolArgs){if(!args.receipt||typeof args.receipt!=='object'||Array.isArray(args.receipt))throw new BridgeError('bad-args','Use the receipt returned by a thread mutation.');const receipt=args.receipt as AnnotationUndo,target=scope(args);if(receipt.projectId!==target.projectId||receipt.eraId!==target.eraId||!['edit','delete'].includes(receipt.kind))throw new BridgeError('bad-args','Receipt belongs to another comment context.');return{annotation:await undoAnnotationThread(receipt)};},
};
