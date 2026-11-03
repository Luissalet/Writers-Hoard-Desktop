import {tableCellOf} from './tableFormat';
import type {LocalToolConvergenceIdentity} from './types';
import type {RichBlocks,RichBlockPlan} from './blocks';
import type {RichRuns,RichBindings} from './richRuns';
import type {RichSplitCapture,RichJoinCapture,RichAction} from './richTypes';
import {richBlockLeaves,type RichBlockDocument,type RichBlockPlacement,type RichBlockBindings,type RichBlock} from './blockTypes';
import {captureBlockEdit,richBlockChildren} from './blockEditing';
import type {RichBlockEditCapture} from './blockEditingTypes';
import {convergenceClone,convergenceCanonical} from './format';

export interface RichBlockSplitCapture extends RichBlockEditCapture {text:RichSplitCapture}
export interface RichBlockJoinCapture extends RichBlockEditCapture {text:RichJoinCapture}
export type RichBlockTextAction=
 |{type:'rich-block-split';field:string;capture:RichBlockSplitCapture;newNodeId:string;newItemId?:string}
 |{type:'rich-block-join';field:string;capture:RichBlockJoinCapture};
const fail=():never=>{throw Error('local_tool_block_text_capture_invalid');};
/** A current parent never substitutes for the container proved in the capture. */
function capturedBlock(source:RichBlocks,capture:RichBlockJoinCapture,id:string|null){
 if(id===null)return undefined;const binding=capture.bindings.find(b=>b.id===id);if(!binding)return undefined;
 const kind=source.registers.versions.get(binding.kindVersionId),place=source.registers.versions.get(binding.placementVersionId);if(!kind?.present||!place?.present)return fail();
 return{id,type:kind.value as RichBlock['type'],...convergenceClone(place.value) as unknown as RichBlockPlacement};
}
export function captureBlockSplit(source:RichBlocks,rich:RichRuns,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,textBindings:RichBindings,nodeId:string,at:number):RichBlockSplitCapture {
 const capture=captureBlockEdit(source,identity,data,bindings,[nodeId]);
 return{...capture,text:rich.splitCapture(identity,nodeId,at,'right',{data:richBlockLeaves(data,source.links,source.tables),bindings:textBindings})};
}
/** Structural adjacency is proved before adapting the two own text witnesses. */
export function captureBlockJoin(source:RichBlocks,rich:RichRuns,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,textBindings:RichBindings,leftId:string,rightId:string):RichBlockJoinCapture {
 const capture=captureBlockEdit(source,identity,data,bindings,[leftId,rightId]),left=data.blocks.find(b=>b.id===leftId),right=data.blocks.find(b=>b.id===rightId);if(!left?.content||!right?.content)return fail();
 if(source.tables&&tableCellOf(data,leftId)!==tableCellOf(data,rightId))return fail();
 const summaryBody=left.parentId===right.parentId&&left.slot==='summary'&&right.slot==='body'&&data.blocks.find(b=>b.id===left.parentId)?.type==='toggle';
 if(summaryBody){if(richBlockChildren(data,left.parentId,'body')[0]?.id!==rightId)return fail();}
 else if(left.parentId===right.parentId&&left.slot===right.slot){const siblings=richBlockChildren(data,left.parentId,left.slot),at=siblings.findIndex(b=>b.id===leftId);if(siblings[at+1]?.id!==rightId)return fail();}
 else{
  const lp=data.blocks.find(b=>b.id===left.parentId),rp=data.blocks.find(b=>b.id===right.parentId);if(lp?.type!=='list-item'||rp?.type!=='list-item'||lp.parentId!==rp.parentId||lp.slot!==rp.slot)return fail();
  const items=richBlockChildren(data,lp.parentId,lp.slot),at=items.findIndex(b=>b.id===lp.id);if(items[at+1]?.id!==rp.id||richBlockChildren(data,lp.id).at(-1)?.id!==leftId||richBlockChildren(data,rp.id)[0]?.id!==rightId)return fail();
 }
 const flat=richBlockLeaves(data,source.links,source.tables),pair={type:'doc' as const,content:[leftId,rightId].map(id=>flat.content.find(p=>p.id===id)!)};
 return{...capture,text:rich.joinCapture(identity,leftId,rightId,{data:pair,bindings:{nodes:[leftId,rightId].map(id=>textBindings.nodes.find(n=>n.id===id)!)}})};
}
export function validateBlockTextCapture(source:RichBlocks,rich:RichRuns,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,textBindings:RichBindings,action:RichBlockTextAction):void {
 const c=action.capture,expected=action.type==='rich-block-split'?captureBlockSplit(source,rich,identity,data,bindings,textBindings,c.nodeIds[0],(c as RichBlockSplitCapture).text.range.deleteIds.length===0?textBindings.nodes.find(n=>n.id===c.nodeIds[0])!.units.length:textBindings.nodes.find(n=>n.id===c.nodeIds[0])!.units.findIndex(u=>u.id===(c as RichBlockSplitCapture).text.range.right)):captureBlockJoin(source,rich,identity,data,bindings,textBindings,c.nodeIds[0],c.nodeIds[1]);
 if(convergenceCanonical(expected)!==convergenceCanonical(c))return fail();
}
export function prepareBlockText(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,action:RichBlockTextAction):RichBlockPlan&{textAction:RichAction} {
 const result:RichBlockPlan={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[]},selected=action.capture.nodeIds.map(id=>result.data.blocks.find(b=>b.id===id)??fail());
 if(source.tables&&action.type==='rich-block-join'&&tableCellOf(data,selected[0].id)!==tableCellOf(data,selected[1].id))return fail();
 const write=(name:RichBlockPlan['writes'][number]['name'],id:string,value:unknown)=>result.writes.push({name,id,value:convergenceClone(value) as never});
 const move=(id:string,place:RichBlockPlacement)=>{const b=result.data.blocks.find(b=>b.id===id)??fail();Object.assign(b,place);write('placement',id,place);};
 const put=(id:string,type:'paragraph'|'list-item',place:RichBlockPlacement)=>{if(source.registers.entries(source.root('kind'),id).length||result.data.blocks.some(b=>b.id===id))return fail();const b={id,type,attrs:{},...place,...(type==='paragraph'?{content:[]}:{})};result.data.blocks.push(b);for(const[name,value]of Object.entries({kind:type,attrs:{},membership:true,placement:place}))write(name as RichBlockPlan['writes'][number]['name'],id,value);};
 let textAction:RichAction;
 if(action.type==='rich-block-split'){
  const leaf=selected[0],parent=result.data.blocks.find(b=>b.id===leaf.parentId);let place:RichBlockPlacement={parentId:leaf.parentId,slot:leaf.slot,afterId:leaf.id};
  if(parent?.type==='list-item'&&action.newItemId){put(action.newItemId,'list-item',{parentId:parent.parentId,slot:parent.slot,afterId:parent.id});for(const b of result.data.blocks)if(b.id!==action.newItemId&&b.parentId===parent.parentId&&b.slot===parent.slot&&b.afterId===parent.id)move(b.id,{parentId:b.parentId,slot:b.slot,afterId:action.newItemId!});place={parentId:action.newItemId,slot:'body',afterId:null};}
  else if(leaf.slot==='summary')place={parentId:leaf.parentId,slot:'body',afterId:null};
  for(const b of result.data.blocks)if(b.parentId===place.parentId&&b.slot===place.slot&&b.afterId===place.afterId)move(b.id,{parentId:b.parentId,slot:b.slot,afterId:action.newNodeId});
  put(action.newNodeId,'paragraph',place);textAction={type:'rich-split',field:action.field,capture:action.capture.text,newNodeId:action.newNodeId};
 }else{
  const [left,right]=selected,capturedLeft=capturedBlock(source,action.capture,left.id),capturedRight=capturedBlock(source,action.capture,right.id),leftItem=capturedBlock(source,action.capture,capturedLeft?.parentId??null),rightItem=capturedBlock(source,action.capture,capturedRight?.parentId??null),currentLeft=result.data.blocks.find(b=>b.id===left.parentId),currentRight=result.data.blocks.find(b=>b.id===right.parentId);
  const mergeItems=leftItem?.type==='list-item'&&rightItem?.type==='list-item'&&leftItem.id!==rightItem.id&&leftItem.parentId===rightItem.parentId&&left.parentId===leftItem.id&&right.parentId===rightItem.id&&currentLeft?.type==='list-item'&&currentRight?.type==='list-item'&&currentLeft.parentId===leftItem.parentId&&currentRight.parentId===rightItem.parentId;
  if(mergeItems){
   const children=richBlockChildren(result.data,rightItem.id).filter(b=>b.id!==right.id);let previous=richBlockChildren(result.data,leftItem.id).at(-1)?.id??left.id;
   for(const b of children){move(b.id,{parentId:leftItem.id,slot:'body',afterId:previous});previous=b.id;}
   for(const b of result.data.blocks)if(b.parentId===currentRight.parentId&&b.slot===currentRight.slot&&b.afterId===currentRight.id)move(b.id,{parentId:b.parentId,slot:b.slot,afterId:currentRight.afterId});
   write('membership',rightItem.id,false);result.data.blocks=result.data.blocks.filter(b=>b.id!==rightItem.id);
  }else{
   for(const b of result.data.blocks)if(b.parentId===right.parentId&&b.slot===right.slot&&b.afterId===right.id)move(b.id,{parentId:b.parentId,slot:b.slot,afterId:right.afterId});
  }
  write('membership',right.id,false);result.data.blocks=result.data.blocks.filter(b=>b.id!==right.id);textAction={type:'rich-join',field:action.field,capture:action.capture.text};
 }
 result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return{...result,textAction};
}
