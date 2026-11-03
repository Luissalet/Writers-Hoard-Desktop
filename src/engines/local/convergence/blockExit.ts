import type {LocalToolJson} from '../stateTypes';
import {captureBlockEdit,richBlockChildren} from './blockEditing';
import type {RichBlockEditCapture} from './blockEditingTypes';
import {richBlockLeaves,validateRichBlockDocument,type RichBlock,type RichBlockDocument,type RichBlockBindings,type RichBlockPlacement} from './blockTypes';
import type {RichBlocks,RichBlockPlan} from './blocks';
import type {RichRuns,RichBindings} from './richRuns';
import type {RichRange} from './richTypes';
import type {LocalToolConvergenceIdentity} from './types';
import {convergenceCanonical,convergenceClone} from './format';

export interface RichBlockEmptyItemFrame {
 leafId:string;itemId:string;listId:string;parentId:string|null;itemIds:string[];listFollowers:string[];
 ownerId:string|null;outerListId:string|null;ownerSuffix:string[];outerFollowers:string[];
}
export interface RichBlockEmptyItemCapture extends RichBlockEditCapture {frame:RichBlockEmptyItemFrame;empty:RichRange}
export interface RichBlockExitAction {type:'rich-block-exit-empty-item';field:string;capture:RichBlockEmptyItemCapture;continuationListId?:string}
const fail=():never=>{throw Error('local_tool_block_empty_item_invalid');};
const listKind=(kind:string)=>kind==='bullet-list'||kind==='ordered-list';
const followers=(data:RichBlockDocument,b:RichBlock)=>richBlockChildren(data,b.parentId,b.slot).filter(n=>n.afterId===b.id).map(n=>n.id);
/** The intent enumerates its frame; unrelated global bindings grant no authority. */
function frame(data:RichBlockDocument,nodeId:string):RichBlockEmptyItemFrame {
 const leaf=data.blocks.find(b=>b.id===nodeId),item=data.blocks.find(b=>b.id===leaf?.parentId),list=data.blocks.find(b=>b.id===item?.parentId);
 if(leaf?.type!=='paragraph'||leaf.content?.length!==0||item?.type!=='list-item'||!list||!listKind(list.type)||leaf.slot!=='body'||item.slot!=='body'||richBlockChildren(data,item.id).length!==1)return fail();
 const parent=data.blocks.find(b=>b.id===list.parentId),owner=parent?.type==='list-item'?parent:undefined,outer=owner?data.blocks.find(b=>b.id===owner.parentId):undefined;
 if(owner&&(!outer||!listKind(outer.type)||owner.slot!=='body'||list.slot!=='body'))return fail();
 const body=owner?richBlockChildren(data,owner.id):[],at=body.findIndex(b=>b.id===list.id);
 return{leafId:nodeId,itemId:item.id,listId:list.id,parentId:list.parentId,itemIds:richBlockChildren(data,list.id).map(b=>b.id),listFollowers:followers(data,list),ownerId:owner?.id??null,outerListId:outer?.id??null,ownerSuffix:owner?body.slice(at+1).map(b=>b.id):[],outerFollowers:owner?followers(data,owner):[]};
}
export function captureBlockEmptyItem(source:RichBlocks,rich:RichRuns,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,textBindings:RichBindings,nodeId:string):RichBlockEmptyItemCapture {
 const capture=captureBlockEdit(source,identity,data,bindings,[nodeId]),intent=frame(data,nodeId),ids=new Set([intent.leafId,intent.itemId,intent.listId,...intent.itemIds,...intent.listFollowers,...intent.ownerSuffix,...intent.outerFollowers,...[intent.parentId,intent.ownerId,intent.outerListId].filter((id):id is string=>id!==null)]);
 return{...capture,bindings:capture.bindings.filter(b=>ids.has(b.id)),frame:intent,empty:rich.range(identity,nodeId,0,0,'right',{data:richBlockLeaves(data,source.links,source.tables),bindings:textBindings})};
}
/** One atomic structural plan. No text action, temporary item or buffer replacement. */
export function prepareBlockExit(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,textBindings:RichBindings,action:RichBlockExitAction):RichBlockPlan {
 const capture=action.capture,intent=capture.frame,current=frame(data,intent.leafId);
 if(convergenceCanonical(current)!==convergenceCanonical(intent)||textBindings.nodes.find(n=>n.id===intent.leafId)?.units.length!==0||action.continuationListId!==undefined&&(typeof action.continuationListId!=='string'||!action.continuationListId))return fail();
 // Retained kind/placement witnesses belong to the capture, never a new parent.
 for(const b of capture.bindings){const node=data.blocks.find(n=>n.id===b.id),kind=source.registers.versions.get(b.kindVersionId),place=source.registers.versions.get(b.placementVersionId);if(!node||!kind?.present||!place?.present)return fail();const old=place.value as unknown as RichBlockPlacement;if(node.type!==kind.value||node.parentId!==old.parentId||node.slot!==old.slot)return fail();}
 const result:RichBlockPlan={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[]},get=(id:string)=>result.data.blocks.find(b=>b.id===id)??fail();
 const write=(name:RichBlockPlan['writes'][number]['name'],id:string,value:unknown)=>result.writes.push({name,id,value:convergenceClone(value) as LocalToolJson});
 const move=(id:string,to:RichBlockPlacement)=>{const b=get(id),before={parentId:b.parentId,slot:b.slot,afterId:b.afterId};if(convergenceCanonical(before)===convergenceCanonical(to))return;Object.assign(b,to);write('placement',id,to);};
 const hide=(id:string)=>{write('membership',id,false);result.data.blocks=result.data.blocks.filter(b=>b.id!==id);};
 const item=get(intent.itemId),list=get(intent.listId),leaf=get(intent.leafId),at=intent.itemIds.indexOf(item.id),prefix=intent.itemIds.slice(0,at),suffix=intent.itemIds.slice(at+1),place={parentId:list.parentId,slot:list.slot,afterId:list.afterId};
 if(at<0)return fail();
 const tailAttrs=()=>{const attrs=convergenceClone(list.attrs);if(list.type==='ordered-list'){const start=Number(attrs.start??1)+at+1;if(!Number.isSafeInteger(start))return fail();attrs.start=start;}return attrs;};
 const tail=(parentId:string|null,slot:'body'|'summary',afterId:string|null,reuse:boolean)=>{
  let id:string;if(reuse){id=list.id;move(id,{parentId,slot,afterId});const attrs=tailAttrs();if(convergenceCanonical(attrs)!==convergenceCanonical(list.attrs)){list.attrs=attrs;write('attrs',id,attrs);}}
  else{id=action.continuationListId??fail();if(source.registers.entries(source.root('kind'),id).length||result.data.blocks.some(b=>b.id===id))return fail();const attrs=tailAttrs();result.data.blocks.push({id,type:list.type,attrs,parentId,slot,afterId});for(const[name,value]of Object.entries({kind:list.type,attrs,membership:true,placement:{parentId,slot,afterId}}))write(name as RichBlockPlan['writes'][number]['name'],id,value);}
  let previous:string|null=null;for(const child of suffix){move(child,{parentId:id,slot:'body',afterId:previous});previous=child;}return id;
 };
 if(intent.ownerId===null){
  let last:string;
  if(prefix.length){move(leaf.id,{parentId:place.parentId,slot:place.slot,afterId:list.id});last=suffix.length?tail(place.parentId,place.slot,leaf.id,false):leaf.id;}
  else{move(leaf.id,place);last=suffix.length?tail(place.parentId,place.slot,leaf.id,true):leaf.id;}
  if(!suffix.length||prefix.length)for(const id of intent.listFollowers)move(id,{parentId:place.parentId,slot:place.slot,afterId:last});
  hide(item.id);if(!prefix.length&&!suffix.length)hide(list.id);
 }else{
  const owner=get(intent.ownerId),outer=get(intent.outerListId??fail());move(item.id,{parentId:outer.id,slot:'body',afterId:owner.id});for(const id of intent.outerFollowers)move(id,{parentId:outer.id,slot:'body',afterId:item.id});
  let last=leaf.id;if(suffix.length)last=tail(item.id,'body',leaf.id,!prefix.length);else if(!prefix.length)hide(list.id);
  for(const id of intent.ownerSuffix){move(id,{parentId:item.id,slot:'body',afterId:last});last=id;}
 }
 result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);validateRichBlockDocument(result.data,source.links,source.tables);return result;
}
