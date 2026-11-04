import {prepareTableInsert} from './tableEditing';
import {prepareTableAxes} from './tableAxesEditing';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import type {LocalToolJson} from '@/engines/local/stateTypes';
import {convergenceClone,assertConvergenceIdentity} from '@/engines/local/convergence/format';
import {validateRichBlockDocument,validateRichBlockPlacement,richBlockLeaf,type RichBlock,type RichBlockDocument,type RichBlockBindings,type RichBlockPlacement} from '@/engines/local/convergence/blockTypes';
import {blockBirthWrites,type RichBlockPlan,type RichBlocks} from '@/engines/local/convergence/blocks';
import {validateRichImageAsset} from './imageFormat';
import type {LocalToolConvergenceIdentity} from '@/engines/local/convergence/types';
import type {RichAction} from '@/engines/local/convergence/richTypes';
import type {RichBlockEditingAction,RichBlockEditCapture} from '@/engines/local/convergence/blockEditingTypes';

const fail=():never=>{throw Error('local_tool_block_edit_invalid');};
type PlacementWitness=Pick<RichBlock,'id'|'type'|'parentId'|'slot'|'afterId'>;
function capturedPlacement(source:RichBlocks,capture:RichBlockEditCapture,id:string|null):PlacementWitness|undefined {
 if(id===null)return undefined;const binding=capture.bindings.find(b=>b.id===id);if(!binding)return undefined;
 const kind=source.registers.versions.get(binding.kindVersionId),place=source.registers.versions.get(binding.placementVersionId);if(!kind?.present||!place?.present)return fail();
 return{id,type:kind.value as RichBlock['type'],...convergenceClone(place.value) as unknown as RichBlockPlacement};
}
export function isBlockEditingAction(value:{type:string}):value is RichBlockEditingAction{return ['rich-image-insert','rich-table-create','rich-table-insert','rich-block-list-indent','rich-block-insert','rich-block-transform','rich-block-container','rich-block-hide','rich-block-unwrap'].includes(value.type);}
/** Stable sibling traversal. Anchors outside this slot act as retained head anchors. */
export function richBlockChildren<T extends RichBlockPlacement&{id:string}>(data:{blocks:readonly T[]},parentId:string|null,slot:RichBlockPlacement['slot']='body'):T[]{
 const children=data.blocks.filter(b=>b.parentId===parentId&&b.slot===slot),ids=new Set(children.map(b=>b.id)),out:T[]=[],seen=new Set<string>();
 const visit=(anchor:string|null)=>{for(const b of children.filter(b=>(b.afterId!==null&&ids.has(b.afterId)?b.afterId:null)===anchor).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){if(seen.has(b.id))return fail();seen.add(b.id);out.push(b);visit(b.id);}};
 visit(null);if(out.length!==children.length)return fail();return out;
}
export function captureBlockEdit(source:RichBlocks,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeIds:string[],destination?:RichBlockPlacement):RichBlockEditCapture {
 source.check(data,bindings);if(!Array.isArray(nodeIds)||new Set(nodeIds).size!==nodeIds.length||nodeIds.some(id=>!data.blocks.some(b=>b.id===id)))return fail();
 if(destination){validateRichBlockPlacement(destination);const parent=destination.parentId===null?null:data.blocks.find(b=>b.id===destination.parentId);if(destination.parentId!==null&&(!parent||richBlockLeaf(parent.type)))return fail();if(destination.afterId!==null&&!data.blocks.some(b=>b.id===destination.afterId&&b.parentId===destination.parentId&&b.slot===destination.slot))return fail();}
 else if(!nodeIds.length)return fail();
 return{format:'writers-hoard-block-edit/1',identity:convergenceClone(identity),field:source.field,nodeIds:convergenceClone(nodeIds),bindings:convergenceClone(bindings.nodes),frontier:source.registers.frontier(),...(destination?{destination:convergenceClone(destination)}:{})};
}
export function prepareBlockEdit(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,action:RichBlockEditingAction,identity:LocalToolConvergenceIdentity,intrinsicLastLeaf:string|null):RichBlockPlan&{textActions:RichAction[]} {
 assertConvergenceIdentity(action.capture.identity,identity);if(action.field!==source.field||action.capture.field!==source.field)return fail();
 const result={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[] as RichBlockPlan['writes'],textActions:[] as RichAction[]};
 const write=(name:RichBlockPlan['writes'][number]['name'],id:string,value:unknown)=>result.writes.push({name,id,value:convergenceClone(value) as LocalToolJson});
 const selected=action.capture.nodeIds.map(id=>result.data.blocks.find(b=>b.id===id)??fail());
 const move=(b:RichBlock,to:RichBlockPlacement)=>{Object.assign(b,to);write('placement',b.id,to);};
 const put=(block:RichBlock)=>{if(source.registers.entries(source.root('kind'),block.id).length||result.data.blocks.some(b=>b.id===block.id))return fail();result.data.blocks.push(block);for(const{name,value}of blockBirthWrites(block,source.alignment))write(name,block.id,value);};
 if(action.type==='rich-table-create')return prepareTableAxes(source,data,bindings,action,identity,intrinsicLastLeaf);
 else if(action.type==='rich-table-insert')return prepareTableInsert(source,data,bindings,action,intrinsicLastLeaf);
 else if(action.type==='rich-block-list-indent'){
  if(selected.length!==1)return fail();
  const leafWitness=capturedPlacement(source,action.capture,selected[0].id),itemWitness=capturedPlacement(source,action.capture,leafWitness?.parentId??null),listWitness=capturedPlacement(source,action.capture,itemWitness?.parentId??null);
  const listKind=(kind:RichBlock['type']|undefined)=>kind==='bullet-list'||kind==='ordered-list';
  if(!leafWitness||itemWitness?.type!=='list-item'||!listWitness||!listKind(listWitness.type)||selected[0].parentId!==itemWitness.id||selected[0].slot!==leafWitness.slot)return fail();
  const item=result.data.blocks.find(b=>b.id===itemWitness.id),list=result.data.blocks.find(b=>b.id===listWitness.id);
  if(item?.type!=='list-item'||!list||!listKind(list.type)||item.parentId!==list.id||item.slot!==itemWitness.slot)return fail();
  // Order only the capture's retained metadata; this never creates text witnesses.
  const captured={blocks:action.capture.bindings.map(b=>capturedPlacement(source,action.capture,b.id)??fail())},oldSiblings=richBlockChildren(captured,list.id,itemWitness.slot),oldAt=oldSiblings.findIndex(b=>b.id===item.id),siblings=richBlockChildren(result.data,list.id,item.slot),oldAfter=item.afterId;
  if(action.direction==='in'){
   const previousWitness=oldSiblings[oldAt-1],previous=result.data.blocks.find(b=>b.id===previousWitness?.id);if(previousWitness?.type!=='list-item'||previous?.type!=='list-item'||previous.parentId!==list.id||previous.slot!==previousWitness.slot)return fail();
   const nestedWitness=richBlockChildren(captured,previous.id).find(b=>b.type===list.type);let nested=nestedWitness?result.data.blocks.find(b=>b.id===nestedWitness.id):undefined;
   if(nestedWitness&&(!nested||nested.type!==list.type||nested.parentId!==previous.id||nested.slot!==nestedWitness.slot))return fail();
   if(!nested){if(!action.listId)return fail();nested={id:action.listId,type:list.type,attrs:convergenceClone(list.attrs),parentId:previous.id,slot:'body',afterId:richBlockChildren(result.data,previous.id).at(-1)?.id??null};put(nested);}
   const after=richBlockChildren(result.data,nested.id).at(-1)?.id??null;for(const b of siblings)if(b.afterId===item.id)move(b,{parentId:b.parentId,slot:b.slot,afterId:oldAfter});move(item,{parentId:nested.id,slot:'body',afterId:after});
  }else{
   const ownerWitness=capturedPlacement(source,action.capture,listWitness.parentId),outerWitness=capturedPlacement(source,action.capture,ownerWitness?.parentId??null),owner=result.data.blocks.find(b=>b.id===ownerWitness?.id),outer=result.data.blocks.find(b=>b.id===outerWitness?.id);
   if(ownerWitness?.type!=='list-item'||!outerWitness||!listKind(outerWitness.type)||owner?.type!=='list-item'||!outer||!listKind(outer.type)||list.parentId!==owner.id||list.slot!==listWitness.slot||owner.parentId!==outer.id||owner.slot!==ownerWitness.slot)return fail();
   for(const b of siblings)if(b.afterId===item.id)move(b,{parentId:b.parentId,slot:b.slot,afterId:oldAfter});for(const b of richBlockChildren(result.data,outer.id))if(b.afterId===owner.id)move(b,{parentId:b.parentId,slot:b.slot,afterId:item.id});move(item,{parentId:outer.id,slot:'body',afterId:owner.id});if(siblings.length===1){write('membership',list.id,false);result.data.blocks=result.data.blocks.filter(b=>b.id!==list.id);}
  }
 }else if(action.type==='rich-image-insert'){
  const place=action.capture.destination;
  if(!source.images||!place||place.parentId!==null||place.slot!=='body'||selected.length||
     typeof action.id!=='string'||!action.id||Object.keys(action).length!==5||
     place.afterId!==null&&!result.data.blocks.some(b=>b.id===place.afterId&&b.parentId===null&&b.slot==='body'))return fail();
  validateRichImageAsset(action.asset,source.rasterFormats);
  const block:RichBlock={id:action.id,type:'image',attrs:{asset:convergenceClone(action.asset),displaySize:'medium',...(source.alignment?{alignment:'left'}:{})},...convergenceClone(place)};
  for(const b of result.data.blocks)if(b.parentId===null&&b.slot==='body'&&b.afterId===place.afterId)move(b,{parentId:null,slot:'body',afterId:block.id});
  put(block);
 }else if(action.type==='rich-block-insert'){
  const place=action.capture.destination;if(!place||selected.length||!['paragraph','heading'].includes(action.block.type)||typeof action.text!=='string')return fail();
  const href=action.link&&typeof action.link.href==='string'?normalizeEditorLinkHref(action.link.href):undefined;if(action.link!==undefined&&(!source.links||!href||Object.keys(action.link).length!==1))return fail();
  const marks=[...(action.marks??[]).map(type=>({type})),...(href?[{type:'link' as const,attrs:{href}}]:[])];
  const block:RichBlock={...convergenceClone(action.block),...convergenceClone(place),content:action.text?[{type:'text',text:action.text,...(marks.length?{marks}:{})}]:[]};
  // Reanchor following siblings in the same intent; text identities are untouched.
  for(const b of result.data.blocks)if(b.parentId===place.parentId&&b.slot===place.slot&&b.afterId===place.afterId)move(b,{parentId:b.parentId,slot:b.slot,afterId:block.id});
  put(block);result.textActions.push({type:'rich-insert-paragraph',field:source.field,id:block.id,afterId:intrinsicLastLeaf,text:action.text,...(action.marks?{marks:action.marks}:{}),...(href?{link:{href}}:{})});
 }else if(action.type==='rich-block-transform'){
  if(!selected.length)return fail();for(const b of selected){const sameLeaf=richBlockLeaf(b.type)&&richBlockLeaf(action.kind),sameList=['bullet-list','ordered-list'].includes(b.type)&&['bullet-list','ordered-list'].includes(action.kind);if(!sameLeaf&&!sameList)return fail();b.type=action.kind;b.attrs=convergenceClone(action.attrs);write('kind',b.id,b.type);write('attrs',b.id,b.attrs);}
 }else if(action.type==='rich-block-hide'){
  if(!selected.length)return fail();const hidden=new Set(selected.map(b=>b.id));let changed=true;while(changed){changed=false;for(const b of result.data.blocks)if(b.parentId!==null&&hidden.has(b.parentId)&&!hidden.has(b.id)){hidden.add(b.id);changed=true;}}
  for(const b of selected)write('membership',b.id,false);result.data.blocks=result.data.blocks.filter(b=>!hidden.has(b.id));
 }else if(action.type==='rich-block-container'){
  if(!selected.length||selected.some(b=>!richBlockLeaf(b.type)))return fail();const first=selected[0],siblings=richBlockChildren(result.data,first.parentId,first.slot),start=siblings.findIndex(b=>b.id===first.id);
  if(selected.some((b,i)=>siblings[start+i]?.id!==b.id))return fail();const original={parentId:first.parentId,slot:first.slot,afterId:first.afterId},wrapper={...convergenceClone(action.container),...original};put(wrapper);
  let previous:string|null=null;for(const [i,b]of selected.entries()){const summary=wrapper.type==='toggle'&&i===0;move(b,{parentId:wrapper.id,slot:summary?'summary':'body',afterId:summary?null:previous});if(!summary)previous=b.id;}
  for(const b of result.data.blocks)if(b.parentId===original.parentId&&b.slot===original.slot&&b.afterId===selected.at(-1)!.id)move(b,{parentId:b.parentId,slot:b.slot,afterId:wrapper.id});
 }else{
  if(selected.length!==1)return fail();const wrapper=selected[0];if(!['bullet-list','ordered-list','blockquote','toggle'].includes(wrapper.type))return fail();
  let children=wrapper.type==='toggle'?[...richBlockChildren(result.data,wrapper.id,'summary'),...richBlockChildren(result.data,wrapper.id)]:richBlockChildren(result.data,wrapper.id);
  const hidden=new Set([wrapper.id]);if(wrapper.type==='bullet-list'||wrapper.type==='ordered-list'){for(const item of children)hidden.add(item.id);children=children.flatMap(item=>richBlockChildren(result.data,item.id));}
  let previous=wrapper.afterId;for(const b of children){move(b,{parentId:wrapper.parentId,slot:wrapper.slot,afterId:previous});previous=b.id;}
  for(const b of result.data.blocks)if(b.parentId===wrapper.parentId&&b.slot===wrapper.slot&&b.afterId===wrapper.id)move(b,{parentId:b.parentId,slot:b.slot,afterId:previous});
  write('membership',wrapper.id,false);result.data.blocks=result.data.blocks.filter(b=>!hidden.has(b.id));
 }
 if(source.axes&&action.type==='rich-block-hide')result.data.axisOrder=result.data.axisOrder!.filter(o=>result.data.blocks.some(b=>b.id===o.tableId));
 result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);validateRichBlockDocument(result.data,source.links,source.tables,source.axes,source.widths,source.images,source.alignment,source.rasterFormats,source.imageCells);return result;
}
