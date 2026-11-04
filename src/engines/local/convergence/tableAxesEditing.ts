import {convergenceClone,convergenceCanonical,assertConvergenceIdentity} from './format';
import type {LocalToolConvergenceIdentity} from './types';
import type {RichBlockDocument,RichBlockBindings,RichBlockBinding,RichBlock} from './blockFormat';
import {validateRichBlockDocument} from './blockFormat';
import type {RichBlocks,RichBlockPlan} from './blocks';
import type {RichAction,RichMark} from './richTypes';
import type {RichBlockEditCapture} from './blockEditingTypes';
import {validTableColumnWidth,type RichTableAxis} from './tableAxesFormat';
import {TableAxisOrder,type TableAxisEntry,type TableAxisInsertion} from './tableAxisOrder';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
export interface RichTableAxisCapture {format:'writers-hoard-table-axis/1';identity:LocalToolConvergenceIdentity;field:string;tableId:string;axis:RichTableAxis;table:RichBlockBinding;anchor:TableAxisEntry|null;frontier:string[]}
export interface RichTableCellCapture {format:'writers-hoard-table-cell/1';identity:LocalToolConvergenceIdentity;field:string;tableId:string;rowId:string;columnId:string;afterId:string|null;bindings:RichBlockBinding[];frontier:string[]}
export interface RichTableColumnWidthCapture {
 format:'writers-hoard-table-column-width/1';
 identity:LocalToolConvergenceIdentity;
 field:string;
 tableId:string;
 columnId:string;
 table:RichBlockBinding;
 column:RichBlockBinding;
 birth:TableAxisEntry;
 widthPx:number|null;
 frontier:string[];
}
export type RichTableCreateAction={type:'rich-table-create';field:string;capture:RichBlockEditCapture;table:{id:string;rows:{id:string;header:boolean}[];columns:{id:string}[]}};
export type RichTableAxesAction={type:'rich-table-axis-insert';field:string;capture:RichTableAxisCapture;id:string;header?:boolean}|{type:'rich-table-axis-hide';field:string;capture:RichTableAxisCapture}|{type:'rich-table-cell-insert';field:string;capture:RichTableCellCapture;fragment:{id:string;paragraph:{id:string;text:string;marks?:RichMark[];link?:{href:string}}}}|{type:'rich-table-column-width';field:string;capture:RichTableColumnWidthCapture;widthPx:number|null};
export const isTableAxesAction=(action:{type:string}):action is RichTableAxesAction=>['rich-table-axis-insert','rich-table-axis-hide','rich-table-cell-insert','rich-table-column-width'].includes(action.type);
const fail=():never=>{throw Error('local_tool_table_axes_action_invalid');};
const same=(a:unknown,b:unknown)=>convergenceCanonical(a)===convergenceCanonical(b);
function table(source:RichBlocks,data:RichBlockDocument,tableId:string){if(!source.axes||!data.blocks.some(b=>b.id===tableId&&b.type==='table'))return fail();return data.axisOrder?.find(o=>o.tableId===tableId)??fail();}
function axisWitness(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,axis:RichTableAxis,afterId:string|null){
 const shape=table(source,data,tableId),bound=bindings.nodes.find(b=>b.id===tableId)??fail();if(axis!=='rows'&&axis!=='columns'||afterId!==null&&typeof afterId!=='string')fail();
 if(!shape.rows.length||!shape.columns.length)for(const name of ['kind','attrs','membership','placement']as const){const current=source.registers.winner(source.root(name),tableId);if(!current?.present||current.id!==bound[`${name}VersionId`]||name==='membership'&&current.value!==true)fail();}
 const anchor=afterId===null?null:new TableAxisOrder(source).entries(tableId,axis).find(e=>e.node===afterId)??fail();
 return{table:convergenceClone(bound),anchor:convergenceClone(anchor)};
}
export function captureTableAxis(source:RichBlocks,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,axis:RichTableAxis,afterId:string|null):RichTableAxisCapture {
 source.check(data,bindings);return{format:'writers-hoard-table-axis/1',identity:convergenceClone(identity),field:source.field,tableId,axis,...axisWitness(source,data,bindings,tableId,axis,afterId),frontier:source.registers.frontier()};
}
function cellWitness(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,rowId:string,columnId:string,afterId:string|null){
 const order=table(source,data,tableId);if(!order.rows.includes(rowId)||!order.columns.includes(columnId))fail();
 if(afterId!==null&&!data.blocks.some(b=>b.id===afterId&&b.type==='table-cell'&&b.parentId===rowId&&b.attrs.columnId===columnId))fail();
 const ids=new Set([tableId,rowId,columnId,...(afterId?[afterId]:[])]);
 const proof=bindings.nodes.filter(b=>ids.has(b.id));if(proof.length!==ids.size)fail();return convergenceClone(proof);
}
export function captureTableCell(source:RichBlocks,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,rowId:string,columnId:string,afterId:string|null=null):RichTableCellCapture {
 source.check(data,bindings);return{format:'writers-hoard-table-cell/1',identity:convergenceClone(identity),field:source.field,tableId,rowId,columnId,afterId,bindings:cellWitness(source,data,bindings,tableId,rowId,columnId,afterId),frontier:source.registers.frontier()};
}
export function sameTableCellBindings(current:RichBlockBinding[],captured:RichBlockBinding[],columnId?:string):boolean {
 if(!columnId)return same(current,captured);
 const structure=(values:RichBlockBinding[])=>values.map(({attrsVersionId,...binding})=>binding.id===columnId?binding:{...binding,attrsVersionId});
 return same(structure(current),structure(captured));
}
function widthWitness(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,columnId:string){
 if(!source.widths||!table(source,data,tableId).columns.includes(columnId))return fail();
 const column=data.blocks.find(block=>block.id===columnId&&block.type==='table-column'&&block.parentId===tableId);
 const tableBinding=bindings.nodes.find(binding=>binding.id===tableId),columnBinding=bindings.nodes.find(binding=>binding.id===columnId);
 const birth=new TableAxisOrder(source).entries(tableId,'columns').find(entry=>entry.node===columnId);
 if(!column||!tableBinding||!columnBinding||!birth||birth.kindVersionId!==columnBinding.kindVersionId)return fail();
 return {table:tableBinding,column:columnBinding,birth,widthPx:validTableColumnWidth(column.attrs.widthPx)?column.attrs.widthPx:null};
}
export function captureTableColumnWidth(source:RichBlocks,identity:LocalToolConvergenceIdentity,data:RichBlockDocument,bindings:RichBlockBindings,tableId:string,columnId:string):RichTableColumnWidthCapture {
 if(!source.widths||!bindings)return fail();
 source.check(data,bindings);
 return convergenceClone({format:'writers-hoard-table-column-width/1',identity,field:source.field,tableId,columnId,...widthWitness(source,data,bindings,tableId,columnId),frontier:source.registers.frontier()});
}
export function prepareTableAxes(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,action:RichTableCreateAction|RichTableAxesAction,identity:LocalToolConvergenceIdentity,lastLeaf:string|null,priorInserts:readonly TableAxisInsertion[]=[]):RichBlockPlan&{textActions:RichAction[]} {
 if(!source.axes)fail();assertConvergenceIdentity(action.capture.identity,identity);if(action.field!==source.field||action.capture.field!==source.field)fail();
 const result:RichBlockPlan&{textActions:RichAction[]}={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[],axisInserts:[],textActions:[]};
 const put=(block:RichBlock)=>{
  if(typeof block.id!=='string'||!block.id||source.registers.entries(source.root('kind'),block.id).length||result.data.blocks.some(b=>b.id===block.id))fail();
  result.data.blocks.push(block);for(const[name,value]of Object.entries({kind:block.type,attrs:block.attrs,membership:true,placement:{parentId:block.parentId,slot:block.slot,afterId:block.afterId}}))result.writes.push({name:name as RichBlockPlan['writes'][number]['name'],id:block.id,value});
 };
 const axis=(tableId:string,dimension:RichTableAxis,id:string,header:boolean,anchor:Pick<TableAxisEntry,'id'|'node'>|null)=>{
  put({id,type:dimension==='rows'?'table-row':'table-column',attrs:dimension==='rows'?{header}:{},parentId:tableId,slot:dimension==='rows'?'body':'columns',afterId:null});
  result.axisInserts!.push({tableId,axis:dimension,node:id,entryId:crypto.randomUUID(),after:anchor?.id??null});
  const order=result.data.axisOrder!.find(o=>o.tableId===tableId)??fail(),visible=new Set([...order[dimension],id]),physical:Pick<TableAxisEntry,'id'|'node'>[]=new TableAxisOrder(source).entries(tableId,dimension);
  // Use the same insertion sequence as commit, including earlier actions in this batch.
  for(const item of [...priorInserts,...result.axisInserts!])if(item.tableId===tableId&&item.axis===dimension){const at=item.after===null?-1:physical.findIndex(e=>e.id===item.after);if(item.after!==null&&at<0)fail();physical.splice(at+1,0,{id:item.entryId,node:item.node});}
  order[dimension]=physical.filter(e=>visible.has(e.node)).map(e=>e.node);
 };
 if(action.type==='rich-table-create'){
  const payload=convergenceClone(action.table),destination=action.capture.destination;
  if(!destination||action.capture.nodeIds.length||!payload||Object.keys(payload).length!==3||!Array.isArray(payload.rows)||!payload.rows.length||!Array.isArray(payload.columns)||!payload.columns.length)return fail();
  put({id:payload.id,type:'table',attrs:{},...convergenceClone(destination)});result.data.axisOrder!.push({tableId:payload.id,rows:[],columns:[]});
  for(const dimension of ['rows','columns']as const){let previous:Pick<TableAxisEntry,'id'|'node'>|null=null;
   for(const item of payload[dimension]){if(!item||Object.keys(item).length!==(dimension==='rows'?2:1)||dimension==='rows'&&typeof(item as {header:boolean}).header!=='boolean')fail();axis(payload.id,dimension,item.id,dimension==='rows'&&(item as {header:boolean}).header,previous);const inserted=result.axisInserts!.at(-1)!;previous={id:inserted.entryId,node:item.id};}
  }
  for(const b of result.data.blocks)if(b.id!==payload.id&&b.parentId===destination.parentId&&b.slot===destination.slot&&b.afterId===destination.afterId){b.afterId=payload.id;result.writes.push({name:'placement',id:b.id,value:{parentId:b.parentId,slot:b.slot,afterId:payload.id}});}
 }else if(action.type==='rich-table-axis-insert'||action.type==='rich-table-axis-hide'){
  const capture=action.capture,order=table(source,data,capture.tableId),now=axisWitness(source,data,bindings,capture.tableId,capture.axis,capture.anchor?.node??null);
  if(!same(now.table,capture.table)||!same(now.anchor,capture.anchor))fail();
  if(action.type==='rich-table-axis-insert'){
   if(action.header!==undefined&&(capture.axis!=='rows'||typeof action.header!=='boolean'))fail();axis(capture.tableId,capture.axis,action.id,action.header??false,capture.anchor);
  }else{
   const id=capture.anchor?.node;if(!id||!order[capture.axis].includes(id))return fail();result.writes.push({name:'membership',id,value:false});
   result.data.axisOrder!.find(o=>o.tableId===capture.tableId)![capture.axis]=order[capture.axis].filter(n=>n!==id);
   const hidden=new Set<string>([id]);if(capture.axis==='columns')for(const b of result.data.blocks)if(b.type==='table-cell'&&b.attrs.columnId===id)hidden.add(b.id);
   let changed=true;while(changed){changed=false;for(const b of result.data.blocks)if(b.parentId!==null&&hidden.has(b.parentId)&&!hidden.has(b.id)){hidden.add(b.id);changed=true;}}
   result.data.blocks=result.data.blocks.filter(b=>!hidden.has(b.id));
  }
 }else if(action.type==='rich-table-column-width'){
  const {capture:c,widthPx}=action;
  if(Object.keys(action).length!==4||widthPx!==null&&!validTableColumnWidth(widthPx))return fail();
  const current=widthWitness(source,data,bindings,c.tableId,c.columnId);
  if(!same(current,{table:c.table,column:c.column,birth:c.birth,widthPx:c.widthPx}))return fail();
  if(widthPx!==current.widthPx){
   const attrs:RichBlock['attrs']=widthPx===null?{}:{widthPx};
   result.data.blocks.find(block=>block.id===c.columnId)!.attrs=attrs;
   result.writes.push({name:'attrs',id:c.columnId,value:attrs});
  }
 }else{
  const c=action.capture,order=table(source,data,c.tableId);if(!order.rows.includes(c.rowId)||!order.columns.includes(c.columnId))fail();
  const now=cellWitness(source,data,bindings,c.tableId,c.rowId,c.columnId,c.afterId);if(!sameTableCellBindings(now,c.bindings,source.widths?c.columnId:undefined))fail();
  const fragment=convergenceClone(action.fragment),p=fragment?.paragraph;if(!fragment||Object.keys(fragment).length!==2||!p||Object.keys(p).some(k=>!['id','text','marks','link'].includes(k))||typeof p.text!=='string'||p.marks!==undefined&&!Array.isArray(p.marks))fail();
  const href=p.link===undefined?undefined:p.link&&Object.keys(p.link).length===1&&typeof p.link.href==='string'?normalizeEditorLinkHref(p.link.href):null;if(p.link!==undefined&&!href)fail();
  const marks=[...(p.marks??[]).map(type=>({type})),...(href?[{type:'link' as const,attrs:{href}}]:[])];
  put({id:fragment.id,type:'table-cell',attrs:{columnId:c.columnId},parentId:c.rowId,slot:'body',afterId:c.afterId});
  put({id:p.id,type:'paragraph',attrs:{},parentId:fragment.id,slot:'body',afterId:null,content:p.text?[{type:'text',text:p.text,...(marks.length?{marks}:{})}]:[]});
  result.textActions.push({type:'rich-insert-paragraph',field:action.field,id:p.id,afterId:lastLeaf,text:p.text,...(p.marks?{marks:p.marks}:{}),...(href?{link:{href}}:{})});
 }
 result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);result.data.axisOrder!.sort((a,b)=>a.tableId<b.tableId?-1:a.tableId>b.tableId?1:0);validateRichBlockDocument(result.data,source.links,true,true,source.widths,source.images,source.alignment,source.rasterFormats);return result;
}
