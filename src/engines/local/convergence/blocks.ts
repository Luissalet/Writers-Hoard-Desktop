import type {LocalToolJson} from '../stateTypes';
import type {RichView} from './richRuns';
import type {LocalToolConvergenceIdentity} from './types';
import {Registers} from './registers';
import {assertConvergenceIdentity,convergenceCanonical,convergenceClone} from './format';
import {BLOCK_SCHEMA,validateRichBlockDocument,validateRichBlockPlacement,richBlockLeaf,type RichBlockKind,type RichBlockDocument,type RichBlock,type RichBlockBindings,type RichBlockBinding,type RichBlockPlacement,type RichBlockCapture,type RichBlockMoveCapture,type RichBlockCoreAction} from './blockTypes';
export * from './blockTypes';
type Write={name:'kind'|'attrs'|'membership'|'placement';id:string;value:LocalToolJson};
export interface RichBlockPlan {data:RichBlockDocument;bindings:RichBlockBindings;writes:Write[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('local_tool_blocks_invalid');};
const equal=(a:unknown,b:unknown)=>convergenceCanonical(a)===convergenceCanonical(b);
function reposition(data:RichBlockDocument,id:string,to:RichBlockPlacement){
 const block=data.blocks.find(b=>b.id===id)??fail(),old={parentId:block.parentId,slot:block.slot,afterId:block.afterId};
 if(equal(old,to))return;
 if(old.parentId===to.parentId&&old.slot===to.slot)for(const b of data.blocks)if(b.id!==id&&b.parentId===old.parentId&&b.slot===old.slot&&b.afterId===id)b.afterId=old.afterId;
 for(const b of data.blocks)if(b.id!==id&&b.parentId===to.parentId&&b.slot===to.slot&&b.afterId===to.afterId)b.afterId=id;
 Object.assign(block,to);
}
export class RichBlocks {
 readonly registers:Registers;readonly field:string;
 constructor(registers:Registers,field:string){this.registers=registers;this.field=field;}
 root(name:string){return 'blocks3:'+JSON.stringify(this.field)+':'+name;}
 private read(name:string,key:string){return this.registers.winner(this.root(name),key);}
 private binding(blockId:string):RichBlockBinding {
  const get=(name:string)=>{const version=this.read(name,blockId);if(!version?.present)return fail();return version.id;};
  return{id:blockId,kindVersionId:get('kind'),attrsVersionId:get('attrs'),membershipVersionId:get('membership'),placementVersionId:get('placement')};
 }
 project(rich:RichView):{data:RichBlockDocument;bindings:RichBlockBindings;rich:RichView} {
  const all=new Map<string,RichBlock>(),leaves=new Map(rich.data.content.map(p=>[p.id,p]));
  for(const key of new Set([...this.registers.entries(this.root('kind')),...this.registers.candidates(this.root('kind'))].map(v=>v.key))){
   if(this.read('membership',key)?.value!==true)continue;
   const type=this.read('kind',key)?.value as RichBlockKind,attrs=this.read('attrs',key)?.value as RichBlock['attrs'],place=this.read('placement',key)?.value as unknown as RichBlockPlacement;
   if(!type||!attrs||!place)throw Error('local_tool_blocks_dependency_missing');
   const leaf=leaves.get(key);if(richBlockLeaf(type)&&!leaf)throw Error('local_tool_blocks_dependency_missing');
   all.set(key,{id:key,type,attrs:convergenceClone(attrs),...convergenceClone(place),...(richBlockLeaf(type)?{content:convergenceClone(leaf!.content)}:{})});
  }
  // A known hidden ancestor omits a branch. Cycles remain finite raw catalogues.
  const visible=(b:RichBlock)=>{const seen=new Set([b.id]);let parent=b.parentId;while(parent!==null){if(seen.has(parent))return true;seen.add(parent);const ancestor=all.get(parent);if(!ancestor)return false;parent=ancestor.parentId;}return true;};
  const blocks=[...all.values()].filter(visible).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),ids=new Set(blocks.filter(b=>richBlockLeaf(b.type)).map(b=>b.id));
  const filtered={data:{type:'doc' as const,content:rich.data.content.filter(p=>ids.has(p.id))},bindings:{nodes:rich.bindings.nodes.filter(p=>ids.has(p.id))}};
  // Text and its bindings follow catalogue IDs, independently of intrinsic paragraph order.
  filtered.data.content=blocks.filter(b=>richBlockLeaf(b.type)).map(b=>filtered.data.content.find(p=>p.id===b.id)!);
  filtered.bindings.nodes=filtered.data.content.map(p=>filtered.bindings.nodes.find(n=>n.id===p.id)!);
  return{data:{type:'block-doc',schema:BLOCK_SCHEMA,blocks},bindings:{format:'writers-hoard-block-bindings/1',nodes:blocks.map(b=>this.binding(b.id))},rich:filtered};
 }
 check(data:RichBlockDocument,bindings:RichBlockBindings):void {
  validateRichBlockDocument(data);
  if(!object(bindings)||Object.keys(bindings).length!==2||bindings.format!=='writers-hoard-block-bindings/1'||!Array.isArray(bindings.nodes)||bindings.nodes.length!==data.blocks.length)return fail();
  for(let at=0;at<data.blocks.length;at++){
   const b=data.blocks[at],bound=bindings.nodes[at];if(!object(bound)||Object.keys(bound).length!==5||bound.id!==b.id)return fail();
   const expected={kind:b.type,attrs:b.attrs,membership:true,placement:{parentId:b.parentId,slot:b.slot,afterId:b.afterId}};
   for(const name of ['kind','attrs','membership','placement'] as const){
    const version=this.registers.versions.get(bound[`${name}VersionId`])??this.registers.candidates(this.root(name)).find(v=>v.id===bound[`${name}VersionId`]);
    if(!version||!version.present||version.root!==this.root(name)||version.key!==b.id||!this.registers.transactionAvailable(version.txId)||!equal(version.value,expected[name]))return fail();
   }
  }
 }
 seed(data:RichBlockDocument){
  validateRichBlockDocument(data);
  for(const b of data.blocks)for(const [name,value]of Object.entries({kind:b.type,attrs:b.attrs,membership:true,placement:{parentId:b.parentId,slot:b.slot,afterId:b.afterId}}))this.registers.write(this.root(name),b.id,true,value as LocalToolJson);
 }
 capture(identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeIds:string[]):RichBlockCapture {
  this.check(data,bindings);if(!Array.isArray(nodeIds)||!nodeIds.length||new Set(nodeIds).size!==nodeIds.length)return fail();
  const chosen=nodeIds.map(key=>data.blocks.find(b=>b.id===key)??fail()),first=chosen[0];
  if(chosen.some((b,i)=>b.parentId!==first.parentId||b.slot!==first.slot||i>0&&b.afterId!==chosen[i-1].id))return fail();
  return{format:'writers-hoard-block-capture/1',identity:convergenceClone(identity),field:this.field,nodeIds:convergenceClone(nodeIds),bindings:chosen.map(b=>convergenceClone(bindings.nodes.find(n=>n.id===b.id)!)),frontier:this.registers.frontier()};
 }
 moveCapture(identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeId:string,destination:RichBlockPlacement):RichBlockMoveCapture {
  this.check(data,bindings);validateRichBlockPlacement(destination);const source=data.blocks.find(b=>b.id===nodeId);if(!source)return fail();
  if(destination.afterId!==null&&!data.blocks.some(b=>b.id===destination.afterId&&b.parentId===destination.parentId&&b.slot===destination.slot))return fail();
  const proposed=convergenceClone(data);reposition(proposed,nodeId,destination);validateRichBlockDocument(proposed);
  const ids=new Set([nodeId,...(destination.parentId?[destination.parentId]:[]),...(destination.afterId?[destination.afterId]:[])]);
  return{format:'writers-hoard-block-move/1',identity:convergenceClone(identity),field:this.field,nodeId,destination:convergenceClone(destination),bindings:bindings.nodes.filter(b=>ids.has(b.id)).map(b=>convergenceClone(b)),frontier:this.registers.frontier()};
 }
 prepare(data:RichBlockDocument,bindings:RichBlockBindings,action:RichBlockCoreAction,identity:LocalToolConvergenceIdentity):RichBlockPlan {
  assertConvergenceIdentity(action.capture.identity,identity);if(action.field!==this.field||action.capture.field!==this.field)return fail();
  const result:RichBlockPlan={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[]};
  const write=(name:Write['name'],key:string,value:unknown)=>result.writes.push({name,id:key,value:convergenceClone(value) as LocalToolJson});
  const put=(block:RichBlock)=>{if(this.registers.entries(this.root('kind'),block.id).length||result.data.blocks.some(b=>b.id===block.id))return fail();result.data.blocks.push(block);for(const[name,value]of Object.entries({kind:block.type,attrs:block.attrs,membership:true,placement:{parentId:block.parentId,slot:block.slot,afterId:block.afterId}}))write(name as Write['name'],block.id,value);};
  const move=(key:string,to:RichBlockPlacement)=>{const block=result.data.blocks.find(b=>b.id===key);if(!block)return fail();Object.assign(block,to);write('placement',key,to);};
  if(action.type==='rich-block-move'){
   const before=new Map(result.data.blocks.map(b=>[b.id,{parentId:b.parentId,slot:b.slot,afterId:b.afterId}]));reposition(result.data,action.capture.nodeId,action.capture.destination);
   for(const b of result.data.blocks){const place={parentId:b.parentId,slot:b.slot,afterId:b.afterId};if(!equal(before.get(b.id),place))write('placement',b.id,place);}
  }
  else{
   const {nodeIds}=action.capture,first=result.data.blocks.find(b=>b.id===nodeIds[0]);if(!first||!object(action.wrapper)||!['bullet-list','ordered-list'].includes(action.wrapper.type)||action.items.length!==nodeIds.length)return fail();
   const capturedPlace=this.registers.versions.get(action.capture.bindings[0].placementVersionId);if(!capturedPlace)return fail();
   const original=convergenceClone(capturedPlace.value) as unknown as RichBlockPlacement;put({...action.wrapper,...original});let previous:string|null=null;
   for(let i=0;i<nodeIds.length;i++){const item=action.items[i];if(item.leafId!==nodeIds[i]||!richBlockLeaf(result.data.blocks.find(b=>b.id===item.leafId)?.type as RichBlockKind))return fail();put({id:item.id,type:'list-item',attrs:{},parentId:action.wrapper.id,slot:'body',afterId:previous});move(item.leafId,{parentId:item.id,slot:'body',afterId:null});previous=item.id;}
   // Preserve the following siblings' relation to the replaced contiguous range.
   for(const block of result.data.blocks)if(block.parentId===original.parentId&&block.slot===original.slot&&block.afterId===nodeIds.at(-1)&&!nodeIds.includes(block.id))move(block.id,{parentId:block.parentId,slot:block.slot,afterId:action.wrapper.id});
  }
  result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);validateRichBlockDocument(result.data);return result;
 }
 commit(plan:RichBlockPlan){
  for(const w of plan.writes)this.registers.write(this.root(w.name),w.id,true,w.value);
  const changed=new Set(plan.writes.map(w=>w.id));
  plan.bindings.nodes=plan.data.blocks.map(block=>{const old=plan.bindings.nodes.find(n=>n.id===block.id);if(!old||changed.has(block.id)){
   const bound=old?convergenceClone(old):this.binding(block.id);for(const w of plan.writes.filter(w=>w.id===block.id))bound[`${w.name}VersionId`]=this.read(w.name,block.id)!.id;return bound;
  }return old;});
 }
 pending(){
  let missing=false;const known=new Set(this.registers.entries(this.root('kind')).map(v=>v.key));
  for(const key of known)for(const name of ['attrs','membership','placement'])if(!this.registers.entries(this.root(name),key).length)missing=true;
  for(const name of ['kind','attrs','membership','placement'])for(const v of this.registers.entries(this.root(name))){
   if(!v.present)return fail();if(!this.registers.transactionAvailable(v.txId))missing=true;
   if(name==='kind'&&!['paragraph','heading','bullet-list','ordered-list','list-item','blockquote','toggle'].includes(v.value as string))return fail();
   if(name==='attrs'&&!object(v.value))return fail();if(name==='membership'&&typeof v.value!=='boolean')return fail();
   if(name==='placement'){validateRichBlockPlacement(v.value);if([v.value.parentId,v.value.afterId].some(ref=>ref!==null&&!known.has(ref)))missing=true;}
  }
  return missing;
 }
}
