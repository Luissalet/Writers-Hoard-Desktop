import type {RichBlock,RichBlockDocument} from './blockFormat';
import type {RichBlockEditCapture} from './blockEditingTypes';
import type {RichTableAxisOrder} from './tableAxesFormat';
import {convergenceCanonical} from './format';
import {validateRichDocument,type RichText} from './richTypes';
import {isRichImageAlignment,isRichImageSize,validateRichImageAsset,type RichImageAlignment,type RichImageAsset,type RichImageSize} from './imageFormat';

type Cell=readonly [rowId:string,columnId:string];
export type RichTablePasteImage={afterParagraph:number;asset:RichImageAsset;displaySize:RichImageSize;alignment:RichImageAlignment};
export type RichTablePasteCell={header:boolean;paragraphs:RichText[][];images?:RichTablePasteImage[]};
export type RichTablePasteTarget={rows:string[];columns:string[];anchor:Cell;head?:Cell};
export type RichTablePasteAction={type:'rich-table-paste';field:string;capture:RichBlockEditCapture;target:RichTablePasteTarget;matrix:RichTablePasteCell[][]};

const invalid=():never=>{throw Error('local_tool_table_paste_invalid');};
export function tablePasteArea(order:RichTableAxisOrder,target:RichTablePasteTarget,matrix:RichTablePasteCell[][],links:boolean){
 if(!target||Object.keys(target).length!==(target.head===undefined?3:4)||
    convergenceCanonical(target.rows)!==convergenceCanonical(order.rows)||
    convergenceCanonical(target.columns)!==convergenceCanonical(order.columns)||
    !Array.isArray(matrix)||!matrix.length||!Array.isArray(matrix[0])||!matrix[0].length)return invalid();
 const width=matrix[0].length;
 for(const row of matrix){
  if(!Array.isArray(row)||row.length!==width)return invalid();
  for(const cell of row){
   if(!cell||Object.keys(cell).length!==(cell.images===undefined?2:3)||typeof cell.header!=='boolean'||!Array.isArray(cell.paragraphs))return invalid();
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
 if(target.head===undefined)return {top:anchor.y,left:anchor.x,height:matrix.length,width};
 const head=point(target.head);
 return {top:Math.min(anchor.y,head.y),left:Math.min(anchor.x,head.x),height:Math.abs(anchor.y-head.y)+1,width:Math.abs(anchor.x-head.x)+1};
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
