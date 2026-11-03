import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {PlainRuns} from '@/engines/local/convergence/plainRuns';
import {Registers} from '@/engines/local/convergence/registers';
import {convergenceBytes} from '@/engines/local/convergence/format';

/** Owned engine overlay: metadata is isolated from both returned plans and durable roots. */
export function runAppendMetadataFocals(){
 const doc=new Y.Doc({gc:false}),registers=new Registers(doc),plain=new PlainRuns(doc,'own-metadata',registers),checks:string[]=[];
 const equal=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 let destroyed=0;
 try{
  const empty=plain.materialize(),draft=plain.draft(empty),before=Y.encodeStateAsUpdate(doc);
  equal('empty overlay has no inserted runs',draft.insertedRuns(),[]);
  draft.splice({afterPlacementId:null,deleteIds:[]},'A🙂\ud800');
  const first=draft.insertedRuns();equal('one inserted run',first.length,1);equal('UTF16 length includes opaque surrogate',first[0].length,4);
  const encoded=convergenceBytes(first[0].bytes),units=Array.from({length:encoded.length/2},(_,i)=>encoded[2*i]|encoded[2*i+1]<<8);
  equal('metadata bytes preserve exact UTF16',[...units],[65,0xd83d,0xde42,0xd800]);equal('null insertion anchor retained',first[0].after,null);
  const saved=structuredClone(first);first[0].id='caller';first[0].bytes='';first[0].length=0;first.push({...first[0]});
  equal('metadata is a detached deep copy',draft.insertedRuns(),saved);equal('metadata never commits Source',Y.encodeStateAsUpdate(doc),before);
  draft.splice({afterPlacementId:null,deleteIds:[]},'李明');
  const second=draft.insertedRuns();equal('both insertions retained',second.length,2);equal('first run identity unchanged',second[0],saved[0]);equal('second run length',second[1].length,2);
  const plan=draft.finish(),again=draft.finish();equal('finish includes exact metadata',plan.runs,second);equal('normal overlay order and text',plan.view.text,'李明A🙂\ud800');equal('repeated finish same data',again.view,plan.view);
  assert.notDeepStrictEqual(plan.spans.map(s=>s.key),again.spans.map(s=>s.key),'finish prepares fresh visibility keys');checks.push('finish prepares fresh visibility keys');
  plan.runs[0].id='changed-plan';equal('returned plan cannot mutate overlay metadata',draft.insertedRuns(),second);
  equal('plain Source remains empty before commit',plain.materialize(),empty);
  const final=draft.finish();doc.transact(()=>{registers.begin();plain.commit(final);registers.flush();});
  equal('normal commit exact text',plain.materialize().text,'李明A🙂\ud800');equal('normal commit exact bindings',plain.materialize().bindings,final.view.bindings);
  const current=plain.materialize(),deletion=plain.draft(current),range=plain.range(current,0,2);deletion.splice(range,'');
  equal('deletion alone creates no run',deletion.insertedRuns(),[]);equal('deletion preserves remaining opaque text',deletion.finish().view.text,'A🙂\ud800');
  equal('deletion preview does not change Source',plain.materialize(),current);
  const clear=plain.draft(current);clear.clear();equal('clear alone creates no run',clear.insertedRuns(),[]);equal('clear view empty',clear.finish().view.text,'');equal('clear does not change Source',plain.materialize(),current);
 }finally{doc.destroy();destroyed++;}
 return{ok:true,checks,cleanup:{created:1,destroyed}};
}
