import type {LocalToolJson} from '../stateTypes';
import type {RichDocument,RichText} from './richTypes';
import {validateRichDocument} from './richTypes';
import type {LocalToolConvergenceIdentity} from './types';

export const BLOCK_SCHEMA='writers-blocks/1' as const;
export type RichBlockKind='paragraph'|'heading'|'bullet-list'|'ordered-list'|'list-item'|'blockquote'|'toggle';
export interface RichBlockPlacement {parentId:string|null;slot:'body'|'summary';afterId:string|null}
export interface RichBlock extends RichBlockPlacement {id:string;type:RichBlockKind;attrs:Record<string,LocalToolJson>;content?:RichText[]}
/** A finite catalogue, including a finite raw image when concurrent placements cycle. */
export interface RichBlockDocument {type:'block-doc';schema:typeof BLOCK_SCHEMA;blocks:RichBlock[]}
export interface RichBlockBinding {id:string;kindVersionId:string;attrsVersionId:string;membershipVersionId:string;placementVersionId:string}
export interface RichBlockBindings {format:'writers-hoard-block-bindings/1';nodes:RichBlockBinding[]}
export interface RichBlockCapture {format:'writers-hoard-block-capture/1';identity:LocalToolConvergenceIdentity;field:string;nodeIds:string[];bindings:RichBlockBinding[];frontier:string[]}
export interface RichBlockMoveCapture {format:'writers-hoard-block-move/1';identity:LocalToolConvergenceIdentity;field:string;nodeId:string;destination:RichBlockPlacement;bindings:RichBlockBinding[];frontier:string[]}
export type RichBlockAction=import('./blockText').RichBlockTextAction|RichBlockCoreAction|import('./blockEditingTypes').RichBlockEditingAction;
export type RichBlockCoreAction=
 |{type:'rich-block-wrap';field:string;capture:RichBlockCapture;wrapper:{id:string;type:'bullet-list'|'ordered-list';attrs:Record<string,LocalToolJson>};items:{id:string;leafId:string}[]}
 |{type:'rich-block-move';field:string;capture:RichBlockMoveCapture};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const fail=():never=>{throw Error('local_tool_blocks_invalid');};
export const richBlockLeaf=(kind:RichBlockKind)=>kind==='paragraph'||kind==='heading';
export function validateRichBlockPlacement(v:unknown):asserts v is RichBlockPlacement {
 if(!object(v)||Object.keys(v).length!==3||v.parentId!==null&&!id(v.parentId)||!['body','summary'].includes(v.slot as string)||v.afterId!==null&&!id(v.afterId))fail();
}
function attributes(kind:unknown,value:unknown):asserts value is Record<string,LocalToolJson> {
 if(!object(value))return fail();const keys=Object.keys(value);
 if(kind==='heading'){if(keys.length!==1||![1,2,3].includes(value.level as number))fail();}
 else if(kind==='ordered-list'){if(keys.length>1||keys.length===1&&(!Object.hasOwn(value,'start')||!Number.isSafeInteger(value.start)||Number(value.start)<1))fail();}
 else if(!['paragraph','bullet-list','list-item','blockquote','toggle'].includes(kind as string)||keys.length)fail();
}
export function validateRichBlockDocument(value:unknown):asserts value is RichBlockDocument {
 if(!object(value)||Object.keys(value).length!==3||value.type!=='block-doc'||value.schema!==BLOCK_SCHEMA||!Array.isArray(value.blocks))return fail();
 const blocks=value.blocks as RichBlock[],all=new Map<string,RichBlock>();
 for(const [at,b]of blocks.entries()){
  if(!object(b)||!id(b.id)||all.has(b.id)||Object.keys(b).length!==(richBlockLeaf(b.type)?7:6))return fail();
  if(at>0&&blocks[at-1].id>=b.id)return fail();
  attributes(b.type,b.attrs);validateRichBlockPlacement({parentId:b.parentId,slot:b.slot,afterId:b.afterId});
  if(richBlockLeaf(b.type))validateRichDocument({type:'doc',content:[{id:b.id,type:'paragraph',content:b.content}]});else if(Object.hasOwn(b,'content'))fail();
  all.set(b.id,b);
 }
 for(const b of blocks){
  if(b.parentId===b.id||b.afterId===b.id)return fail();const parent=b.parentId===null?undefined:all.get(b.parentId);
  if(b.parentId!==null&&!parent||parent&&richBlockLeaf(parent.type)||!parent&&b.slot!=='body')return fail();
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
}
/** Only this catalogue's own represented leaves, never the current RichRuns projection. */
export function richBlockLeaves(value:RichBlockDocument):RichDocument {
 validateRichBlockDocument(value);return{type:'doc',content:value.blocks.filter(b=>richBlockLeaf(b.type)).map(b=>({id:b.id,type:'paragraph',content:b.content!}))};
}
