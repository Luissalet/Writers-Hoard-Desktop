import type {LocalToolConvergenceIdentity} from './formatTypes';
import {normalizeEditorLinkHref} from '../../../utils/normalizeEditorLinkHref';
export type RichMark='bold'|'italic'|'underline'|'strike'|'code';
export const RICH_MARKS:readonly RichMark[]=['bold','italic','underline','strike','code'];
export type RichMarkKey=RichMark|'link';
export const RICH_MARK_KEYS:readonly RichMarkKey[]=Object.freeze([...RICH_MARKS,'link']);
export type RichMarkValue={type:RichMark}|{type:'link';attrs:{href:string}};
export interface RichText {type:'text';text:string;marks?:RichMarkValue[]}
export const richHref=(value:unknown):value is string=>typeof value==='string'&&!!value&&normalizeEditorLinkHref(value)===value;
export interface RichParagraph {id:string;type:'paragraph';content:RichText[]}
export interface RichDocument {type:'doc';content:RichParagraph[]}
export interface RichSpan {buffer:string;runId:string;from:number;to:number}
export type RichRef={unit:string}|{edge:string};
export interface RichRange {
 format:'writers-hoard-rich-range/1';identity:LocalToolConvergenceIdentity;field:string;nodeId:string;
 left:string|null;right:string|null;affinity:'left'|'right';edge:string;deleteIds:string[];frontier:string[];
}
export type RichResolvedPoint={nodeId:string;offset:number;detached:false}|{detached:true};
export interface RichSlice {buffer:string;ids:string[];segment:string}
export interface RichSplitCapture {format:'writers-hoard-rich-split/1';range:RichRange;suffix:RichSlice[];edges:string[]}
export interface RichJoinCapture {format:'writers-hoard-rich-join/1';identity:LocalToolConvergenceIdentity;field:string;leftNodeId:string;rightNodeId:string;slices:RichSlice[];edges:string[];frontier:string[]}
export type RichCaptureRequest={kind:'block-empty-item';field:string;nodeId:string}|{kind:'block-split';field:string;nodeId:string;at:number}|{kind:'block-join';field:string;leftNodeId:string;rightNodeId:string}|{kind:'block-edit';field:string;nodeIds:string[];destination?:import('./blockFormat').RichBlockPlacement}|{kind:'blocks';field:string;nodeIds:string[]}|{kind:'block-move';field:string;nodeId:string;destination:import('./blockFormat').RichBlockPlacement}|{kind:'range';field:string;nodeId:string;from:number;to:number;affinity?:'left'|'right'}|{kind:'split';field:string;nodeId:string;at:number;affinity?:'left'|'right'}|{kind:'join';field:string;leftNodeId:string;rightNodeId:string};
export type RichAction=
 |{type:'rich-insert-paragraph';field:string;id:string;afterId:string|null;text:string;marks?:RichMark[];link?:{href:string}}
 |{type:'rich-delete-paragraph';field:string;id:string}
 |{type:'rich-move-paragraph';field:string;id:string;afterId:string|null}
 |{type:'rich-text-splice';field:string;nodeId:string;range:RichRange;text:string;marks?:RichMark[];link?:{href:string}}
 |{type:'rich-mark';field:string;nodeId:string;range:RichRange;mark:RichMark;enabled:boolean}
 |{type:'rich-link';field:string;nodeId:string;range:RichRange;href:string|null}
 |{type:'rich-split';field:string;capture:RichSplitCapture;newNodeId:string}
 |{type:'rich-join';field:string;capture:RichJoinCapture};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateRichDocument(value:unknown,links=false):asserts value is RichDocument {
 const fail=()=>{throw Error('local_tool_rich_state_invalid');};
 if(!obj(value)||Object.keys(value).length!==2||value.type!=='doc'||!Array.isArray(value.content))return fail();
 const ids=new Set<string>();
 for(const p of value.content){
  if(!obj(p)||Object.keys(p).length!==3||p.type!=='paragraph'||typeof p.id!=='string'||!p.id||ids.has(p.id)||!Array.isArray(p.content))return fail();ids.add(p.id);
  let previous:string|undefined;
  for(const t of p.content){
   if(!obj(t)||Object.keys(t).some(k=>!['type','text','marks'].includes(k))||t.type!=='text'||typeof t.text!=='string'||!t.text||t.marks!==undefined&&!Array.isArray(t.marks))return fail();
   const marks=(t.marks??[]) as unknown[];if(t.marks!==undefined&&!marks.length)return fail();
   const kinds:readonly string[]=links?RICH_MARK_KEYS:RICH_MARKS;
   if(marks.some((m,i)=>!obj(m)||!kinds.includes(m.type as string)||(m.type==='link'?Object.keys(m).length!==2||!obj(m.attrs)||Object.keys(m.attrs).length!==1||!richHref(m.attrs.href):Object.keys(m).length!==1)||i>0&&kinds.indexOf((marks[i-1] as {type:string}).type)>=kinds.indexOf(m.type as string)))return fail();
   const signature=JSON.stringify(marks);if(signature===previous)return fail();previous=signature;
  }
 }
}

export interface RichUnitBinding {id:string;route:string;segment:string;marks:Partial<Record<RichMarkKey,string>>}
export interface RichBindings {nodes:{id:string;placement:string;edge:string;units:RichUnitBinding[]}[]}
