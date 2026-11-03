import type {LocalToolJson} from '../stateTypes';
import type {RichBlock,RichBlockDocument} from './blockFormat';
export const TABLE_SCHEMA='writers-blocks/2' as const;
export const TABLE_KINDS=['table','table-row','table-cell','table-header'] as const;
export type RichTableKind=typeof TABLE_KINDS[number];
const object=(value:unknown):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=():never=>{throw Error('local_tool_tables_invalid');};
export const tableKind=(kind:unknown):kind is RichTableKind=>TABLE_KINDS.includes(kind as RichTableKind);
export function validateTableAttributes(kind:RichTableKind,value:unknown):void {
 if(!object(value))return fail();const keys=Object.keys(value);
 if(kind==='table'){if(keys.length!==1||!Array.isArray(value.columns)||!value.columns.length||value.columns.some(id=>typeof id!=='string'||!id)||new Set(value.columns).size!==value.columns.length)fail();}
 else if(kind==='table-row'){if(keys.length)fail();}
 else if(keys.length!==1||typeof value.columnId!=='string'||!value.columnId)fail();
}
/** Finite fixed grid only. The retained RAW catalogue is not a visible table. */
export function validateTableLayout(data:RichBlockDocument):void {
 const byId=new Map(data.blocks.map(b=>[b.id,b])),children=(id:string)=>data.blocks.filter(b=>b.parentId===id),cell=(b:RichBlock)=>b.type==='table-cell'||b.type==='table-header';
 for(const b of data.blocks){
  const parent=b.parentId===null?undefined:byId.get(b.parentId);
  if(b.type==='table-row'&&(parent?.type!=='table'||b.slot!=='body'))fail();
  if(cell(b)&&(parent?.type!=='table-row'||b.slot!=='body'))fail();
  if(parent?.type==='table'&&b.type!=='table-row'||parent?.type==='table-row'&&!cell(b))fail();
  if(b.type==='table'){
   let ancestor=parent;while(ancestor){if(cell(ancestor))fail();ancestor=ancestor.parentId===null?undefined:byId.get(ancestor.parentId);}
   const rows=children(b.id);if(!rows.length)fail();const remaining=new Map(rows.map(row=>[row.id,row]));let previous:string|null=null;
   while(remaining.size){const next=[...remaining.values()].filter(row=>row.afterId===previous);if(next.length!==1)fail();previous=next[0].id;remaining.delete(previous);}
   const columns=b.attrs.columns as string[];
   for(const row of rows){
    const cells=children(row.id);if(cells.length!==columns.length)fail();let after:string|null=null;
    for(const column of columns){const matches=cells.filter(c=>c.attrs.columnId===column);if(matches.length!==1||matches[0].afterId!==after)fail();after=matches[0].id;}
   }
  }
  if(cell(b)){
   const stack=children(b.id),seen=new Set<string>();let leaf=false;
   while(stack.length){const next=stack.pop()!;if(seen.has(next.id))fail();seen.add(next.id);if(next.type==='paragraph'||next.type==='heading')leaf=true;stack.push(...children(next.id));}
   if(!leaf)fail();
  }
 }
}

/** Cells bound text edits; row/column surgery is outside the fixed-grid profile. */
export function tableCellOf(data:RichBlockDocument,nodeId:string):string|null {
 const byId=new Map(data.blocks.map(b=>[b.id,b])),seen=new Set<string>();let b=byId.get(nodeId);
 while(b){if(seen.has(b.id))fail();seen.add(b.id);if(b.type==='table-cell'||b.type==='table-header')return b.id;b=b.parentId===null?undefined:byId.get(b.parentId);}return null;
}
