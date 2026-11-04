import type {RichBlock,RichBlockDocument} from './blockFormat';
import type {RichBlockEditCapture} from './blockEditingTypes';
import type {RichTableAxisOrder} from './tableAxesFormat';
import {convergenceCanonical} from './format';
import {validateRichDocument,type RichText} from './richTypes';
import {isRichImageAlignment,isRichImageSize,validateRichImageAsset,type RichImageAlignment,type RichImageAsset,type RichImageSize} from './imageFormat';
import {areaContains,areasIntersect,tableSpans,type TableArea} from './tableSpanGeometry';

type Cell=readonly [rowId:string,columnId:string];
export type RichTablePasteImage={afterParagraph:number;asset:RichImageAsset;displaySize:RichImageSize;alignment:RichImageAlignment};
export type RichTablePasteCell={header:boolean;paragraphs:RichText[][];images?:RichTablePasteImage[];span?:{rows:number;columns:number}};
export type RichTablePasteMatrix=(RichTablePasteCell|null)[][];
export type RichTablePasteTarget={rows:string[];columns:string[];anchor:Cell;head?:Cell};
export type RichTablePasteAction={type:'rich-table-paste';field:string;capture:RichBlockEditCapture;target:RichTablePasteTarget;matrix:RichTablePasteMatrix};

const invalid=():never=>{throw Error('local_tool_table_paste_invalid');};
export function tablePasteArea(order:RichTableAxisOrder,target:RichTablePasteTarget,matrix:RichTablePasteMatrix,links:boolean,spanData?:RichBlockDocument):TableArea{
 if(!target||Object.keys(target).length!==(target.head===undefined?3:4)||
    convergenceCanonical(target.rows)!==convergenceCanonical(order.rows)||
    convergenceCanonical(target.columns)!==convergenceCanonical(order.columns)||
    !Array.isArray(matrix)||!matrix.length||!Array.isArray(matrix[0])||!matrix[0].length)return invalid();
 const width=matrix[0].length,covered=new Set<number>();
 let hasSpans=false;
 for(const [y,row] of matrix.entries()){
  if(!Array.isArray(row)||row.length!==width)return invalid();
  for(const [x,cell] of row.entries()){
   if(covered.has(y*width+x)){if(cell!==null)return invalid();continue;}
   if(!cell||Object.keys(cell).length!==2+Number(cell.images!==undefined)+Number(cell.span!==undefined)||typeof cell.header!=='boolean'||!Array.isArray(cell.paragraphs))return invalid();
   if(cell.span!==undefined){
    const span=cell.span;
    if(!spanData||!span||Object.keys(span).length!==2||!Number.isSafeInteger(span.rows)||!Number.isSafeInteger(span.columns)||
       span.rows<1||span.columns<1||span.rows===1&&span.columns===1||span.rows>matrix.length-y||span.columns>width-x)return invalid();
    hasSpans=true;
    for(let r=y;r<y+span.rows;r++)for(let c=x;c<x+span.columns;c++){
     if(r===y&&c===x)continue;
     const position=r*width+c;
     if(covered.has(position))return invalid();
     covered.add(position);
    }
   }
   validateRichDocument({type:'doc',content:cell.paragraphs.map((content,i)=>({type:'paragraph',id:String(i),content}))},links);
   if(cell.images!==undefined){
    if(!Array.isArray(cell.images)||!cell.images.length)return invalid();
    let previous=-1;
    for(const image of cell.images){
     if(!image||Object.keys(image).length!==4||!Number.isSafeInteger(image.afterParagraph)||image.afterParagraph<previous||
        image.afterParagraph>=cell.paragraphs.length||!isRichImageSize(image.displaySize)||!isRichImageAlignment(image.alignment))return invalid();
     validateRichImageAsset(image.asset,true);previous=image.afterParagraph;
    }
   }
  }
 }
 const point=(cell:Cell)=>{
  if(!Array.isArray(cell)||cell.length!==2)return invalid();
  const y=order.rows.indexOf(cell[0]),x=order.columns.indexOf(cell[1]);
  if(y<0||x<0)return invalid();
  return {y,x};
 };
 const anchor=point(target.anchor);
 const spans=spanData?tableSpans(order,spanData.blocks):[];
 if(target.head===undefined){
  const area={top:anchor.y,left:anchor.x,height:matrix.length,width};
  if(hasSpans||spans.some(span=>areasIntersect(area,span.area)&&!areaContains(area,span.area)))return invalid();
  return area;
 }
 const head=point(target.head);
 let area={top:Math.min(anchor.y,head.y),left:Math.min(anchor.x,head.x),height:Math.abs(anchor.y-head.y)+1,width:Math.abs(anchor.x-head.x)+1};
 for(let span=spans.find(item=>areasIntersect(area,item.area)&&!areaContains(area,item.area));span;span=spans.find(item=>areasIntersect(area,item.area)&&!areaContains(area,item.area))){
  const top=Math.min(area.top,span.area.top),left=Math.min(area.left,span.area.left);
  area={top,left,height:Math.max(area.top+area.height,span.area.top+span.area.height)-top,width:Math.max(area.left+area.width,span.area.left+span.area.width)-left};
 }
 if(hasSpans&&(area.height%matrix.length||area.width%width))return invalid();
 return area;
}

/** All represented cell contents and presentation in the portion that already exists. */
export function tablePasteContents(data:RichBlockDocument,order:RichTableAxisOrder,area:ReturnType<typeof tablePasteArea>):RichBlock[]{
 const rows=new Set(order.rows.slice(area.top,area.top+area.height)),columns=new Set(order.columns.slice(area.left,area.left+area.width));
 const byParent=new Map<string,RichBlock[]>(),result:RichBlock[]=[];
 for(const block of data.blocks)if(block.parentId!==null){
  const siblings=byParent.get(block.parentId)??[];siblings.push(block);byParent.set(block.parentId,siblings);
 }
 for(const row of rows)for(const block of byParent.get(row)??[])if(columns.has(String(block.attrs.columnId)))result.push(block);
 for(let at=0;at<result.length;at++)result.push(...(byParent.get(result[at].id)??[]));
 return result.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
