import * as Y from 'yjs';
import {convergenceBase64,convergenceBytes,convergenceClone} from './format';
import {JsonArray,JsonMap,Registers,type RegisterVersion} from './registers';
import type {LocalToolPlainRange} from './types';

export interface PlainSpan {runId:string;from:number;to:number}
interface Run {id:string;length:number;bytes:string;txId:string}
interface Placement {runId:string;after:string|null;txId:string}
interface PointLookup {get:(runId:string)=>Run|undefined;placements:Map<string,Placement>;reachable:Map<string,boolean>}
interface NewRun {id:string;length:number;bytes:string;after:string|null}
interface Visibility extends PlainSpan {visible:boolean}
interface PreparedVisibility extends Visibility {key:string}
export interface PlainView {text:string;bindings:PlainSpan[]}
export interface PlainPlan {runs:NewRun[];spans:PreparedVisibility[];view:PlainView;changed:boolean}
const fail=():never=>{throw Error('local_tool_plain_range_invalid');};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unit=(runId:string,offset:number)=>JSON.stringify([runId,offset]);
const lastMatching=<T>(values:readonly T[],predicate:(value:T)=>boolean):T|undefined=>{for(let i=values.length-1;i>=0;i--)if(predicate(values[i]))return values[i];return undefined;};
function point(id:string):{runId:string;offset:number}{
 let value:unknown;try{value=JSON.parse(id);}catch{return fail();}
 if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!value[0]||!Number.isSafeInteger(value[1])||value[1]<0||unit(value[0],value[1])!==id)return fail();
 return{runId:value[0],offset:value[1]};
}
function encode(text:string):string{
 const bytes=new Uint8Array(text.length*2);for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);bytes[i*2]=code&255;bytes[i*2+1]=code>>>8;}return convergenceBase64(bytes);
}
function decode(run:Pick<Run,'bytes'|'length'>):Uint16Array{
 const bytes=convergenceBytes(run.bytes);if(bytes.length!==run.length*2)return fail();const values=new Uint16Array(run.length);
 for(let i=0;i<values.length;i++)values[i]=bytes[i*2]|bytes[i*2+1]<<8;return values;
}
const string=(values:number[])=>{let text='';for(let i=0;i<values.length;i+=8192)text+=String.fromCharCode(...values.slice(i,i+8192));return text;};
function addSpan(spans:PlainSpan[],runId:string,offset:number){const last=spans.at(-1);if(last?.runId===runId&&last.to===offset)last.to++;else spans.push({runId,from:offset,to:offset+1});}
function bounds(spans:readonly PlainSpan[],from:number,to:number):PlainSpan[]{
 const result:PlainSpan[]=[];let cursor=0;
 for(const span of spans){const length=span.to-span.from,start=Math.max(0,from-cursor),end=Math.min(length,to-cursor);if(start<end)result.push({runId:span.runId,from:span.from+start,to:span.from+end});cursor+=length;}
 return result;
}
function normalize(values:readonly Visibility[]):PreparedVisibility[]{
 const groups=new Map<string,Visibility[]>();for(const value of values){const list=groups.get(value.runId)??[];list.push(value);groups.set(value.runId,list);}
 const result:PreparedVisibility[]=[];
 for(const[runId,list]of groups){
  // Numeric interval boundaries do not reorder logical characters or transaction IDs.
  const edges=[...new Set(list.flatMap(value=>[value.from,value.to]))].sort((a,b)=>a-b);
  for(let i=0;i+1<edges.length;i++){const from=edges[i],to=edges[i+1],last=lastMatching(list,value=>value.from<=from&&value.to>=to);if(!last)continue;
   const previous=result.at(-1);if(previous?.runId===runId&&previous.to===from&&previous.visible===last.visible)previous.to=to;
   else result.push({runId,from,to,visible:last.visible,key:crypto.randomUUID()});
  }
 }
 return result;
}

/** One field in the existing Y.Doc and Registers; no independent causal engine or writer. */
export class PlainRuns {
 readonly content:JsonMap<Run>;
 readonly order:JsonArray<Placement>;
 readonly root:string;
 readonly doc:Y.Doc;
 readonly field:string;
 readonly registers:Registers;
 constructor(doc:Y.Doc,field:string,registers:Registers){
  this.doc=doc;this.field=field;this.registers=registers;
  const name=JSON.stringify(field);this.root='plain-membership:'+name;this.content=new JsonMap<Run>(doc.getMap('plain-content:'+name));this.order=new JsonArray<Placement>(doc.getArray('plain-order:'+name));
 }
 private available(run:Run|undefined):run is Run{return !!run&&this.registers.transactionAvailable(run.txId);}
 private pointLookup():PointLookup{
  const runs=new Map<string,Run|undefined>();
  return{get:(runId:string)=>{if(!runs.has(runId)){const run=this.content.get(runId);runs.set(runId,this.available(run)?run:undefined);}return runs.get(runId);},placements:new Map(this.order.toArray().map(place=>[place.runId,place])),reachable:new Map()};
 }
 private reachable(runId:string,lookup=this.pointLookup()):boolean{
  const seen=new Set<string>(),path:string[]=[];let id=runId,result=false;
  for(;;){const cached=lookup.reachable.get(id);if(cached!==undefined){result=cached;break;}if(seen.has(id))throw Error('local_tool_plain_anchor_cycle');seen.add(id);path.push(id);
   const run=lookup.get(id),place=lookup.placements.get(id);if(!run||!place||!this.registers.transactionAvailable(place.txId))break;if(place.after===null){result=true;break;}
   const parent=point(place.after),content=lookup.get(parent.runId);if(!content||parent.offset>=content.length)break;id=parent.runId;
  }
  for(const visited of path)lookup.reachable.set(visited,result);return result;
 }
 private known(id:string,lookup=this.pointLookup()):{runId:string;offset:number}{const value=point(id),run=lookup.get(value.runId);if(!run||value.offset>=run.length||!this.reachable(run.id,lookup))return fail();return value;}
 private visibility(version:RegisterVersion):Visibility{
  const value=version.value;if(!version.present||!object(value)||typeof value.runId!=='string'||!Number.isSafeInteger(value.from)||!Number.isSafeInteger(value.to)||Number(value.from)<0||Number(value.from)>=Number(value.to)||typeof value.visible!=='boolean')return fail();
  return value as unknown as Visibility;
 }
 private records(extra:readonly NewRun[]=[]){
  const runs=new Map([...this.content]),placements=this.order.toArray();
  for(const run of extra){runs.set(run.id,{id:run.id,length:run.length,bytes:run.bytes,txId:'@prepared'});const at=run.after===null?-1:placements.findIndex(place=>place.runId===point(run.after!).runId);if(run.after!==null&&at<0)return fail();placements.splice(at+1,0,{runId:run.id,after:run.after,txId:'@prepared'});}
  return{runs,placements};
 }
 private segments(runId:string,length:number,base:readonly PlainSpan[]|undefined,intents:readonly Visibility[]):Visibility[]{
  const candidates=base===undefined?this.registers.candidates(this.root).map(version=>({version,span:this.visibility(version)})).filter(value=>value.span.runId===runId):[];
  const own=intents.filter(value=>value.runId===runId),admitted=base?.filter(value=>value.runId===runId)??[];
  const edges=[...new Set([0,length,...candidates.flatMap(value=>[value.span.from,value.span.to]),...own.flatMap(value=>[value.from,value.to]),...admitted.flatMap(value=>[value.from,value.to])])].sort((a,b)=>a-b),result:Visibility[]=[];
  for(let i=0;i+1<edges.length;i++){const from=edges[i],to=edges[i+1];if(from<0||to>length)return fail();const staged=lastMatching(own,value=>value.from<=from&&value.to>=to);
   const winner=staged?undefined:this.registers.maximumCandidate(candidates.filter(value=>value.span.from<=from&&value.span.to>=to).map(value=>value.version));
   const visible=staged?.visible??(base===undefined?(winner?this.visibility(winner).visible:false):admitted.some(value=>value.from<=from&&value.to>=to));
   result.push({runId,from,to,visible});
  }
  return result;
 }
 materialize(base?:readonly PlainSpan[],extra:readonly NewRun[]=[],intents:readonly Visibility[]=[]):PlainView{
  const{runs,placements}=this.records(extra),newIds=new Set(extra.map(value=>value.id)),children=new Map<string|null,string[]>(),byRun=new Map<string,Placement>();
  for(const place of placements){if(byRun.has(place.runId))return fail();byRun.set(place.runId,place);const run=runs.get(place.runId);if(!run||!newIds.has(run.id)&&(!this.available(run)||!this.registers.transactionAvailable(place.txId)))continue;
   if(place.after!==null){const anchor=point(place.after),parent=runs.get(anchor.runId);if(!parent||anchor.offset>=parent.length||!newIds.has(parent.id)&&!this.available(parent))continue;}
   const list=children.get(place.after)??[];list.push(run.id);children.set(place.after,list);
  }
  const values:number[]=[],bindings:PlainSpan[]=[],decoded=new Map<string,Uint16Array>(),segments=new Map<string,Visibility[]>(),positions=new Map<string,number>();
  const stack=(children.get(null)??[]).slice().reverse().map(runId=>({runId,offset:0}));
  while(stack.length){const frame=stack.pop()!,run=runs.get(frame.runId)!;if(frame.offset>=run.length)continue;
   let units=decoded.get(run.id);if(!units){units=decode(run);decoded.set(run.id,units);segments.set(run.id,this.segments(run.id,run.length,base,intents));positions.set(run.id,0);}
   const spans=segments.get(run.id)!;let at=positions.get(run.id)!;while(at+1<spans.length&&spans[at].to<=frame.offset)at++;positions.set(run.id,at);
   if(spans[at]?.visible){values.push(units[frame.offset]);addSpan(bindings,run.id,frame.offset);}
   stack.push({runId:run.id,offset:frame.offset+1});for(const child of (children.get(unit(run.id,frame.offset))??[]).slice().reverse())stack.push({runId:child,offset:0});
  }
  return{text:string(values),bindings};
 }
 validate():void{
  const seen=new Set<string>(),places=new Map<string,Placement>();
  for(const[key,run]of this.content){if(!run||run.id!==key||!run.id||!Number.isSafeInteger(run.length)||run.length<=0||typeof run.bytes!=='string'||typeof run.txId!=='string')return fail();decode(run);}
  for(const place of this.order.toArray()){if(!place||typeof place.runId!=='string'||typeof place.txId!=='string'||place.after!==null&&typeof place.after!=='string'||places.has(place.runId))return fail();if(place.after!==null)point(place.after);places.set(place.runId,place);}
  for(const place of places.values()){
   const path=new Set<string>();let current:Placement|undefined=place;
   while(current){if(path.has(current.runId))throw Error('local_tool_plain_anchor_cycle');if(seen.has(current.runId))break;path.add(current.runId);current=current.after===null?undefined:places.get(point(current.after).runId);}
   for(const id of path)seen.add(id);
  }
  for(const version of this.registers.entries(this.root)){const span=this.visibility(version),run=this.content.get(span.runId);if(run&&span.to>run.length)return fail();}
 }
 pending():boolean{
  const placements=this.order.toArray(),known=new Map(placements.map(value=>[value.runId,value]));
  for(const[id,run]of this.content)if(!this.available(run)||!known.has(id))return true;
  for(const place of placements){if(!this.available(this.content.get(place.runId))||!this.registers.transactionAvailable(place.txId))return true;if(place.after!==null){const anchor=point(place.after),run=this.content.get(anchor.runId);if(!this.available(run)||anchor.offset>=run.length)return true;}}
  return this.registers.entries(this.root).some(version=>!this.content.has(this.visibility(version).runId));
 }
 checkBindings(view:PlainView):void{this.bindingValidator()(view);}
 /** One immutable synchronous scan only. Never retain across document mutations. */
 bindingValidator():(view:PlainView)=>void{
  let lookup:PointLookup|undefined;const decoded=new Map<string,string>();
  const text=(run:Run):string=>{
   const cached=decoded.get(run.id);if(cached!==undefined)return cached;
   const units=decode(run);let value='';
   for(let i=0;i<units.length;i+=8192)value+=String.fromCharCode(...units.subarray(i,i+8192));
   decoded.set(run.id,value);return value;
  };
  return view=>{
   if(!Array.isArray(view.bindings)||typeof view.text!=='string')return fail();const parts:string[]=[],seen=new Map<string,PlainSpan[]>();
   for(const span of view.bindings){
    if(!span||typeof span.runId!=='string'||!Number.isSafeInteger(span.from)||!Number.isSafeInteger(span.to)||span.from<0||span.from>=span.to)return fail();
    const current=lookup??=this.pointLookup(),run=current.get(span.runId);if(!run||span.to>run.length||!this.reachable(run.id,current))return fail();
    const previous=seen.get(run.id)??[];if(previous.some(old=>span.from<old.to&&span.to>old.from))return fail();
    previous.push(span);seen.set(run.id,previous);parts.push(text(run).slice(span.from,span.to));
   }
   if(parts.join('')!==view.text)return fail();
  };
 }
 range(view:PlainView,from:number,to:number):Pick<LocalToolPlainRange,'afterPlacementId'|'deleteIds'>{
  this.checkBindings(view);if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from>to||to>view.text.length)return fail();
  const before=from?bounds(view.bindings,from-1,from)[0]:undefined,selection=bounds(view.bindings,from,to),deleteIds:string[]=[];
  for(const span of selection)for(let i=span.from;i<span.to;i++)deleteIds.push(unit(span.runId,i));
  return{afterPlacementId:before?unit(before.runId,before.from):null,deleteIds};
 }
 draft(view:PlainView):PlainDraft{this.checkBindings(view);return new PlainDraft(this,view);}
 commit(plan:PlainPlan):void{
  const txId=this.registers.currentTransactionId();
  for(const run of plan.runs){if(this.content.has(run.id))return fail();this.content.set(run.id,{id:run.id,length:run.length,bytes:run.bytes,txId});const at=run.after===null?-1:this.order.toArray().findIndex(place=>place.runId===point(run.after!).runId);if(run.after!==null&&at<0)return fail();this.order.insert(at+1,[{runId:run.id,after:run.after,txId}]);}
  for(const span of plan.spans)this.registers.write(this.root,span.key,true,{runId:span.runId,from:span.from,to:span.to,visible:span.visible});
 }
 /** Baseline planning only: public range identities must already exist, never allocate from offsets on receive. */
 assertPoint(id:string):void{this.known(id);}
 /** One lazy lookup for an immutable preparation; never retain it on the Y.Doc or across commits. */
 pointValidator():(id:string)=>{runId:string;offset:number}{let lookup:PointLookup|undefined;return id=>this.known(id,lookup??=this.pointLookup());}
 allSpans(extra:readonly NewRun[]=[]):PlainSpan[]{return[...[...this.content].map(([runId,run])=>({runId,from:0,to:run.length})),...extra.map(run=>({runId:run.id,from:0,to:run.length}))];}
}

/** Disposable preparation overlay, not a second Y.Doc or durable state. */
export class PlainDraft {
 private readonly runs:NewRun[]=[];
 private readonly intents:Visibility[]=[];
 private readonly readPoint:(id:string)=>{runId:string;offset:number};
 readonly source:PlainRuns;
 readonly baseline:PlainView;
 constructor(source:PlainRuns,baseline:PlainView){this.source=source;this.baseline=baseline;this.readPoint=source.pointValidator();}
 view():PlainView{return this.source.materialize(this.baseline.bindings,this.runs,this.intents);}
 private insert(after:string|null,text:string){if(!text.length)return;const id=crypto.randomUUID();this.runs.push({id,length:text.length,bytes:encode(text),after});this.intents.push({runId:id,from:0,to:text.length,visible:true});}
 splice(range:Pick<LocalToolPlainRange,'afterPlacementId'|'deleteIds'>,text:string):void{
  if(range.afterPlacementId!==null)this.readPoint(range.afterPlacementId);const seen=new Set<string>();
  for(const id of range.deleteIds){if(seen.has(id))return fail();seen.add(id);const value=this.readPoint(id),previous=this.intents.at(-1);
   // Compress adjacent captured units, preserving wire order, validation and contribution ownership.
   if(previous?.runId===value.runId&&!previous.visible&&previous.to===value.offset)previous.to++;else this.intents.push({runId:value.runId,from:value.offset,to:value.offset+1,visible:false});
  }
  this.insert(range.afterPlacementId,text);
 }
 replace(text:string):void{
  const before=this.view();if(before.text===text)return;let prefix=0,suffix=0;while(prefix<Math.min(before.text.length,text.length)&&before.text.charCodeAt(prefix)===text.charCodeAt(prefix))prefix++;
  while(suffix<Math.min(before.text.length-prefix,text.length-prefix)&&before.text.charCodeAt(before.text.length-1-suffix)===text.charCodeAt(text.length-1-suffix))suffix++;
  const keep=[...bounds(before.bindings,0,prefix),...bounds(before.bindings,before.text.length-suffix,before.text.length)];
  for(const span of this.source.allSpans(this.runs))this.intents.push({...span,visible:false});for(const span of keep)this.intents.push({...span,visible:true});
  const left=prefix?bounds(before.bindings,prefix-1,prefix)[0]:undefined;this.insert(left?unit(left.runId,left.from):null,text.slice(prefix,text.length-suffix));
 }
 clear():void{for(const span of this.source.allSpans(this.runs))this.intents.push({...span,visible:false});}
 finish():PlainPlan{
  const spans=normalize(this.intents),view=this.view();return{runs:convergenceClone(this.runs),spans,view,changed:!!(this.runs.length||spans.length)};
 }
}
