import {TABLE_SCHEMA,tableKind,validateTableAttributes,validateTableLayout,type RichTableKind} from './tableFormat';
import {TABLE_AXES_SCHEMA,TABLE_WIDTHS_SCHEMA,isTableAxesSchema,isTableWidthsSchema,axisKind,validateAxisAttributes,validateTableAxesLayout,type RichTableAxisOrder} from './tableAxesFormat';
import type {LocalToolJson} from '../stateTypes';
import type {RichDocument,RichText} from './richTypes';
import {validateRichDocument} from './richTypes';
import type {LocalToolConvergenceIdentity} from './formatTypes';
import {ALIGNMENT_BLOCK_SCHEMA,CELL_IMAGE_BLOCK_SCHEMA,IMAGE_BLOCK_SCHEMA,RASTER_BLOCK_SCHEMA,TABLE_ROW_HEIGHTS_SCHEMA,isImageCellsSchema,isImageBlockSchema,isImageAlignmentSchema,isImageRasterSchema,isRichImageAlignment,isRichImageSize,validateRichImageAsset} from './imageFormat';

export const BLOCK_SCHEMA='writers-blocks/1' as const;
export type RichBlockKind='paragraph'|'heading'|'bullet-list'|'ordered-list'|'list-item'|'blockquote'|'toggle'|RichTableKind|'table-column'|'image';
export interface RichBlockPlacement {parentId:string|null;slot:'body'|'summary'|'columns';afterId:string|null}
export interface RichBlock extends RichBlockPlacement {id:string;type:RichBlockKind;attrs:Record<string,LocalToolJson>;content?:RichText[]}
/** A finite catalogue, including a finite raw image when concurrent placements cycle. */
export interface RichBlockDocument {type:'block-doc';schema:typeof BLOCK_SCHEMA|typeof TABLE_SCHEMA|typeof TABLE_AXES_SCHEMA|typeof TABLE_WIDTHS_SCHEMA|typeof IMAGE_BLOCK_SCHEMA|typeof ALIGNMENT_BLOCK_SCHEMA|typeof RASTER_BLOCK_SCHEMA|typeof CELL_IMAGE_BLOCK_SCHEMA|typeof TABLE_ROW_HEIGHTS_SCHEMA;blocks:RichBlock[];axisOrder?:RichTableAxisOrder[]}
export interface RichBlockBinding {id:string;kindVersionId:string;attrsVersionId:string;membershipVersionId:string;placementVersionId:string;imageSourceVersionId?:string;imageSizeVersionId?:string;imageAlignmentVersionId?:string;rowHeightVersionId?:string}
export interface RichBlockBindings {format:'writers-hoard-block-bindings/1';nodes:RichBlockBinding[]}
export interface RichBlockCapture {format:'writers-hoard-block-capture/1';identity:LocalToolConvergenceIdentity;field:string;nodeIds:string[];bindings:RichBlockBinding[];frontier:string[]}
export interface RichBlockMoveCapture {format:'writers-hoard-block-move/1';identity:LocalToolConvergenceIdentity;field:string;nodeId:string;destination:RichBlockPlacement;bindings:RichBlockBinding[];frontier:string[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const fail=():never=>{throw Error('local_tool_blocks_invalid');};
export const richBlockLeaf=(kind:RichBlockKind)=>kind==='paragraph'||kind==='heading';
export function validateRichBlockPlacement(v:unknown,axes=false):asserts v is RichBlockPlacement {
 if(!object(v)||Object.keys(v).length!==3||v.parentId!==null&&!id(v.parentId)||v.slot!=='body'&&v.slot!=='summary'&&(!axes||v.slot!=='columns')||v.afterId!==null&&!id(v.afterId))fail();
}
export function validateRichBlockAttributes(kind:unknown,value:unknown,tables=false,axes=false,widths=false,rowHeights=false):asserts value is Record<string,LocalToolJson> {
 if(axes&&axisKind(kind)){validateAxisAttributes(kind,value,widths,rowHeights);return;}
 if(tables&&tableKind(kind)){validateTableAttributes(kind,value);return;}
 if(!object(value))return fail();const keys=Object.keys(value);
 if(kind==='heading'){if(keys.length!==1||![1,2,3].includes(value.level as number))fail();}
 else if(kind==='ordered-list'){if(keys.length>1||keys.length===1&&(!Object.hasOwn(value,'start')||!Number.isSafeInteger(value.start)||Number(value.start)<1))fail();}
 else if(!['paragraph','bullet-list','list-item','blockquote','toggle'].includes(kind as string)||keys.length)fail();
}
export function validateRichBlockDocument(value:unknown,links=false,tables=false,axes=false,widths=false,images=false,alignment=false,rasterFormats=false,imageCells=false,rowHeights=false):asserts value is RichBlockDocument {
 const schema=rowHeights?TABLE_ROW_HEIGHTS_SCHEMA:imageCells?CELL_IMAGE_BLOCK_SCHEMA:rasterFormats?RASTER_BLOCK_SCHEMA:alignment?ALIGNMENT_BLOCK_SCHEMA:images?IMAGE_BLOCK_SCHEMA:widths?TABLE_WIDTHS_SCHEMA:axes?TABLE_AXES_SCHEMA:tables?TABLE_SCHEMA:BLOCK_SCHEMA;
 if(!object(value)||Object.keys(value).length!==(axes?4:3)||value.type!=='block-doc'||value.schema!==schema||axes&&!tables||widths&&!axes||images&&!widths||alignment&&!images||rasterFormats&&!alignment||imageCells&&!rasterFormats||rowHeights&&!imageCells||!Array.isArray(value.blocks))return fail();
 const blocks=value.blocks as RichBlock[],all=new Map<string,RichBlock>();
 for(const [at,b]of blocks.entries()){
  if(!object(b)||!id(b.id)||all.has(b.id)||Object.keys(b).length!==(richBlockLeaf(b.type)?7:6))return fail();
  if(at>0&&blocks[at-1].id>=b.id)return fail();
  if(b.type==='image'){
   if(!images||b.parentId!==null&&!imageCells||b.slot!=='body'||!object(b.attrs)||Object.keys(b.attrs).length!==(alignment?3:2)||!isRichImageSize(b.attrs.displaySize)||
      (alignment?!isRichImageAlignment(b.attrs.alignment):Object.hasOwn(b.attrs,'alignment')))return fail();
   validateRichImageAsset(b.attrs.asset,rasterFormats);
  }else validateRichBlockAttributes(b.type,b.attrs,tables,axes,widths,rowHeights);
  validateRichBlockPlacement({parentId:b.parentId,slot:b.slot,afterId:b.afterId},axes);
  if(richBlockLeaf(b.type))validateRichDocument({type:'doc',content:[{id:b.id,type:'paragraph',content:b.content}]},links);else if(Object.hasOwn(b,'content'))fail();
  all.set(b.id,b);
 }
 for(const b of blocks){
  if(b.parentId===b.id||b.afterId===b.id)return fail();const parent=b.parentId===null?undefined:all.get(b.parentId);
  if(b.parentId!==null&&!parent||parent&&(richBlockLeaf(parent.type)||parent.type==='image')||!parent&&b.slot!=='body')return fail();
  if(b.type==='image'&&parent&&parent.type!=='table-cell')return fail();
  if(parent){
   if(b.slot==='summary'&&(parent.type!=='toggle'||!richBlockLeaf(b.type)))return fail();
   if(b.slot==='body'&&(parent.type==='bullet-list'||parent.type==='ordered-list')&&b.type!=='list-item')return fail();
   if(b.type==='list-item'&&parent.type!=='bullet-list'&&parent.type!=='ordered-list')return fail();
  }else if(b.type==='list-item')return fail();
  // An anchor may have moved to another parent concurrently. Its old reference
  // remains an intent; it does not make that new parent part of this sibling chain.
  for(const edge of ['parentId','afterId'] as const){const seen=new Set<string>([b.id]);let current=b[edge];while(current!==null&&all.has(current)){const target=all.get(current)!;if(edge==='afterId'&&(target.parentId!==b.parentId||target.slot!==b.slot))break;if(seen.has(current))return fail();seen.add(current);current=target[edge];}}
 }
 for(const b of blocks)if(b.type==='toggle'&&blocks.filter(child=>child.parentId===b.id&&child.slot==='summary').length!==1)return fail();
 if(axes)validateTableAxesLayout(value as unknown as RichBlockDocument,imageCells);else if(tables)validateTableLayout(value as unknown as RichBlockDocument);
}
/** Only this catalogue's own represented leaves, never the current RichRuns projection. */
export function richBlockLeaves(value:RichBlockDocument,links=false,tables=false,axes=isTableAxesSchema(value.schema),widths=isTableWidthsSchema(value.schema),images=isImageBlockSchema(value.schema),alignment=isImageAlignmentSchema(value.schema),rasterFormats=isImageRasterSchema(value.schema),imageCells=isImageCellsSchema(value.schema),rowHeights=value.schema===TABLE_ROW_HEIGHTS_SCHEMA):RichDocument {
 validateRichBlockDocument(value,links,tables,axes,widths,images,alignment,rasterFormats,imageCells,rowHeights);return{type:'doc',content:value.blocks.filter(b=>richBlockLeaf(b.type)).map(b=>({id:b.id,type:'paragraph',content:b.content!}))};
}
