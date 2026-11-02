import type {RichBindings,RichUnitBinding} from './richRuns';
import {RICH_MARKS,validateRichDocument,type RichDocument,type RichMark,type RichSpan} from './richTypes';

export const RICH_SNAPSHOT_BINDINGS_FORMAT='writers-hoard-rich-snapshot-bindings/1' as const;
interface SnapshotSpan extends RichSpan {route:string;segment:string;marks:Partial<Record<RichMark,string>>}
interface SnapshotNode {id:string;placement:string;edge:string;spans:SnapshotSpan[]}
export interface CompactRichBindings {format:typeof RICH_SNAPSHOT_BINDINGS_FORMAT;nodes:SnapshotNode[]}
export type StoredRichBindings=RichBindings|CompactRichBindings;
export interface PreparedRichSnapshot {read:()=>RichBindings}
export type RichSnapshotSpanCheck=(span:Readonly<RichSpan>)=>void;
function fail():never {throw Error('local_tool_rich_bindings_invalid');}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function properties(v:unknown):asserts v is Record<string,unknown> {
 if(!record(v))return fail();for(const key of Reflect.ownKeys(v)){const p=Object.getOwnPropertyDescriptor(v,key)!;if(typeof key!=='string'||!('value'in p)||!p.enumerable)return fail();}
}
function shape(v:unknown,keys:readonly string[]):asserts v is Record<string,unknown> {
 properties(v);if(Reflect.ownKeys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key)))return fail();
}
function dense(v:unknown):asserts v is unknown[] {
 if(!Array.isArray(v)||Reflect.ownKeys(v).length!==v.length+1)return fail();for(let i=0;i<v.length;i++){const p=Object.getOwnPropertyDescriptor(v,String(i));if(!p||!('value'in p)||!p.enumerable)return fail();}
}
function marks(value:unknown):Partial<Record<RichMark,string>> {
 properties(value);const out:Partial<Record<RichMark,string>>={};
 for(const key of Object.keys(value))if(!RICH_MARKS.includes(key as RichMark)||!text(value[key]))return fail();
 for(const key of RICH_MARKS)if(Object.hasOwn(value,key))out[key]=value[key] as string;return out;
}
function point(id:string):{buffer:string;runId:string;offset:number} {
 let p:unknown;try{p=JSON.parse(id);}catch{return fail();}
 if(!Array.isArray(p)||p.length!==3||!text(p[0])||!text(p[1])||!Number.isSafeInteger(p[2])||p[2]<0||JSON.stringify(p)!==id)return fail();return{buffer:p[0],runId:p[1],offset:p[2]};
}
const sameRefs=(a:SnapshotSpan,b:SnapshotSpan)=>a.buffer===b.buffer&&a.runId===b.runId&&a.to===b.from&&a.route===b.route&&a.segment===b.segment&&RICH_MARKS.every(kind=>a.marks[kind]===b.marks[kind]);
function preflight(data:RichDocument,stored:unknown):{nodes:SnapshotNode[];legacy:boolean} {
 validateRichDocument(data);properties(stored);const legacy=!Object.hasOwn(stored,'format');shape(stored,legacy?['nodes']:['format','nodes']);if(!legacy&&stored.format!==RICH_SNAPSHOT_BINDINGS_FORMAT)return fail();dense(stored.nodes);
 if(stored.nodes.length!==data.content.length)return fail();const nodes:SnapshotNode[]=[],intervals=new Map<string,{from:number;to:number}[]>();let total=0;
 for(let index=0;index<stored.nodes.length;index++){
  const input=stored.nodes[index],paragraph=data.content[index];shape(input,legacy?['id','placement','edge','units']:['id','placement','edge','spans']);if(input.id!==paragraph.id||!text(input.placement)||!text(input.edge))return fail();
  let expected=0;for(const run of paragraph.content){if(run.text.length>Number.MAX_SAFE_INTEGER-expected)return fail();expected+=run.text.length;}if(expected>Number.MAX_SAFE_INTEGER-total)return fail();total+=expected;
  const spans:SnapshotSpan[]=[];let count=0;
  if(legacy){
   dense(input.units);if(input.units.length!==expected)return fail();
   for(const unit of input.units){shape(unit,['id','route','segment','marks']);if(!text(unit.id)||!text(unit.route)||!text(unit.segment))return fail();const p=point(unit.id);if(p.offset===Number.MAX_SAFE_INTEGER)return fail();const span:SnapshotSpan={buffer:p.buffer,runId:p.runId,from:p.offset,to:p.offset+1,route:unit.route,segment:unit.segment,marks:marks(unit.marks)},last=spans.at(-1);if(last&&sameRefs(last,span))last.to=span.to;else spans.push(span);}
  }else{
   dense(input.spans);
   for(const span of input.spans){shape(span,['buffer','runId','from','to','route','segment','marks']);if(!text(span.buffer)||!text(span.runId)||!text(span.route)||!text(span.segment)||!Number.isSafeInteger(span.from)||!Number.isSafeInteger(span.to)||(span.from as number)<0||(span.to as number)<=(span.from as number))return fail();const length=(span.to as number)-(span.from as number);if(length>expected-count)return fail();count+=length;spans.push({buffer:span.buffer,runId:span.runId,from:span.from as number,to:span.to as number,route:span.route,segment:span.segment,marks:marks(span.marks)});}
   if(count!==expected)return fail();
  }
  for(const span of spans){const key=JSON.stringify([span.buffer,span.runId]),list=intervals.get(key)??[];list.push({from:span.from,to:span.to});intervals.set(key,list);}
  nodes.push({id:paragraph.id,placement:input.placement,edge:input.edge,spans});
 }
 // Only validation copies are sorted; logical nodes/spans never change order.
 for(const list of intervals.values()){const sorted=[...list].sort((a,b)=>a.from-b.from);for(let i=1;i<sorted.length;i++)if(sorted[i].from<sorted[i-1].to)return fail();}
 return{nodes,legacy};
}
/** Preflight every node/span before any per-unit expansion, also across fields in callers. */
export function prepareRichSnapshotBindings(data:RichDocument,stored:unknown,checkSpan?:RichSnapshotSpanCheck):PreparedRichSnapshot {
 const prepared=preflight(data,stored);
 for(const node of prepared.nodes)for(const span of node.spans)checkSpan?.(Object.freeze({buffer:span.buffer,runId:span.runId,from:span.from,to:span.to}));
 return{read:()=>{
  if(prepared.legacy)return stored as RichBindings;
  return{nodes:prepared.nodes.map(node=>{const units:RichUnitBinding[]=[];for(const span of node.spans)for(let offset=span.from;offset<span.to;offset++)units.push({id:JSON.stringify([span.buffer,span.runId,offset]),route:span.route,segment:span.segment,marks:{...span.marks}});return{id:node.id,placement:node.placement,edge:node.edge,units};})};
 }};
}
/** A failed field exposes no handles; callers cannot expand a valid prefix of a bad snapshot. */
export function prepareRichSnapshotBatch<T>(values:readonly T[],prepare:(value:T)=>PreparedRichSnapshot|null):{value:T;prepared:PreparedRichSnapshot}[] {
 const results:{value:T;prepared:PreparedRichSnapshot}[]=[];let failed=false;
 for(const value of values){const prepared=prepare(value);if(prepared)results.push({value,prepared});else failed=true;}
 return failed?[]:results;
}
export function decodeRichSnapshotBindings(data:RichDocument,stored:unknown,checkSpan?:RichSnapshotSpanCheck):RichBindings {return prepareRichSnapshotBindings(data,stored,checkSpan).read();}
/** Lossless storage only; no document, registry, writer, identity or migration. */
export function encodeRichSnapshotBindings(data:RichDocument,bindings:RichBindings):CompactRichBindings {return{format:RICH_SNAPSHOT_BINDINGS_FORMAT,nodes:preflight(data,bindings).nodes};}
