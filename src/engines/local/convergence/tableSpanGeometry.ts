import type {RichBlock} from './blockFormat';
import type {RichTableAxisOrder} from './tableAxesFormat';

export type TableArea={top:number;left:number;height:number;width:number};
export const TABLE_CELL_SPAN_PREFIX='@writer/table-cell-span/';
export const tableCellSpanId=(tableId:string,rowId:string,columnId:string)=>TABLE_CELL_SPAN_PREFIX+JSON.stringify([tableId,rowId,columnId]);
export const areasIntersect=(a:TableArea,b:TableArea)=>a.top<b.top+b.height&&b.top<a.top+a.height&&a.left<b.left+b.width&&b.left<a.left+a.width;
export const areaContains=(outer:TableArea,inner:TableArea)=>inner.top>=outer.top&&inner.left>=outer.left&&inner.top+inner.height<=outer.top+outer.height&&inner.left+inner.width<=outer.left+outer.width;

/** Span markers retain stable axis identities. Hidden endpoints shrink the visible span. */
export function tableSpans(order:RichTableAxisOrder,blocks:readonly RichBlock[]):{marker:RichBlock;area:TableArea}[]{
 const rows=new Map(order.rows.map((id,i)=>[id,i])),columns=new Map(order.columns.map((id,i)=>[id,i]));
 const visible:{marker:RichBlock;area:TableArea}[]=[];
 const reach=(axis:Map<string,number>,ids:unknown,start:number)=>{
  let end=start;
  if(Array.isArray(ids))for(const id of ids)if(typeof id==='string')end=Math.max(end,axis.get(id)??start);
  return end-start+1;
 };
 const markers=blocks.filter(block=>block.type==='table-cell-span').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 for(const marker of markers){
  const top=rows.get(marker.parentId??''),left=columns.get(String(marker.attrs.columnId));
  if(top===undefined||left===undefined)continue;
  const area={top,left,height:reach(rows,marker.attrs.rows,top),width:reach(columns,marker.attrs.columns,left)};
  if(area.height===1&&area.width===1||visible.some(span=>areasIntersect(span.area,area)))continue;
  visible.push({marker,area});
 }
 return visible;
}
