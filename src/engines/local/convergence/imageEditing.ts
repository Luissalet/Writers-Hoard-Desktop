import {assertConvergenceIdentity,convergenceCanonical,convergenceClone} from './format';
import {isRichImageSize,validateRichImageAsset,type RichImageAsset,type RichImageCapture,type RichImageChannel,type RichImageSize} from './imageFormat';
import type {RichBlockDocument,RichBlockBindings} from './blockFormat';
import type {RichBlocks,RichBlockPlan} from './blocks';
import type {LocalToolConvergenceIdentity} from './formatTypes';

export type {RichImageCapture,RichImageChannel} from './imageFormat';
export type RichImageEditAction=
 |{type:'rich-image-replace';field:string;capture:RichImageCapture;asset:RichImageAsset}
 |{type:'rich-image-resize';field:string;capture:RichImageCapture;displaySize:RichImageSize};
export const isImageEditAction=(action:{type:string}):action is RichImageEditAction=>action.type==='rich-image-replace'||action.type==='rich-image-resize';
const fail=():never=>{throw Error('local_tool_image_action_invalid');};

function witness(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,nodeId:string,channel:RichImageChannel){
 if(!source.images||channel!=='source'&&channel!=='size'||!data.blocks.some(b=>b.id===nodeId&&b.type==='image'))return fail();
 const binding=bindings.nodes.find(b=>b.id===nodeId);
 const versionId=channel==='source'?binding?.imageSourceVersionId:binding?.imageSizeVersionId;
 if(!binding||!versionId)return fail();
 return {kindVersionId:binding.kindVersionId,membershipVersionId:binding.membershipVersionId,placementVersionId:binding.placementVersionId,versionId};
}
export function captureImage(source:RichBlocks,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeId:string,channel:RichImageChannel):RichImageCapture {
 if(!bindings)return fail();
 source.check(data,bindings);
 return convergenceClone({format:'writers-hoard-image-capture/1',identity,field:source.field,nodeId,channel,...witness(source,data,bindings,nodeId,channel),frontier:source.registers.frontier()});
}

export function prepareImageEdit(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,action:RichImageEditAction,identity:LocalToolConvergenceIdentity):RichBlockPlan {
 const {capture}=action,replace=action.type==='rich-image-replace',channel=replace?'source':'size',payload=replace?'asset':'displaySize';
 assertConvergenceIdentity(capture.identity,identity);
 if(action.field!==source.field||capture.field!==source.field||capture.channel!==channel||Object.keys(action).length!==4||!Object.hasOwn(action,payload))return fail();
 const current=witness(source,data,bindings,capture.nodeId,channel);
 if(current.kindVersionId!==capture.kindVersionId||current.membershipVersionId!==capture.membershipVersionId||
    current.placementVersionId!==capture.placementVersionId||current.versionId!==capture.versionId)return fail();
 const result:RichBlockPlan={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[]};
 const node=result.data.blocks.find(b=>b.id===capture.nodeId)!;
 const value=replace?action.asset:action.displaySize;
 if(replace)validateRichImageAsset(value);else if(!isRichImageSize(value))return fail();
 if(convergenceCanonical(node.attrs[payload])!==convergenceCanonical(value)){
  node.attrs[payload]=convergenceClone(value);
  result.writes.push({name:replace?'imageSource':'imageSize',id:node.id,value:convergenceClone(value)});
 }
 return result;
}
