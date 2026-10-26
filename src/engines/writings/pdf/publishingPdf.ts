import type {PublishingDocument} from '../publishingDocument';
import {adaptPublishingDocument} from './adaptPublishingDocument';

/** Browser PDF uses only the bundled editorial core. No native PDF API or network fallback. */
export async function renderPublishingPdf(document:PublishingDocument,options:{signal?:AbortSignal}={}):Promise<{bytes:Uint8Array;report:unknown}>{
 const {signal}=options;
 if(signal?.aborted)throw new DOMException('Export canceled','AbortError');
 const adapted=await adaptPublishingDocument(document,signal);
 if(signal?.aborted)throw new DOMException('Export canceled','AbortError');
 const worker=new Worker(new URL('./publishingPdf.worker.ts',import.meta.url),{type:'module',name:'Writer publishing PDF'});
 try{
  return await new Promise((resolve,reject)=>{
   const abort=()=>{worker.terminate();finish(new DOMException('Export canceled','AbortError'))};
   const timeout=setTimeout(()=>{worker.terminate();finish(Error('PDF composition deadline exceeded'))},175000);
   const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;};
   const finish=(error?:Error,result?:{bytes:Uint8Array;report:unknown})=>{cleanup();if(error)reject(error);else resolve(result!)};
   signal?.addEventListener('abort',abort,{once:true});
   worker.onerror=event=>{event.preventDefault();finish(Error(event.message||'PDF Worker failed'))};
   worker.onmessageerror=()=>finish(Error('PDF Worker response could not be decoded'));
   worker.onmessage=(event:MessageEvent<{phase?:string;ok:boolean;bytes?:Uint8Array;report?:Record<string,unknown>;error?:string}>)=>{
    if(event.data.phase==='composing')return;
    if(!event.data.ok||!event.data.bytes?.length){finish(Error(event.data.error??'PDF encoder returned no bytes'));return;}
    finish(undefined,{bytes:event.data.bytes,report:{...event.data.report,diagnostics:adapted.diagnostics}});
   };
   if(signal?.aborted){abort();return;}
   // The capture remains owned by the service. Only this adapter's fresh byte copy transfers.
   try{worker.postMessage({request:adapted.request,assets:adapted.assets},{transfer:[adapted.assets.buffer]});}
   catch(error){finish(error instanceof Error?error:Error(String(error)));}
  });
 }finally{worker.terminate()}
}
