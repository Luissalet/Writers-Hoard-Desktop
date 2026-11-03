import type {RichBlockEditCapture} from './blockEditingTypes';
import type {RichBlock,RichBlockDocument,RichBlockBindings} from './blockFormat';
import type {RichBlocks,RichBlockPlan} from './blocks';
import type {RichAction,RichMark} from './richTypes';
import {convergenceClone} from './format';
import {validateRichBlockDocument} from './blockFormat';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
export interface RichTableInsertAction {
 type:'rich-table-insert';field:string;capture:RichBlockEditCapture;
 table:{id:string;columns:string[];rows:{id:string;cells:{id:string;columnId:string;header?:boolean;paragraph:{id:string;text:string;marks?:RichMark[];link?:{href:string}}}[]}[]};
}
const fail=():never=>{throw Error('local_tool_tables_invalid');};
const exact=(value:object,required:readonly string[],optional:readonly string[]=[])=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
export function prepareTableInsert(source:RichBlocks,data:RichBlockDocument,bindings:RichBlockBindings,action:RichTableInsertAction,intrinsicLastLeaf:string|null):RichBlockPlan&{textActions:RichAction[]} {
 if(!source.tables||action.capture.nodeIds.length||!action.capture.destination)fail();const table=convergenceClone(action.table),destination=convergenceClone(action.capture.destination!);
 if(!table||!exact(table,['id','columns','rows'])||!Array.isArray(table.rows)||!table.rows.length)fail();
 const result={data:convergenceClone(data),bindings:convergenceClone(bindings),writes:[] as RichBlockPlan['writes'],textActions:[] as RichAction[]},added=new Set<string>();
 const put=(block:RichBlock)=>{if(typeof block.id!=='string'||!block.id||added.has(block.id)||source.registers.candidates(source.root('kind')).some(value=>value.key===block.id)||source.registers.entries(source.root('kind'),block.id).length||data.blocks.some(b=>b.id===block.id))fail();added.add(block.id);result.data.blocks.push(block);for(const[name,value]of Object.entries({kind:block.type,attrs:block.attrs,membership:true,placement:{parentId:block.parentId,slot:block.slot,afterId:block.afterId}}))result.writes.push({name:name as RichBlockPlan['writes'][number]['name'],id:block.id,value});};
 put({id:table.id,type:'table',attrs:{columns:table.columns},...destination});let rowAfter:string|null=null,leafAfter=intrinsicLastLeaf;
 for(const row of table.rows){
  if(!row||!exact(row,['id','cells'])||!Array.isArray(row.cells))fail();put({id:row.id,type:'table-row',attrs:{},parentId:table.id,slot:'body',afterId:rowAfter});rowAfter=row.id;let cellAfter:string|null=null;
  for(const cell of row.cells){
   if(!cell||!exact(cell,['id','columnId','paragraph'],['header'])||cell.header!==undefined&&typeof cell.header!=='boolean')fail();const p=cell.paragraph;
   if(!p||!exact(p,['id','text'],['marks','link'])||typeof p.text!=='string'||p.marks!==undefined&&!Array.isArray(p.marks))fail();
   const href=p.link===undefined?undefined:p.link&&typeof p.link.href==='string'&&exact(p.link,['href'])?normalizeEditorLinkHref(p.link.href):undefined;if(p.link!==undefined&&!href)fail();
   const marks=[...(p.marks??[]).map(type=>({type})),...(href?[{type:'link' as const,attrs:{href}}]:[])];
   put({id:cell.id,type:cell.header?'table-header':'table-cell',attrs:{columnId:cell.columnId},parentId:row.id,slot:'body',afterId:cellAfter});cellAfter=cell.id;
   put({id:p.id,type:'paragraph',attrs:{},parentId:cell.id,slot:'body',afterId:null,content:p.text?[{type:'text',text:p.text,...(marks.length?{marks}:{})}]:[]});
   result.textActions.push({type:'rich-insert-paragraph',field:action.field,id:p.id,afterId:leafAfter,text:p.text,...(p.marks?{marks:p.marks}:{}),...(href?{link:{href}}:{})});leafAfter=p.id;
  }
 }
 for(const b of result.data.blocks)if(!added.has(b.id)&&b.parentId===destination.parentId&&b.slot===destination.slot&&b.afterId===destination.afterId){b.afterId=table.id;result.writes.push({name:'placement',id:b.id,value:{parentId:b.parentId,slot:b.slot,afterId:table.id}});}
 result.data.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);validateRichBlockDocument(result.data,source.links,true);return result;
}
