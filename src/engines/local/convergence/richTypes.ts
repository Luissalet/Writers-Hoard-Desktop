import type {LocalToolConvergenceIdentity} from './types';
export type RichMark='bold'|'italic'|'underline'|'strike'|'code';
export const RICH_MARKS:readonly RichMark[]=['bold','italic','underline','strike','code'];
export interface RichText {type:'text';text:string;marks?:{type:RichMark}[]}
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
export type RichCaptureRequest={kind:'block-empty-item';field:string;nodeId:string}|{kind:'block-split';field:string;nodeId:string;at:number}|{kind:'block-join';field:string;leftNodeId:string;rightNodeId:string}|{kind:'block-edit';field:string;nodeIds:string[];destination?:import('./blockTypes').RichBlockPlacement}|{kind:'blocks';field:string;nodeIds:string[]}|{kind:'block-move';field:string;nodeId:string;destination:import('./blockTypes').RichBlockPlacement}|{kind:'range';field:string;nodeId:string;from:number;to:number;affinity?:'left'|'right'}|{kind:'split';field:string;nodeId:string;at:number;affinity?:'left'|'right'}|{kind:'join';field:string;leftNodeId:string;rightNodeId:string};
export type RichAction=
 |{type:'rich-insert-paragraph';field:string;id:string;afterId:string|null;text:string;marks?:RichMark[]}
 |{type:'rich-delete-paragraph';field:string;id:string}
 |{type:'rich-move-paragraph';field:string;id:string;afterId:string|null}
 |{type:'rich-text-splice';field:string;nodeId:string;range:RichRange;text:string;marks?:RichMark[]}
 |{type:'rich-mark';field:string;nodeId:string;range:RichRange;mark:RichMark;enabled:boolean}
 |{type:'rich-split';field:string;capture:RichSplitCapture;newNodeId:string}
 |{type:'rich-join';field:string;capture:RichJoinCapture};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateRichDocument(value:unknown):asserts value is RichDocument {
 const fail=()=>{throw Error('local_tool_rich_state_invalid');};
 if(!obj(value)||Object.keys(value).length!==2||value.type!=='doc'||!Array.isArray(value.content))return fail();
 const ids=new Set<string>();
 for(const p of value.content){
  if(!obj(p)||Object.keys(p).length!==3||p.type!=='paragraph'||typeof p.id!=='string'||!p.id||ids.has(p.id)||!Array.isArray(p.content))return fail();ids.add(p.id);
  let previous:string|undefined;
  for(const t of p.content){
   if(!obj(t)||Object.keys(t).some(k=>!['type','text','marks'].includes(k))||t.type!=='text'||typeof t.text!=='string'||!t.text||t.marks!==undefined&&!Array.isArray(t.marks))return fail();
   const marks=(t.marks??[]) as unknown[];if(t.marks!==undefined&&!marks.length)return fail();
   if(marks.some((m,i)=>!obj(m)||Object.keys(m).length!==1||!RICH_MARKS.includes(m.type as RichMark)||i>0&&RICH_MARKS.indexOf((marks[i-1] as {type:RichMark}).type)>=RICH_MARKS.indexOf(m.type as RichMark)))return fail();
   const signature=JSON.stringify(marks);if(signature===previous)return fail();previous=signature;
  }
 }
}
