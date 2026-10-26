import {act,createElement,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {defineLocalTool,useLocalToolDefaults,type LocalToolClient,type LocalToolJson} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
type State={notes:string};
type Api=ReturnType<typeof useLocalToolDefaults<State>>;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const same=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(a)===JSON.stringify(b),message);
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
const gate=()=>({entered:deferred(),release:deferred()});
const definition=defineLocalTool<State>({namespace:'tests.defaults-hook',name:{en:'Defaults hook',es:'Hook de preferencias'},description:{en:'Public hook oracle',es:'Oráculo público del hook'},initialState:{notes:'Source sentinel'},validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:()=>null});
function observed(base:LocalToolClient<State>){
 const service=base.defaults;check(service,'Public defaults missing');const calls={get:0,set:0,undo:0,redo:0},gates:ReturnType<typeof gate>[]=[];let nextGet:ReturnType<typeof gate>|undefined,nextSet:ReturnType<typeof gate>|undefined,rejectSet=false;
 const client:LocalToolClient<State>={...base,defaults:{...service,get:async key=>{calls.get++;const held=nextGet;nextGet=undefined;const snapshot=await service.get(key);if(held){held.entered.resolve();await held.release.promise;}return snapshot;},set:async(...args)=>{calls.set++;if(rejectSet){rejectSet=false;throw Error('Synthetic set rejection');}const held=nextSet;nextSet=undefined;const result=await service.set(...args);if(held){held.entered.resolve();await held.release.promise;}return result;},undo:async(...args)=>{calls.undo++;return service.undo(...args);},redo:async(...args)=>{calls.redo++;return service.redo(...args);}}};
 return{client,counts:()=>({...calls}),failSet:()=>{rejectSet=true;},holdGet:()=>{const value=gate();gates.push(value);nextGet=value;return value;},holdSetResult:()=>{const value=gate();gates.push(value);nextSet=value;return value;},releaseAll:()=>gates.forEach(value=>value.release.resolve())};
}
async function invoke(run:()=>Promise<boolean>){let result=false;await act(async()=>{result=await run();});return result;}
async function until(test:()=>boolean,message:string){for(let n=0;n<200;n++){if(test())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}throw Error(message);}
async function fixture(){
 const projectId='defaults-hook-'+crypto.randomUUID(),host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1}]}),a=observed(host.createClient({projectId})),b=observed(host.createClient({projectId})),remote=host.createClient({projectId}).defaults!,element=document.createElement('div');document.body.append(element);const root=createRoot(element);let api:Api|undefined,closed=false;
 function Probe({client,prefKey}:{client:LocalToolClient<State>;prefKey:string}){const value=useLocalToolDefaults(client,prefKey);useLayoutEffect(()=>{api=value;});return null;}
 const current=()=>{check(api,'Hook not committed');return api;},idle=()=>until(()=>!!api?.snapshot&&!api.loading&&!api.busy,'Hook did not settle');
 const show=async(client:LocalToolClient<State>,prefKey:string)=>{await act(async()=>{root.render(createElement(Probe,{client,prefKey}));});await idle();};
 const close=async()=>{if(closed)return;closed=true;a.releaseAll();b.releaseAll();await act(async()=>root.unmount());element.remove();};
 return{host,a,b,remote,current,idle,show,close};
}
async function revokedMethods(mode:'client'|'key'){
 const f=await fixture(),key='favorite';try{
  await f.show(f.a.client,key);const old=f.current();await f.show(mode==='client'?f.b.client:f.a.client,mode==='key'?'other':key);await f.show(f.a.client,key);
  check(await invoke(()=>f.current().set('A2')),'A2 set failed');await f.idle();check(f.current().canUndo,'A2 receipt missing');
  async function inert(name:string,run:()=>Promise<boolean>){const calls=f.a.counts(),memory=f.host.inspect();check(await invoke(run)===false,mode+': old '+name+' revived');same(f.a.counts(),calls,mode+': old '+name+' entered service');same(f.host.inspect(),memory,mode+': old '+name+' changed data');}
  await inert('undo',old.undo);await inert('set',()=>old.set('STALE'));await inert('reload',old.reload);
  f.a.failSet();check(await invoke(()=>f.current().set('A2 proposal'))===false,'Synthetic rejection not observed');check(f.current().hasProposal,'Proposal lost');check(await invoke(()=>f.current().reload()),'Explicit reload failed');await f.idle();check(f.current().hasProposal&&!f.current().error,'Reload must preserve proposal/clear error');await inert('retry',old.retry);check(f.current().hasProposal,'Old retry consumed proposal');
  check(await invoke(()=>f.current().undo()),'A2 receipt consumed');await f.idle();check(f.current().snapshot?.entry.present===false,'Undo did not restore absence');const last=f.current(),calls=f.a.counts(),memory=f.host.inspect();await f.close();for(const run of [last.undo,last.reload,last.retry,()=>last.set('CLOSED')])check(await invoke(run)===false,'Unmounted method acted');same(f.a.counts(),calls,'Unmounted method entered service');same(f.host.inspect(),memory,'Unmounted method changed data');
 }finally{await f.close();}
}
async function loadingAndReads(){
 const f=await fixture(),key='favorite';try{
  await f.show(f.a.client,key);check(await invoke(()=>f.current().set('BASE')),'Initial set failed');await f.idle();const retainedSet=f.current().set,held=f.a.holdGet();let reading!:Promise<boolean>;
  await act(async()=>{reading=f.current().reload();await held.entered.promise;});check(f.current().loading,'Deferred get not loading');const calls=f.a.counts(),memory=f.host.inspect();check(await invoke(()=>retainedSet('BLOCKED'))===false,'Set entered while loading');same(f.a.counts(),calls,'Loading guard reached service');same(f.host.inspect(),memory,'Loading guard changed data');await act(async()=>{held.release.resolve();check(await reading,'Reload failed');});await f.idle();check(await invoke(()=>f.current().set('RECOVERED')),'Set did not recover');await f.idle();
  const writing=f.a.holdSetResult();let saving!:Promise<boolean>;await act(async()=>{saving=f.current().set('LOCAL');await writing.entered.promise;});check(f.current().busy,'Held result not busy');await act(async()=>{await f.remote.set(key,'REMOTE',await f.remote.get(key));});await act(async()=>{writing.release.resolve();check(await saving,'Local set failed');});await until(()=>{const entry=f.current().snapshot?.entry;return !f.current().busy&&!f.current().loading&&!!entry?.present&&entry.value==='REMOTE';},'Notice while working lost or stale response won');
  const older=f.a.holdGet();await act(async()=>{reading=f.current().reload();await older.entered.promise;});await act(async()=>{await f.remote.set(key,'FRESH',await f.remote.get(key));});await until(()=>{const entry=f.current().snapshot?.entry;return !f.current().loading&&!!entry?.present&&entry.value==='FRESH';},'Fresh notified read missing');await act(async()=>{older.release.resolve();check(await reading===false,'Obsolete get reported success');});const entry=f.current().snapshot?.entry;check(entry?.present&&entry.value==='FRESH','Old read replaced fresh value');
 }finally{await f.close();}
}
export async function testLocalToolDefaultsHookAll(){const failures:string[]=[],passed:string[]=[];for(const [name,run]of [['ABA client',()=>revokedMethods('client')],['ABA key',()=>revokedMethods('key')],['loading/notices/old reads',loadingAndReads]]as const){try{await run();passed.push(name);}catch(error){failures.push(name+': '+String(error));}}if(failures.length)throw Error(failures.join('\n'));return passed;}
