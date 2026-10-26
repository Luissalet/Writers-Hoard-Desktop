import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {renderPublishingPdf} from '@/engines/writings/pdf/publishingPdf';
import type {Writing} from '@/types';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m)}
const doc=(id:string,content:string)=>{
 const w:Writing={id,projectId:'qa-c42-active-worker',title:id,content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1};
 return composePublishingDocument([w],{projectTitle:id,includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',generatedAt:1793040000000,locale:'es'});
};
export async function testPublishingPdfLifecycle():Promise<string[]>{
 check(window.electronAPI===undefined,'Browser-only Worker lifecycle');
 const Original=Worker,realSet=setTimeout,realClear=clearTimeout;
 const live=new Set<Worker>(),timers=new Set<number>();let phases=0,terminated=0,compressClock=false;
 let composing!:()=>void;let phasePromise=new Promise<void>(r=>{composing=r});
 class ObservedWorker extends Original{
  constructor(url:string|URL,options?:WorkerOptions){super(url,options);live.add(this);this.addEventListener('message',e=>{if(e.data?.phase==='composing'){phases++;composing()}})}
  terminate(){terminated++;live.delete(this);super.terminate()}
 }
 globalThis.Worker=ObservedWorker;
 globalThis.setTimeout=((callback:TimerHandler,ms?:number,...args:unknown[])=>{
  if(ms!==175000)return realSet(callback,ms,...args);
  // Only the watchdog clock is compressed; the Worker and Rust execution remain real.
  const handler=()=>{if(typeof callback==='function')callback(...args)};
  const timer=realSet(compressClock?()=>{void phasePromise.then(()=>realSet(handler,30))}:handler,compressClock?0:ms);timers.add(timer);return timer;
 })as typeof setTimeout;
 globalThis.clearTimeout=((timer?:number)=>{if(timer!==undefined)timers.delete(timer);return realClear(timer)})as typeof clearTimeout;
 const large=doc('Long active Rust',Array.from({length:2400},(_,i)=>'<p>Rust active '+i+' '+('prosa larga áéíóú office affinity '.repeat(35))+'</p>').join(''));
 const small=doc('Concurrent B','<p>Owned B remains complete.</p>');
 const measures:Record<string,unknown>={};
 try{
  const controller=new AbortController();let settled=false;const start=performance.now();
  const a=renderPublishingPdf(large,{signal:controller.signal}).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)})).finally(()=>{settled=true});
  await Promise.race([phasePromise,wait(20000).then(()=>{throw Error('Worker did not enter Rust composition')})]);
  const b=renderPublishingPdf(small);await wait(30);check(!settled,'Long Rust fixture finished before cancellation; no active-call proof');controller.abort();
  const canceled=await a,bResult=await b;
  check(!canceled.ok&&canceled.error.includes('AbortError'),'Active Rust A must cancel');check(new TextDecoder().decode(bResult.bytes.subarray(0,5))==='%PDF-','B must remain ready');
  check(live.size===0&&timers.size===0,'Cancel/success must clean Workers and deadline timers');
  measures.cancel={phaseObserved:true,stillPendingAtAbort:true,error:canceled.error,elapsedMs:performance.now()-start,bBytes:bResult.bytes.length,liveWorkers:live.size,timers:timers.size};
  compressClock=true;phasePromise=new Promise<void>(r=>{composing=r});
  let timeout='';try{await renderPublishingPdf(large)}catch(e){timeout=String(e)}
  check(timeout.includes('deadline exceeded'),'Owner watchdog must reject blocked Rust');check(live.size===0&&timers.size===0,'Watchdog must clean owned resources');
  measures.watchdog={actualWorkerAndRust:true,clockCompression:'175000 ms owner deadline fired 30 ms after composing phase',error:timeout,liveWorkers:live.size,timers:timers.size};
  compressClock=false;
  const retry=await renderPublishingPdf(small);check(retry.bytes.length>0&&live.size===0&&timers.size===0,'Fresh Worker retry must succeed');
  measures.retry={bytes:retry.bytes.length,freshWorker:true};measures.phases=phases;measures.terminated=terminated;
  Reflect.set(window,'__C42_LIFECYCLE',measures);
  return ['cancel during real Rust call terminates A while B stays ready','owner watchdog cleans actual Worker under explicitly compressed clock','fresh Worker retry succeeds with no live workers/deadline timers'];
 }finally{for(const worker of live)worker.terminate();for(const timer of timers)realClear(timer);globalThis.Worker=Original;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear}
}
