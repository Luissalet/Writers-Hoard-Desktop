import {TABLE_AXES_SCHEMA,TABLE_WIDTHS_SCHEMA,validTableRowHeight,TABLE_CELL_STYLE_PREFIX} from './tableAxesFormat';
import {TableAxisOrder,type TableAxisInsertion} from './tableAxisOrder';
import {TABLE_SCHEMA,TABLE_KINDS,tableCellOf} from './tableFormat';
import {validateRichBlockAttributes} from './blockFormat';
import {ALIGNMENT_BLOCK_SCHEMA,CELL_IMAGE_BLOCK_SCHEMA,IMAGE_BLOCK_SCHEMA,RASTER_BLOCK_SCHEMA,TABLE_ROW_HEIGHTS_SCHEMA,TABLE_CELL_HEADERS_SCHEMA,isRichImageAlignment,isRichImageSize,validateRichImageAsset} from './imageFormat';
import type {LocalToolJson} from '../stateTypes';
import type {RichView} from './richRuns';
import type {RichParagraph} from './richTypes';
import type {LocalToolConvergenceIdentity} from './types';
import {Registers,type RegisterVersion} from './registers';
import {assertConvergenceIdentity,convergenceCanonical,convergenceClone} from './format';
import {BLOCK_SCHEMA,validateRichBlockDocument,validateRichBlockPlacement,richBlockLeaf,type RichBlockKind,type RichBlockDocument,type RichBlock,type RichBlockBindings,type RichBlockBinding,type RichBlockPlacement,type RichBlockCapture,type RichBlockMoveCapture,type RichBlockCoreAction} from './blockTypes';
export * from './blockTypes';
const structureNames=['kind','attrs','membership','placement'] as const;
const imageNames=['imageSource','imageSize'] as const;
const alignedImageNames=[...imageNames,'imageAlignment'] as const;
type StructureName=typeof structureNames[number];
type Write={name:StructureName|typeof alignedImageNames[number]|'rowHeight';id:string;value:LocalToolJson};
export type StructuralNode={block:RichBlock;binding:RichBlockBinding;retirement?:string;imageSupportFrontier?:string[]};
export interface RichBlockPlan {data:RichBlockDocument;bindings:RichBlockBindings;writes:Write[];axisInserts?:TableAxisInsertion[];pasteParagraphs?:RichParagraph[]}
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
 readonly registers:Registers;readonly field:string;readonly links:boolean;readonly tables:boolean;readonly axes:boolean;readonly widths:boolean;readonly images:boolean;readonly alignment:boolean;readonly rasterFormats:boolean;readonly imageCells:boolean;readonly rowHeights:boolean;readonly cellHeaders:boolean;
 constructor(registers:Registers,field:string,links=false,tables=false,axes=false,widths=false,images=false,alignment=false,rasterFormats=false,imageCells=false,rowHeights=false,cellHeaders=false){this.registers=registers;this.field=field;this.links=links;this.tables=tables;this.axes=axes;this.widths=widths;this.images=images;this.alignment=alignment;this.rasterFormats=rasterFormats;this.imageCells=imageCells;this.rowHeights=rowHeights;this.cellHeaders=cellHeaders;}
 private get imageRegisters(){return this.alignment?alignedImageNames:imageNames;}
 root(name:string){return 'blocks3:'+JSON.stringify(this.field)+':'+(name==='imageSource'?'image-source':name==='imageSize'?'image-size':name==='imageAlignment'?'image-alignment':name==='rowHeight'?'row-height':name);}
 private read(name:string,key:string){return this.registers.winner(this.root(name),key);}
 private binding(blockId:string):RichBlockBinding {
  const get=(name:string)=>{const version=this.read(name,blockId);if(!version?.present)return fail();return version.id;};
  return{id:blockId,kindVersionId:get('kind'),attrsVersionId:get('attrs'),membershipVersionId:get('membership'),placementVersionId:get('placement'),
   ...(this.images&&this.read('kind',blockId)?.value==='image'?{imageSourceVersionId:get('imageSource'),imageSizeVersionId:get('imageSize'),...(this.alignment?{imageAlignmentVersionId:get('imageAlignment')}:{})}:{})};
 }
 /** Derived support never changes activations or the complete inverse of a receipt. */
 private structure(history=new Map<string,Map<string,StructuralNode>>()):Map<string,StructuralNode> {
  const r=this.registers,all=new Map<string,StructuralNode>(),invalid=new Set<string>(),summaryWitness=new Map<string,string>();
  const historical=(frontier:string[])=>{
   const key=JSON.stringify([...frontier].sort()),cached=history.get(key);if(cached)return cached;
   const value=r.atFrontier(frontier,view=>new RichBlocks(view,this.field,this.tables?this.links:false,this.tables,this.axes,this.widths,this.images,this.alignment,this.rasterFormats,this.imageCells,this.rowHeights,this.cellHeaders).structure(history));history.set(key,value);return value;
  };
  const version=(binding:RichBlockBinding,name:StructureName)=>r.versions.get(binding[`${name}VersionId`])??r.candidates(this.root(name)).find(v=>v.id===binding[`${name}VersionId`]);
  const assemble=(id:string,values:Record<StructureName,RegisterVersion>):StructuralNode=>({
   block:{id,type:values.kind.value as RichBlockKind,attrs:convergenceClone(values.attrs.value) as RichBlock['attrs'],...convergenceClone(values.placement.value) as unknown as RichBlockPlacement},
   binding:{id,kindVersionId:values.kind.id,attrsVersionId:values.attrs.id,membershipVersionId:values.membership.id,placementVersionId:values.placement.id},
  });
  const attachImage=(node:StructuralNode,source:RegisterVersion,size:RegisterVersion,alignment:RegisterVersion|undefined):StructuralNode=>{
   node.block.attrs={asset:convergenceClone(source.value),displaySize:size.value};
   node.binding.imageSourceVersionId=source.id;node.binding.imageSizeVersionId=size.id;
   if(alignment){node.block.attrs.alignment=alignment.value;node.binding.imageAlignmentVersionId=alignment.id;}
   return node;
  };
  const supportedImage=(id:string):StructuralNode|undefined=>{
   const source=this.read('imageSource',id),size=this.read('imageSize',id),alignment=this.alignment?this.read('imageAlignment',id):undefined;
   for(const edit of [source,size,alignment]){
    if(!edit?.present)continue;
    const parents=r.transactions.get(edit.txId)?.parents;
    const observed=parents?.length?historical(parents).get(id):undefined;
    if(observed?.block.type!=='image')continue;
    const birth=version(observed.binding,'membership'),retired=birth&&r.activation(birth.id);
    if(!birth||birth.value!==true||edit.txId===birth.txId||!retired||retired.enabled)continue;
    const fromBirth=(name:Write['name'])=>r.entries(this.root(name),id).find(candidate=>{
     if(candidate.txId!==birth.txId||!candidate.present)return false;
     const off=r.activation(candidate.id);
     return off?.enabled===false&&off.txId===retired.txId;
    });
    const kind=fromBirth('kind'),attrs=fromBirth('attrs'),placement=this.read('placement',id)??fromBirth('placement');
    const imageSource=source??fromBirth('imageSource'),imageSize=size??fromBirth('imageSize');
    const imageAlignment=this.alignment?(alignment??fromBirth('imageAlignment')):undefined;
    if(kind?.value!=='image'||!attrs||!placement?.present||!imageSource?.present||!imageSize?.present||this.alignment&&!imageAlignment?.present)continue;
    const node=attachImage(assemble(id,{kind,attrs,membership:birth,placement}),imageSource,imageSize,imageAlignment);
    node.retirement=retired.txId;
    if(this.imageCells&&node.block.parentId!==null)node.imageSupportFrontier=parents;
    return node;
   }
  };
  for(const key of new Set([...r.entries(this.root('kind')),...r.candidates(this.root('kind'))].map(v=>v.key))){
   const membership=this.read('membership',key);
   if(membership?.value!==true){
    if(this.images&&!membership){const supported=supportedImage(key);if(supported)all.set(key,supported);}
    continue;
   }
   const values={kind:this.read('kind',key),attrs:this.read('attrs',key),membership,placement:this.read('placement',key)};
   if(Object.values(values).some(value=>!value?.present))throw Error('local_tool_blocks_dependency_missing');
   const node=assemble(key,values as Record<StructureName,RegisterVersion>);
   if(node.block.type==='image'){
    const source=this.read('imageSource',key),size=this.read('imageSize',key),alignment=this.alignment?this.read('imageAlignment',key):undefined;
    if(!source?.present||!size?.present||this.alignment&&!alignment?.present)throw Error('local_tool_blocks_dependency_missing');
    attachImage(node,source,size,alignment);
   }
   all.set(key,node);
  }
  const visiting=new Set<string>();
  const requireParent=(child:StructuralNode,inherited?:Map<string,StructuralNode>):void=>{
   const id=child.block.parentId;if(id===null||invalid.has(id))return;
   const current=all.get(id);if(current&&!current.retirement)return;
   // An explicit hide remains an explicit hide. Only a withdrawn true membership
   // can supply support, never any arbitrary retained version of the ancestor.
   if(this.read('membership',id))return;
   const place=version(child.binding,'placement'),parents=place&&r.transactions.get(place.txId)?.parents;
   // A list and its items may be born in one transaction. Their chain was
   // witnessed together by the descendant, not in that constructor's parents.
   const basis=inherited?.get(child.block.id)?.binding.placementVersionId===child.binding.placementVersionId?inherited:parents?.length?historical(parents):undefined;
   const witness=basis?.get(id);if(!basis||!witness||richBlockLeaf(witness.block.type))return;
   const membership=version(witness.binding,'membership'),retired=membership&&r.activation(membership.id);
   if(!membership||membership.value!==true||!retired||retired.enabled||!r.complete(retired.txId))return;
   const prior=r.transactions.get(retired.txId)?.parents;if(!prior?.length)return;
   const values=r.atFrontier(prior,view=>{
    if(view.winner(this.root('membership'),id)?.id!==membership.id)return undefined;
    const picked={} as Record<StructureName,RegisterVersion>;
    for(const name of ['kind','attrs','membership','placement'] as const){
     const active=r.winner(this.root(name),id),old=view.winner(this.root(name),id,value=>{
      const activation=r.activation(value.id);return activation?.enabled===true||activation?.enabled===false&&activation.txId===retired.txId;
     }),off=old&&r.activation(old.id);
     // Values independently undone after B's witness are not resurrected. The
     // fallback must belong to the SAME withdrawal as the required membership.
     const value=active??(old&&off?.enabled===false&&off.txId===retired.txId?old:undefined);
     if(!value?.present)return undefined;picked[name]=value;
    }
    return picked;
   });
   if(!values)return;
   const support=assemble(id,values);support.retirement=retired.txId;
   if(current&&!equal(current,support)){invalid.add(id);all.delete(id);return;}
   all.set(id,support);
   if(visiting.has(id)){invalid.add(id);all.delete(id);return;}visiting.add(id);
   requireParent(support,basis);visiting.delete(id);
   if(support.block.type==='toggle'){
    const summaries=[...basis.values()].filter(v=>v.block.parentId===id&&v.block.slot==='summary');
    if(summaries.length!==1){invalid.add(id);all.delete(id);return;}
    const summary=summaries[0],seen=summaryWitness.get(id);if(seen&&seen!==summary.block.id){invalid.add(id);all.delete(id);return;}summaryWitness.set(id,summary.block.id);
    const represented=[...all.values()].filter(v=>v.block.parentId===id&&v.block.slot==='summary');
    if(represented.length===1&&represented[0].block.id===summary.block.id)return;
    const leaf=all.get(summary.block.id),oldPlace=version(summary.binding,'placement'),now=leaf&&version(leaf.binding,'placement'),off=oldPlace&&r.activation(oldPlace.id);
    const beforeWithdrawal=oldPlace&&r.atFrontier(prior,view=>view.winner(this.root('placement'),summary.block.id)?.id===oldPlace.id);
    if(represented.length||!leaf||!richBlockLeaf(leaf.block.type)||!oldPlace||!now||off?.enabled!==false||off.txId!==retired.txId||!beforeWithdrawal||!r.ancestors(oldPlace.txId).has(now.txId)){
     invalid.add(id);all.delete(id);return;
    }
    // Required-slot support may retain an observed placement that Undo reverted
    // to its ancestor. A later/concurrent placement, even byte-equal, wins.
    all.set(leaf.block.id,{block:{...leaf.block,...convergenceClone(oldPlace.value) as unknown as RichBlockPlacement},binding:{...leaf.binding,placementVersionId:oldPlace.id}});
   }
  };
  for(const child of [...all.values()])requireParent(child,child.imageSupportFrontier?historical(child.imageSupportFrontier):undefined);
  for(const id of invalid)all.delete(id);
  return all;
 }
 retainedStructure(){return this.structure();}
 project(rich:RichView,supported?:Map<string,StructuralNode>):{data:RichBlockDocument;bindings:RichBlockBindings;rich:RichView} {
  const structure=this.structure();for(const[id,node]of supported??[])if(!structure.has(id))structure.set(id,node);const all=new Map<string,RichBlock>(),leaves=new Map(rich.data.content.map(p=>[p.id,p]));
  for(const [key,node] of structure){
   const {block,binding}=node;
   if(this.rowHeights&&block.type==='table-row'){
    const height=this.read('rowHeight',key);
    if(height?.present){
     node.binding={...binding,rowHeightVersionId:height.id};
     if(height.value!==null)node.block={...block,attrs:{...block.attrs,heightPx:height.value}};
    }
   }
  }
  for(const[key,{block}]of structure){const leaf=leaves.get(key);if(richBlockLeaf(block.type)&&!leaf)throw Error('local_tool_blocks_dependency_missing');all.set(key,{...block,...(richBlockLeaf(block.type)?{content:convergenceClone(leaf!.content)}:{})});}
  // A known hidden ancestor omits a branch. Cycles remain finite raw catalogues.
  const cellVisible=(b:RichBlock)=>{const row=b.parentId===null?undefined:all.get(b.parentId),columnId=String(b.attrs.columnId),column=all.get(columnId);if(b.type==='table-cell-style'&&(!row||!column)||!column&&this.read('membership',columnId)?.value===false)return false;if(!column||!row)throw Error('local_tool_table_axes_dependency_missing');if(row.type!=='table-row'||column.type!=='table-column'||column.parentId!==row.parentId)fail();return true;};
  const visible=(b:RichBlock)=>{const seen=new Set([b.id]);let parent=b.parentId,cell=this.axes&&(b.type==='table-cell'||b.type==='table-cell-style')?b:undefined;while(parent!==null){if(seen.has(parent))return true;seen.add(parent);const ancestor=all.get(parent);if(!ancestor){if(this.read('membership',parent)?.value===false)return false;break;}if(this.axes&&ancestor.type==='table-cell')cell=ancestor;parent=ancestor.parentId;}return !cell||cellVisible(cell);};
  const blocks=[...all.values()].filter(visible).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),ids=new Set(blocks.filter(b=>richBlockLeaf(b.type)).map(b=>b.id));
  const filtered={data:{type:'doc' as const,content:rich.data.content.filter(p=>ids.has(p.id))},bindings:{nodes:rich.bindings.nodes.filter(p=>ids.has(p.id))}};
  // Text and its bindings follow catalogue IDs, independently of intrinsic paragraph order.
  filtered.data.content=blocks.filter(b=>richBlockLeaf(b.type)).map(b=>filtered.data.content.find(p=>p.id===b.id)!);
  filtered.bindings.nodes=filtered.data.content.map(p=>filtered.bindings.nodes.find(n=>n.id===p.id)!);
  return{data:{type:'block-doc',schema:this.cellHeaders?TABLE_CELL_HEADERS_SCHEMA:this.rowHeights?TABLE_ROW_HEIGHTS_SCHEMA:this.imageCells?CELL_IMAGE_BLOCK_SCHEMA:this.rasterFormats?RASTER_BLOCK_SCHEMA:this.alignment?ALIGNMENT_BLOCK_SCHEMA:this.images?IMAGE_BLOCK_SCHEMA:this.widths?TABLE_WIDTHS_SCHEMA:this.axes?TABLE_AXES_SCHEMA:this.tables?TABLE_SCHEMA:BLOCK_SCHEMA,blocks,...(this.axes?{axisOrder:new TableAxisOrder(this).project({blocks})}: {})},bindings:{format:'writers-hoard-block-bindings/1',nodes:blocks.map(b=>structure.get(b.id)!.binding)},rich:filtered};
 }
 check(data:RichBlockDocument,bindings:RichBlockBindings):void {
  validateRichBlockDocument(data,this.links,this.tables,this.axes,this.widths,this.images,this.alignment,this.rasterFormats,this.imageCells,this.rowHeights,this.cellHeaders);
  if(!object(bindings)||Object.keys(bindings).length!==2||bindings.format!=='writers-hoard-block-bindings/1'||!Array.isArray(bindings.nodes)||bindings.nodes.length!==data.blocks.length)return fail();
  for(let at=0;at<data.blocks.length;at++){
   const b=data.blocks[at],bound=bindings.nodes[at],image=b.type==='image',row=this.rowHeights&&b.type==='table-row';
   if(!object(bound)||bound.id!==b.id)return fail();
   const height=row&&Object.hasOwn(bound,'rowHeightVersionId');
   if(Object.keys(bound).length!==(image?(this.alignment?8:7):height?6:5)||row&&b.attrs.heightPx!==undefined&&!height)return fail();
   const expected={kind:b.type,attrs:image?{}:row?{header:b.attrs.header}:b.attrs,membership:true,placement:{parentId:b.parentId,slot:b.slot,afterId:b.afterId},imageSource:b.attrs.asset,imageSize:b.attrs.displaySize,imageAlignment:b.attrs.alignment,rowHeight:b.attrs.heightPx??null};
   for(const name of image?[...structureNames,...this.imageRegisters]:height?[...structureNames,'rowHeight'] as const:structureNames){
    const id=bound[`${name}VersionId`];if(typeof id!=='string')return fail();
    const version=this.registers.versions.get(id)??this.registers.candidates(this.root(name)).find(v=>v.id===id);
    if(!version||!version.present||version.root!==this.root(name)||version.key!==b.id||!this.registers.transactionAvailable(version.txId)||!equal(version.value,expected[name]))return fail();
   }
  }
  if(this.axes)new TableAxisOrder(this).check(data,bindings);
 }
 seed(data:RichBlockDocument){
  validateRichBlockDocument(data,this.links,this.tables,this.axes,this.widths,this.images,this.alignment,this.rasterFormats,this.imageCells,this.rowHeights,this.cellHeaders);
  for(const b of data.blocks)for(const {name,value} of blockBirthWrites(b,this.alignment))this.registers.write(this.root(name),b.id,true,value);
  if(this.axes)new TableAxisOrder(this).seed(data);
 }
 capture(identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeIds:string[]):RichBlockCapture {
  this.check(data,bindings);if(!Array.isArray(nodeIds)||!nodeIds.length||new Set(nodeIds).size!==nodeIds.length)return fail();
  const chosen=nodeIds.map(key=>data.blocks.find(b=>b.id===key)??fail()),first=chosen[0];
  if(chosen.some((b,i)=>b.parentId!==first.parentId||b.slot!==first.slot||i>0&&b.afterId!==chosen[i-1].id))return fail();
  return{format:'writers-hoard-block-capture/1',identity:convergenceClone(identity),field:this.field,nodeIds:convergenceClone(nodeIds),bindings:chosen.map(b=>convergenceClone(bindings.nodes.find(n=>n.id===b.id)!)),frontier:this.registers.frontier()};
 }
 moveCapture(identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,nodeId:string,destination:RichBlockPlacement):RichBlockMoveCapture {
  this.check(data,bindings);validateRichBlockPlacement(destination);const source=data.blocks.find(b=>b.id===nodeId);if(!source)return fail();
  if(this.tables&&(['table-row','table-column','table-cell','table-header','table-cell-style'].includes(source.type)||tableCellOf(data,nodeId)!==(destination.parentId===null?null:tableCellOf(data,destination.parentId))))return fail();
  if(destination.afterId!==null&&!data.blocks.some(b=>b.id===destination.afterId&&b.parentId===destination.parentId&&b.slot===destination.slot))return fail();
  const proposed=convergenceClone(data);reposition(proposed,nodeId,destination);validateRichBlockDocument(proposed,this.links,this.tables,this.axes,this.widths,this.images,this.alignment,this.rasterFormats,this.imageCells,this.rowHeights,this.cellHeaders);
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
   if(this.tables){const moving=data.blocks.find(b=>b.id===action.capture.nodeId);if(!moving||['table-row','table-column','table-cell','table-header','table-cell-style'].includes(moving.type)||tableCellOf(data,moving.id)!==(action.capture.destination.parentId===null?null:tableCellOf(data,action.capture.destination.parentId)))return fail();}
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
  result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);validateRichBlockDocument(result.data,this.links,this.tables,this.axes,this.widths,this.images,this.alignment,this.rasterFormats,this.imageCells,this.rowHeights,this.cellHeaders);return result;
 }
 commit(plan:RichBlockPlan){
  for(const w of plan.writes)this.registers.write(this.root(w.name),w.id,true,w.value);
  if(this.axes)new TableAxisOrder(this).commit(plan.axisInserts??[]);
  const changed=new Set(plan.writes.map(w=>w.id));
  plan.bindings.nodes=plan.data.blocks.map(block=>{const old=plan.bindings.nodes.find(n=>n.id===block.id);if(!old||changed.has(block.id)){
   const bound=old?convergenceClone(old):this.binding(block.id);for(const w of plan.writes.filter(w=>w.id===block.id))bound[`${w.name}VersionId`]=this.read(w.name,block.id)!.id;return bound;
  }return old;});
 }
 pending(){
  let missing=false;const known=new Set(this.registers.entries(this.root('kind')).map(v=>v.key));
  for(const key of known)for(const name of ['attrs','membership','placement'])if(!this.registers.entries(this.root(name),key).length)missing=true;
  if(this.images)for(const name of this.imageRegisters)for(const v of this.registers.entries(this.root(name))){
   if(!v.present)return fail();
   if(name==='imageSource')validateRichImageAsset(v.value,this.rasterFormats);else if(name==='imageSize'?!isRichImageSize(v.value):!isRichImageAlignment(v.value))return fail();
   const kinds=this.registers.entries(this.root('kind'),v.key);
   if(kinds.length&&(kinds.length!==1||kinds[0].value!=='image'))return fail();
   const birth=kinds[0];
   if(!birth||!this.registers.transactionAvailable(birth.txId)||!this.registers.transactionAvailable(v.txId)){missing=true;continue;}
   if(v.txId!==birth.txId&&!this.registers.ancestors(v.txId).has(birth.txId))return fail();
  }
  if(this.rowHeights)for(const version of this.registers.entries(this.root('rowHeight'))){
   if(!version.present||version.value!==null&&!validTableRowHeight(version.value))return fail();
   const kinds=this.registers.entries(this.root('kind'),version.key),birth=kinds[0];
   if(kinds.length&&(kinds.length!==1||birth.value!=='table-row'))return fail();
   if(!birth||!this.registers.transactionAvailable(birth.txId)||!this.registers.transactionAvailable(version.txId)){missing=true;continue;}
   if(version.txId!==birth.txId&&!this.registers.ancestors(version.txId).has(birth.txId))return fail();
  }
  for(const name of ['kind','attrs','membership','placement'])for(const v of this.registers.entries(this.root(name))){
   if(!v.present)return fail();if(!this.registers.transactionAvailable(v.txId))missing=true;
   if(name==='kind'&&!(['paragraph','heading','bullet-list','ordered-list','list-item','blockquote','toggle',...(this.tables?TABLE_KINDS:[]),...(this.axes?['table-column']:[]),...(this.cellHeaders?['table-cell-style']:[]),...(this.images?['image']:[])] as readonly string[]).includes(v.value as string))return fail();
   if(name==='kind'&&this.cellHeaders&&(v.value==='table-cell-style')!==v.key.startsWith(TABLE_CELL_STYLE_PREFIX))return fail();
   if(name==='kind'&&v.value==='image'&&this.imageRegisters.some(channel=>!this.registers.entries(this.root(channel),v.key).length))missing=true;
   if(name==='attrs'){
    if(!object(v.value))return fail();
    if(this.tables){const kinds=this.registers.entries(this.root('kind'),v.key);if(kinds.length&&!kinds.some(kind=>{if(kind.value==='image')return this.images&&Object.keys(v.value as object).length===0;try{validateRichBlockAttributes(kind.value,v.value,true,this.axes,this.widths,false,this.cellHeaders);return true;}catch{return false;}}))return fail();}
   }if(name==='membership'&&typeof v.value!=='boolean')return fail();
   if(name==='placement'){
    validateRichBlockPlacement(v.value,this.axes);
    if(this.images&&this.registers.entries(this.root('kind'),v.key).some(kind=>kind.value==='image')){
     const parent=v.value.parentId;
     if(v.value.slot!=='body'||parent!==null&&(!this.imageCells||known.has(parent)&&!this.registers.entries(this.root('kind'),parent).some(kind=>kind.value==='table-cell')))return fail();
    }
    if([v.value.parentId,v.value.afterId].some(ref=>ref!==null&&!known.has(ref)))missing=true;
   }
  }
  const axisPending=this.axes&&new TableAxisOrder(this).pending();return missing||axisPending;
 }
}

export function blockBirthWrites(block:RichBlock,alignment=false):Write[]{
 const image=block.type==='image',row=block.type==='table-row';
 const fields={kind:block.type,attrs:image?{}:row&&validTableRowHeight(block.attrs.heightPx)?{header:block.attrs.header}:block.attrs,membership:true,placement:{parentId:block.parentId,slot:block.slot,afterId:block.afterId},
  ...(image?{imageSource:block.attrs.asset,imageSize:block.attrs.displaySize,...(alignment?{imageAlignment:block.attrs.alignment}:{})}:{}),
  ...(row&&validTableRowHeight(block.attrs.heightPx)?{rowHeight:block.attrs.heightPx}:{})};
 return Object.entries(fields).map(([name,value])=>({name:name as Write['name'],id:block.id,value}));
}
