import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {PlainRuns,type PlainSpan} from '@/engines/local/convergence/plainRuns';
import {Registers} from '@/engines/local/convergence/registers';
type Extra=Parameters<PlainRuns['materialize']>[1];
type Intents=Parameters<PlainRuns['materialize']>[2];
export function runRetainedVisibleFocals(candidate=false){
 const checks:string[]=[],groups:string[]=[],docs:Y.Doc[]=[];let destroyed=0;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 const make=()=>{const doc=new Y.Doc({gc:false});docs.push(doc);const registers=new Registers(doc),plain=new PlainRuns(doc,'own-retained-visible',registers);return{doc,registers,plain};};
 const commit=(p:ReturnType<typeof make>,fn:()=>void)=>{let ids:string[]=[];p.doc.transact(()=>{p.registers.begin();fn();ids=p.registers.flush();});return ids;};
 const insert=(p:ReturnType<typeof make>,id:string,text:string,after:string|null=null)=>{const d=p.plain.draft(p.plain.materialize()),descriptor=Object.getOwnPropertyDescriptor(crypto,'randomUUID');try{Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>id});d.splice({afterPlacementId:after,deleteIds:[]},text);}finally{if(descriptor)Object.defineProperty(crypto,'randomUUID',descriptor);else Reflect.deleteProperty(crypto,'randomUUID');}const plan=d.finish();commit(p,()=>p.plain.commit(plan));return plan;};
 const observe=(name:string,plain:PlainRuns,base?:PlainSpan[],extra:Extra=[],intents:Intents=[],expectedText?:string,expectedError?:string)=>{
  const before=Y.encodeStateAsUpdate(plain.doc),attempt=(fn:()=>unknown)=>{try{return{ok:true,value:fn()};}catch(error){return{ok:false,error:String(error)};}};
  const original=()=>{const full=plain.materialize(plain.allSpans(extra),extra),shown=plain.materialize(base,extra,intents);return{full,visible:shown.bindings};};
  const reference=attempt(original),actual=attempt(()=>candidate?plain.retainedAndVisible(base,extra,intents):original());eq(name+' exact dual-view equivalence',actual,reference);
  if(expectedError!==undefined){eq(name+' original expected error',reference,{ok:false,error:'Error: '+expectedError});}
  else{assert(reference.ok);checks.push(name+' original valid');const value=(reference as {ok:true;value:{full:{text:string;bindings:PlainSpan[]};visible:PlainSpan[]}}).value;if(expectedText!==undefined){const shown=plain.materialize(base,extra,intents);eq(name+' visible text expected',shown.text,expectedText);}
   if(candidate){const v=(actual as {ok:true;value:{full:{text:string;bindings:PlainSpan[]};visible:PlainSpan[]}}).value;const untouched=structuredClone(v);if(v.visible[0])v.visible[0].from=-100;v.visible.splice(0);eq(name+' visible cannot mutate full',v.full,untouched.full);eq(name+' later projection independent',plain.retainedAndVisible(base,extra,intents),untouched);}}
  eq(name+' document unchanged',Y.encodeStateAsUpdate(plain.doc),before);
 };
 try{
  const p=make(),seed='A\u0000🙂\ud800Z',parent=insert(p,'parent',seed),anchor=p.plain.range(parent.view,1,1).afterPlacementId;insert(p,'a-child','x',anchor);insert(p,'z-child','y',anchor);const frontier=p.registers.frontier();eq('interleaved child order is not lexical',p.plain.materialize().bindings.map(s=>s.runId),['parent','z-child','a-child','parent']);observe('interleaved UTF16',p.plain,undefined,[],[],'Ayx\u0000🙂\ud800Z');
  const hidden=commit(p,()=>p.registers.write(p.plain.root,'hide-parent',true,{runId:'parent',from:0,to:seed.length,visible:false}));observe('hidden parent children visible',p.plain,undefined,[],[],'yx');commit(p,()=>p.registers.write(p.plain.root,'hide-child',true,{runId:'z-child',from:0,to:1,visible:false}));observe('hidden parent and child',p.plain,undefined,[],[],'x');
  observe('admitted parent ignores current masks',p.plain,[{runId:'parent',from:0,to:seed.length}],[],[],seed);observe('admitted child only',p.plain,[{runId:'z-child',from:0,to:1}],[],[],'y');observe('staged interval restore',p.plain,undefined,[],[{runId:'parent',from:0,to:1,visible:true}],'Ax');
  p.doc.transact(()=>p.registers.toggle(hidden.map(id=>({id,enabled:false}))));observe('independent visibility retirement',p.plain,undefined,[],[],'Ax\u0000🙂\ud800Z');
  const d=p.plain.draft(p.plain.materialize());d.splice({afterPlacementId:anchor,deleteIds:[]},'Ω');const overlay=d.finish();observe('staged new run and intents',p.plain,p.plain.materialize().bindings,overlay.runs,overlay.spans,'AΩx\u0000🙂\ud800Z');
  const clear=p.plain.draft(p.plain.materialize());clear.clear();const cleared=clear.finish();observe('staged clear all hidden',p.plain,p.plain.materialize().bindings,cleared.runs,cleared.spans,'');groups.push('current-hidden-overlay-and-owning');
  insert(p,'future','F');p.registers.atFrontier(frontier,registers=>observe('historical no future or new masks',new PlainRuns(p.doc,p.plain.field,registers),undefined,[],[],'Ayx\u0000🙂\ud800Z'));
  p.plain.content.set('missing',{id:'missing',length:1,bytes:'not-base64',txId:'missing-tx'});p.plain.order.push([{runId:'missing',after:null,txId:'missing-tx'}]);observe('unavailable run skipped without decoding',p.plain,undefined,[],[],'FAx\u0000🙂\ud800Z');
  p.plain.content.set('orphan',{id:'orphan',length:1,bytes:'not-base64',txId:parent.runs.length?p.registers.frontier()[0]:''});p.plain.order.push([{runId:'orphan',after:JSON.stringify(['absent-parent',0]),txId:p.registers.frontier()[0]}]);observe('unreachable orphan skipped without decoding',p.plain,undefined,[],[],'FAx\u0000🙂\ud800Z');groups.push('historical-unavailable-orphan');
  const bad=make();insert(bad,'bad','abc');commit(bad,()=>bad.registers.write(bad.plain.root,'bad-hidden-bounds',true,{runId:'bad',from:0,to:99,visible:false}));observe('hidden invalid bounds still rejects',bad.plain,undefined,[],[],undefined,'local_tool_plain_range_invalid');
  const malformed=make();insert(malformed,'bad','abc');const run=malformed.plain.content.get('bad')!;malformed.plain.content.set('bad',{...run,bytes:'AA=='});observe('full validates bytes before visibility',malformed.plain,[],[],[],undefined,'local_tool_plain_range_invalid');
  const duplicate=make();insert(duplicate,'same','ab');duplicate.plain.order.push([duplicate.plain.order.toArray()[0]]);observe('duplicate placement rejects before filter',duplicate.plain,undefined,[],[],undefined,'local_tool_plain_range_invalid');
  const extraBad=[{id:'extra',length:4,bytes:'AA==',after:null}];observe('extra bytes validated first',p.plain,undefined,extraBad,[],undefined,'local_tool_plain_range_invalid');groups.push('malformed-metadata-errors-preserved');
 }finally{for(const d of docs){d.destroy();destroyed++;}}
 return{ok:true,groups,checks,cleanup:{created:docs.length,destroyed},candidate,scope:'Public owned PlainRuns/Registers/Y.Doc engine fixtures; no private replica Doc or Source/SDK/MCP/performance claim'};
}
