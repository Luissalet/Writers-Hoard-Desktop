import type {LocalToolJson} from '../stateTypes';
import type {RichBlock,RichBlockDocument} from './blockFormat';
export const TABLE_AXES_SCHEMA='writers-blocks/3' as const;
export const TABLE_WIDTHS_SCHEMA='writers-blocks/4' as const;
export const isTableAxesSchema=(schema:unknown)=>schema===TABLE_AXES_SCHEMA||schema===TABLE_WIDTHS_SCHEMA||schema==='writers-blocks/5'||schema==='writers-blocks/6';
export const MIN_TABLE_COLUMN_WIDTH=48;
export const validTableColumnWidth=(width:unknown):width is number=>typeof width==='number'&&Number.isSafeInteger(width)&&width>=MIN_TABLE_COLUMN_WIDTH;
export interface RichTableAxisOrder {tableId:string;rows:string[];columns:string[]}
export type RichTableAxis='rows'|'columns';
export const axisKind=(kind:unknown)=>kind==='table'||kind==='table-row'||kind==='table-column'||kind==='table-cell';
const object=(v:unknown):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('local_tool_table_axes_invalid');};
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(id=>typeof id==='string'&&!!id)&&new Set(v).size===v.length;
export function validateAxisAttributes(kind:unknown,value:unknown,widths=false):void {
 if(!object(value))return fail();const keys=Object.keys(value);
 if(kind==='table'){if(keys.length)fail();}
 else if(kind==='table-column'){if(keys.length&&(!widths||keys.length!==1||!validTableColumnWidth(value.widthPx)))fail();}
 else if(kind==='table-row'){if(keys.length!==1||typeof value.header!=='boolean')fail();}
 else if(kind==='table-cell'){if(keys.length!==1||typeof value.columnId!=='string'||!value.columnId)fail();}
 else fail();
}
export function tableCellAddress(data:RichBlockDocument,nodeId:string):[string,string,string]|null {
 const byId=new Map(data.blocks.map(b=>[b.id,b])),seen=new Set<string>();let block=byId.get(nodeId);
 while(block){if(seen.has(block.id))return fail();seen.add(block.id);if(block.type==='table-cell'){
  const row=block.parentId===null?undefined:byId.get(block.parentId),table=row?.parentId===null?undefined:byId.get(row?.parentId??'');
  if(row?.type!=='table-row'||table?.type!=='table'||typeof block.attrs.columnId!=='string')return fail();return[table.id,row.id,block.attrs.columnId];
 }block=block.parentId===null?undefined:byId.get(block.parentId);}return null;
}
/** Sparse real fragments; empty logical cells do not appear as authored blocks. */
export function validateTableAxesLayout(data:RichBlockDocument):void {
 const byId=new Map(data.blocks.map(b=>[b.id,b])),children=(id:string)=>data.blocks.filter(b=>b.parentId===id),tables=data.blocks.filter(b=>b.type==='table');
 if(!Array.isArray(data.axisOrder)||data.axisOrder.length!==tables.length)return fail();
 for(const [at,order]of data.axisOrder.entries()){
  if(!object(order)||Object.keys(order).length!==3||order.tableId!==tables[at].id||!ids(order.rows)||!ids(order.columns))return fail();
  for(const [dimension,kind]of [['rows','table-row'],['columns','table-column']]as const){
   const actual=children(order.tableId).filter(b=>b.type===kind).map(b=>b.id).sort();if(JSON.stringify([...order[dimension]].sort())!==JSON.stringify(actual))fail();
  }
 }
 for(const b of data.blocks){
  const parent=b.parentId===null?undefined:byId.get(b.parentId);
  if(b.type==='table-row'&&(parent?.type!=='table'||b.slot!=='body'||b.afterId!==null)||b.type==='table-column'&&(parent?.type!=='table'||b.slot!=='columns'||b.afterId!==null))fail();
  if(b.slot==='columns'&&b.type!=='table-column')fail();
  if(parent?.type==='table'&&!['table-row','table-column'].includes(b.type)||parent?.type==='table-row'&&b.type!=='table-cell')fail();
  if(b.type==='table-column'&&children(b.id).length)fail();
  if(b.type==='table-cell'){
   const address=tableCellAddress(data,b.id)!;const column=byId.get(address[2]);if(column?.type!=='table-column'||column.parentId!==address[0]||b.slot!=='body')fail();
   if(b.afterId!==null){const anchor=byId.get(b.afterId);if(anchor&&(anchor.type!=='table-cell'||JSON.stringify(tableCellAddress(data,anchor.id))!==JSON.stringify(address)))fail();}
   const stack:RichBlock[]=[...children(b.id)],seen=new Set<string>();let leaf=false;
   while(stack.length){const next=stack.pop()!;if(seen.has(next.id)||axisKind(next.type))fail();seen.add(next.id);if(next.type==='paragraph'||next.type==='heading')leaf=true;stack.push(...children(next.id));}if(!leaf)fail();
  }
  if(b.type==='table'){let ancestor=parent;while(ancestor){if(ancestor.type==='table-cell')fail();ancestor=ancestor.parentId===null?undefined:byId.get(ancestor.parentId);}}
 }
}
