import type {RichBlockDocument} from '../convergence/blockFormat';
import {richBlockChildren} from '../convergence/blockEditing';
/** Shared read projection; addresses are presentation coordinates, never block IDs. */
export function tableAxesRows(data:RichBlockDocument,tableId:string){
 const order=data.axisOrder?.find(o=>o.tableId===tableId);if(!order?.rows.length||!order.columns.length)return[];
 const byId=new Map(data.blocks.map(b=>[b.id,b])),byParent=new Map<string,RichBlockDocument['blocks']>();
 for(const block of data.blocks)if(block.parentId!==null){const children=byParent.get(block.parentId)??[];children.push(block);byParent.set(block.parentId,children);}
 return order.rows.map(rowId=>{
  const row=byId.get(rowId)!,columns=new Map<string,RichBlockDocument['blocks']>();
  for(const fragment of byParent.get(rowId)??[]){const columnId=String(fragment.attrs.columnId),siblings=columns.get(columnId)??[];siblings.push(fragment);columns.set(columnId,siblings);}
  return{row,cells:order.columns.map(columnId=>{
   const fragments=richBlockChildren({blocks:columns.get(columnId)??[]},rowId);
   return{tableId,rowId,columnId,address:JSON.stringify([tableId,rowId,columnId]),children:fragments.flatMap(fragment=>richBlockChildren({blocks:byParent.get(fragment.id)??[]},fragment.id))};
  })};
 });
}
