import type {RichBlockDocument} from '../convergence/blockFormat';
import {richBlockChildren} from '../convergence/blockEditing';
import {MIN_TABLE_COLUMN_WIDTH,validTableColumnWidth} from '../convergence/tableAxesFormat';

export interface TableColumnLayout {columnId:string;widthPx:number|null}
export function tableWidthStyle(columns:readonly TableColumnLayout[]){
 if(!columns.some(column=>column.widthPx!==null))return undefined;
 const pixels=columns.reduce((total,column)=>total+(column.widthPx??MIN_TABLE_COLUMN_WIDTH),0)+'px';
 return columns.some(column=>column.widthPx===null)?{width:'100%',minWidth:pixels}:{width:pixels};
}
/** Shared read projection; addresses are presentation coordinates, never block IDs. */
export function tableAxesRows(data:RichBlockDocument,tableId:string){
 const order=data.axisOrder?.find(o=>o.tableId===tableId);if(!order?.rows.length||!order.columns.length)return[];
 const byId=new Map(data.blocks.map(b=>[b.id,b])),byParent=new Map<string,RichBlockDocument['blocks']>();
 for(const block of data.blocks)if(block.parentId!==null){const children=byParent.get(block.parentId)??[];children.push(block);byParent.set(block.parentId,children);}
 const ordered=order.columns.map(columnId=>{
  const width=byId.get(columnId)?.attrs.widthPx;
  return {columnId,widthPx:validTableColumnWidth(width)?width:null};
 });
 return order.rows.map(rowId=>{
  const row=byId.get(rowId)!,columns=new Map<string,RichBlockDocument['blocks']>();
  for(const fragment of byParent.get(rowId)??[]){const columnId=String(fragment.attrs.columnId),siblings=columns.get(columnId)??[];siblings.push(fragment);columns.set(columnId,siblings);}
  return{row,cells:ordered.map(({columnId,widthPx})=>{
   const fragments=richBlockChildren({blocks:columns.get(columnId)??[]},rowId);
   return{tableId,rowId,columnId,widthPx,address:JSON.stringify([tableId,rowId,columnId]),children:fragments.flatMap(fragment=>richBlockChildren({blocks:byParent.get(fragment.id)??[]},fragment.id))};
  })};
 });
}
