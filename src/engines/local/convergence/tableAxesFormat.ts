import type {LocalToolJson} from '../stateTypes';
import type {RichBlock,RichBlockDocument} from './blockFormat';
import {isImageBlockSchema} from './imageFormat';
import {tableCellSpanId} from './tableSpanGeometry';
export const TABLE_AXES_SCHEMA='writers-blocks/3' as const;
export const TABLE_WIDTHS_SCHEMA='writers-blocks/4' as const;
export const isTableWidthsSchema=(schema:unknown)=>schema===TABLE_WIDTHS_SCHEMA||isImageBlockSchema(schema);
export const isTableAxesSchema=(schema:unknown)=>schema===TABLE_AXES_SCHEMA||isTableWidthsSchema(schema);
export const MIN_TABLE_COLUMN_WIDTH=48;
export const validTableColumnWidth=(width:unknown):width is number=>typeof width==='number'&&Number.isSafeInteger(width)&&width>=MIN_TABLE_COLUMN_WIDTH;
export const MIN_TABLE_ROW_HEIGHT=24;
export const validTableRowHeight=(height:unknown):height is number=>typeof height==='number'&&Number.isSafeInteger(height)&&height>=MIN_TABLE_ROW_HEIGHT;
export interface RichTableAxisOrder {tableId:string;rows:string[];columns:string[]}
export type RichTableAxis='rows'|'columns';
export const axisKind=(kind:unknown)=>kind==='table'||kind==='table-row'||kind==='table-column'||kind==='table-cell'||kind==='table-cell-style'||kind==='table-cell-span';
export const TABLE_CELL_STYLE_PREFIX='@writer/table-cell-style/';
export const tableCellStyleId=(tableId:string,rowId:string,columnId:string)=>TABLE_CELL_STYLE_PREFIX+JSON.stringify([tableId,rowId,columnId]);
const object=(v:unknown):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('local_tool_table_axes_invalid');};
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(id=>typeof id==='string'&&!!id)&&new Set(v).size===v.length;
export function validateAxisAttributes(kind:unknown,value:unknown,widths=false,rowHeights=false,cellHeaders=false,cellSpans=false):void {
 if(!object(value))return fail();const keys=Object.keys(value);
 if(kind==='table'){if(keys.length)fail();}
 else if(kind==='table-column'){if(keys.length&&(!widths||keys.length!==1||!validTableColumnWidth(value.widthPx)))fail();}
 else if(kind==='table-row'){if(typeof value.header!=='boolean'||!(keys.length===1||rowHeights&&keys.length===2&&validTableRowHeight(value.heightPx)))fail();}
 else if(kind==='table-cell'){if(keys.length!==1||typeof value.columnId!=='string'||!value.columnId)fail();}
 else if(kind==='table-cell-span'){
  if(!cellSpans||keys.length!==3||typeof value.columnId!=='string'||!value.columnId||
     !ids(value.rows)||!ids(value.columns)||!value.rows.length||value.columns[0]!==value.columnId||
     value.rows.length===1&&value.columns.length===1)fail();
 }
 else if(kind==='table-cell-style'){if(!cellHeaders||keys.length!==2||typeof value.columnId!=='string'||!value.columnId||value.header!==null&&typeof value.header!=='boolean')fail();}
 else fail();
}
function cellAncestor(byId:ReadonlyMap<string,RichBlock>,nodeId:string){
 const seen=new Set<string>();let block=byId.get(nodeId);
 while(block){if(seen.has(block.id))return fail();seen.add(block.id);if(block.type==='table-cell')return block;block=block.parentId===null?undefined:byId.get(block.parentId);}
}
export function tableCellFragmentId(data:RichBlockDocument,nodeId:string):string|null {
 return cellAncestor(new Map(data.blocks.map(block=>[block.id,block])),nodeId)?.id??null;
}
export function tableCellAddress(data:RichBlockDocument,nodeId:string):[string,string,string]|null {
 const byId=new Map(data.blocks.map(b=>[b.id,b])),block=cellAncestor(byId,nodeId);
 if(!block)return null;
 const row=block.parentId===null?undefined:byId.get(block.parentId),table=row?.parentId===null?undefined:byId.get(row?.parentId??'');
 if(row?.type!=='table-row'||table?.type!=='table'||typeof block.attrs.columnId!=='string')return fail();return[table.id,row.id,block.attrs.columnId];
}
/** Sparse real fragments; empty logical cells do not appear as authored blocks. */
export function validateTableAxesLayout(data:RichBlockDocument,imageCells=false,cellHeaders=false,cellSpans=false):void {
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
  if(parent?.type==='table'&&!['table-row','table-column'].includes(b.type)||parent?.type==='table-row'&&b.type!=='table-cell'&&b.type!=='table-cell-style'&&b.type!=='table-cell-span')fail();
  if(b.type==='table-column'&&children(b.id).length)fail();
  if(b.type==='table-cell-span'){
   const column=byId.get(String(b.attrs.columnId)),tableId=parent?.parentId;
   const rows=b.attrs.rows as string[],columns=b.attrs.columns as string[];
   if(!cellSpans||parent?.type!=='table-row'||!tableId||column?.type!=='table-column'||column.parentId!==tableId||
      b.id!==tableCellSpanId(tableId,parent.id,column.id)||rows[0]!==parent.id||b.slot!=='body'||b.afterId!==null||children(b.id).length)fail();
   for(const [kind,ids]of [['table-row',rows],['table-column',columns]] as const)for(const id of ids){
    const axis=byId.get(id);if(axis&&(axis.type!==kind||axis.parentId!==tableId))fail();
   }
  }
  if(b.type==='table-cell-style'){
   const column=byId.get(String(b.attrs.columnId)),tableId=parent?.parentId;
   if(!cellHeaders||parent?.type!=='table-row'||!tableId||column?.type!=='table-column'||column.parentId!==tableId||
      b.id!==tableCellStyleId(tableId,parent.id,column.id)||b.slot!=='body'||b.afterId!==null||children(b.id).length)fail();
  }
  if(b.type==='table-cell'){
   const address=tableCellAddress(data,b.id)!;const column=byId.get(address[2]);if(column?.type!=='table-column'||column.parentId!==address[0]||b.slot!=='body')fail();
   if(b.afterId!==null){const anchor=byId.get(b.afterId);if(anchor&&(anchor.type!=='table-cell'||JSON.stringify(tableCellAddress(data,anchor.id))!==JSON.stringify(address)))fail();}
   const stack:RichBlock[]=[...children(b.id)],seen=new Set<string>();
   // A retained fragment anchor can be empty after its last image was removed.
   let leaf=imageCells&&!stack.length;
   while(stack.length){const next=stack.pop()!;if(seen.has(next.id)||axisKind(next.type))fail();seen.add(next.id);if(next.type==='paragraph'||next.type==='heading'||imageCells&&next.type==='image')leaf=true;stack.push(...children(next.id));}if(!leaf)fail();
  }
  if(b.type==='table'){let ancestor=parent;while(ancestor){if(ancestor.type==='table-cell')fail();ancestor=ancestor.parentId===null?undefined:byId.get(ancestor.parentId);}}
 }
}
