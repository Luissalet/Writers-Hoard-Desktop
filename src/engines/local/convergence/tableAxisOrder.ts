import {JsonArray,convergenceCanonical} from './json';
import type {RichBlocks} from './blocks';
import type {RichBlockDocument,RichBlockBindings} from './blockFormat';
import type {RichTableAxis,RichTableAxisOrder} from './tableAxesFormat';
import {tableCellStyleId} from './tableAxesFormat';
export interface TableAxisEntry {id:string;node:string;txId:string;kindVersionId:string;attrsVersionId:string;membershipVersionId:string;placementVersionId:string;after:string|null}
export interface TableAxisInsertion {tableId:string;axis:RichTableAxis;node:string;entryId:string;after:string|null}
const fail=():never=>{throw Error('local_tool_table_axis_order_invalid');};
/** Intrinsic positions are retained like RichRuns placements; membership is separate. */
export class TableAxisOrder {
 readonly source:RichBlocks;
 constructor(source:RichBlocks){this.source=source;}
 private name(tableId:string,axis:RichTableAxis){return 'table-axis-order:'+JSON.stringify([this.source.field,tableId,axis]);}
 private array(tableId:string,axis:RichTableAxis){return new JsonArray<TableAxisEntry>(this.source.registers.doc.getArray(this.name(tableId,axis)));}
 private version(e:TableAxisEntry,name:'kind'|'attrs'|'membership'|'placement'){
  const known=this.source.registers.versions.get(e[`${name}VersionId`]);if(known)return known;
  const staged=this.source.registers.winner(this.source.root(name),e.node);return staged?.id===e[`${name}VersionId`]?staged:undefined;
 }
 entries(tableId:string,axis:RichTableAxis,available=true):TableAxisEntry[]{
  // Looking up a proposed birth cannot introduce an empty shared root on rejection.
  if(!this.source.registers.doc.share.has(this.name(tableId,axis)))return[];
  const entries=this.array(tableId,axis).toArray(),ids=new Map<string,TableAxisEntry>(),nodes=new Set<string>();
  for(const e of entries){
   if(!e||Object.keys(e).length!==8||['id','node','txId','kindVersionId','attrsVersionId','membershipVersionId','placementVersionId'].some(key=>typeof e[key as keyof TableAxisEntry]!=='string'||!e[key as keyof TableAxisEntry])||e.after!==null&&(typeof e.after!=='string'||!ids.has(e.after))||ids.has(e.id)||nodes.has(e.node))fail();
   const anchor=e.after===null?undefined:ids.get(e.after);if(anchor&&anchor.txId!==e.txId&&this.source.registers.transactionAvailable(e.txId)&&!this.source.registers.transactionParents(e.txId)?.some(parent=>parent===anchor.txId||this.source.registers.ancestors(parent).has(anchor.txId)))fail();
   ids.set(e.id,e);nodes.add(e.node);
   for(const name of ['kind','attrs','membership','placement']as const){
    const v=this.version(e,name);if(!v)continue;
    if(!v.present||v.root!==this.source.root(name)||v.key!==e.node||v.txId!==e.txId)fail();
    if(name==='kind'&&v.value!==(axis==='rows'?'table-row':'table-column')||name==='membership'&&v.value!==true)fail();
    if(name==='placement'){
     const p=v.value as {parentId:string;slot:string;afterId:string|null};
     if(p.parentId!==tableId||p.slot!==(axis==='rows'?'body':'columns')||p.afterId!==null)fail();
    }
   }
  }
  return available?entries.filter(e=>this.source.registers.transactionAvailable(e.txId)&&(['kind','attrs','membership','placement']as const).every(name=>!!this.version(e,name))):entries;
 }
 pending():boolean {
  let missing=false;const prefix='table-axis-order:';
  for(const name of this.source.registers.doc.share.keys())if(name.startsWith(prefix)){
   let key:unknown;try{key=JSON.parse(name.slice(prefix.length));}catch{return fail();}
   if(!Array.isArray(key)||key.length!==3||key.some(v=>typeof v!=='string'||!v)||!['rows','columns'].includes(key[2])||prefix+JSON.stringify(key)!==name)return fail();
   if(key[0]!==this.source.field)continue;
   const all=this.entries(key[1],key[2],false),ready=this.entries(key[1],key[2]);if(all.length!==ready.length)missing=true;
   const table=this.source.registers.entries(this.source.root('kind'),key[1]);if(!table.length)missing=true;else if(!table.some(v=>v.present&&v.value==='table'))fail();
  }
  for(const v of this.source.registers.entries(this.source.root('kind')))if(v.present&&(v.value==='table-row'||v.value==='table-column')){
   const places=this.source.registers.entries(this.source.root('placement'),v.key);if(!places.length){missing=true;continue;}
   if(!places.some(p=>this.entries((p.value as {parentId:string}).parentId,v.value==='table-row'?'rows':'columns',false).some(e=>e.node===v.key&&e.kindVersionId===v.id)))missing=true;
  }
  const birth=(id:string,kind:string)=>{const kinds=this.source.registers.entries(this.source.root('kind'),id);if(!kinds.length){missing=true;return;}return kinds.find(v=>v.present&&v.value===kind)??fail();};
  const owner=(id:string,kind:string)=>{const born=birth(id,kind);if(!born)return;const place=this.source.registers.entries(this.source.root('placement'),id).find(v=>v.txId===born.txId);if(!place){missing=true;return;}const p=place.value as {parentId:string|null};if(p.parentId===null)fail();return p.parentId??undefined;};
  // Hidden/retired fragments retain their own address proof. Grouping may not
  // turn a known foreign column or an anchor from another cell into a head.
  for(const v of this.source.registers.entries(this.source.root('kind')))if(v.present&&v.value==='table-cell'){
   const row=owner(v.key,'table-cell');if(!row)continue;const table=owner(row,'table-row'),attrs=this.source.registers.entries(this.source.root('attrs'),v.key).find(a=>a.txId===v.txId);if(!attrs){missing=true;continue;}
   const col=(attrs.value as {columnId:string}).columnId;if(typeof col!=='string'||!col)fail();const columnTable=owner(col,'table-column');if(table&&columnTable&&table!==columnTable)fail();
   for(const placement of this.source.registers.entries(this.source.root('placement'),v.key)){
    const p=placement.value as {parentId:string|null;afterId:string|null};if(p.parentId!==row)fail();if(p.afterId===null)continue;
    const anchor=birth(p.afterId,'table-cell'),anchorRow=owner(p.afterId,'table-cell');if(anchorRow&&anchorRow!==row)fail();if(!anchor)continue;
    const value=this.source.registers.entries(this.source.root('attrs'),p.afterId).find(a=>a.txId===anchor.txId);if(!value){missing=true;continue;}if((value.value as {columnId:string}).columnId!==col)fail();
   }
  }
  if(this.source.cellHeaders)for(const version of this.source.registers.entries(this.source.root('kind'))){
   if(!version.present||version.value!=='table-cell-style')continue;
   const attrs=this.source.registers.entries(this.source.root('attrs'),version.key);
   const places=this.source.registers.entries(this.source.root('placement'),version.key);
   const initialAttrs=attrs.find(entry=>entry.txId===version.txId)?.value as {columnId:string}|undefined;
   const initialPlace=places.find(entry=>entry.txId===version.txId)?.value as {parentId:string|null}|undefined;
   if(!initialAttrs||!initialPlace){missing=true;continue;}
   const row=initialPlace.parentId,column=initialAttrs.columnId;
   if(!row||!column)return fail();
   const table=owner(row,'table-row'),columnTable=owner(column,'table-column');
   if(table&&columnTable&&(columnTable!==table||version.key!==tableCellStyleId(table,row,column)))return fail();
   if(attrs.some(entry=>(entry.value as {columnId:string}).columnId!==column))return fail();
   if(places.some(entry=>{const p=entry.value as {parentId:string|null;slot:string;afterId:string|null};return p.parentId!==row||p.slot!=='body'||p.afterId!==null;}))return fail();
  }
  return missing;
 }
 project(data:{blocks:RichBlockDocument['blocks']}):RichTableAxisOrder[]{
  return data.blocks.filter(b=>b.type==='table').map(table=>{
   const represented=(axis:RichTableAxis)=>{const kind=axis==='rows'?'table-row':'table-column',known=new Set(data.blocks.filter(b=>b.parentId===table.id&&b.type===kind).map(b=>b.id)),ordered=this.entries(table.id,axis).filter(e=>known.has(e.node)).map(e=>e.node);if(ordered.length!==known.size)fail();return ordered;};
   return{tableId:table.id,rows:represented('rows'),columns:represented('columns')};
  });
 }
 check(data:RichBlockDocument,bindings:RichBlockBindings){
  for(const order of data.axisOrder??[])for(const axis of ['rows','columns']as const){
   const ids=new Set(order[axis]),entries=this.entries(order.tableId,axis).filter(e=>ids.has(e.node));
   if(convergenceCanonical(entries.map(e=>e.node))!==convergenceCanonical(order[axis]))fail();
   for(const entry of entries){const binding=bindings.nodes.find(b=>b.id===entry.node)??fail();
    // The observed node must have this intrinsic birth, not another same-body ID.
    if(binding.kindVersionId!==entry.kindVersionId)fail();
   }
  }
 }
 commit(inserts:readonly TableAxisInsertion[]){
  for(const insert of inserts){
   const array=this.array(insert.tableId,insert.axis),all=array.toArray(),at=insert.after===null?-1:all.findIndex(e=>e.id===insert.after);if(insert.after!==null&&at<0||all.some(e=>e.id===insert.entryId||e.node===insert.node))fail();
   const values=Object.fromEntries((['kind','attrs','membership','placement']as const).map(name=>{const v=this.source.registers.winner(this.source.root(name),insert.node);if(!v?.present)return fail();return[`${name}VersionId`,v.id];}))as Pick<TableAxisEntry,'kindVersionId'|'attrsVersionId'|'membershipVersionId'|'placementVersionId'>;
   const kind=this.source.registers.winner(this.source.root('kind'),insert.node)!;
   array.insert(at+1,[{id:insert.entryId,node:insert.node,txId:kind.txId,...values,after:insert.after}]);
  }
 }
 seed(data:RichBlockDocument){
  for(const order of data.axisOrder??[])for(const axis of ['rows','columns']as const){let after:string|null=null;
   for(const node of order[axis]){const id=crypto.randomUUID();this.commit([{tableId:order.tableId,axis,node,entryId:id,after}]);after=id;}
  }
 }
}
