import init,{render_pdf} from './generated/writer_publishing_pdf_wasm';
import wasmUrl from './generated/writer_publishing_pdf_wasm_bg.wasm?url';
import type {PdfRequest} from './types';

// One worker belongs to one PDF. The owner terminates it on cancel/deadline/finally.
self.onmessage=async(event:MessageEvent<{request:PdfRequest;assets:Uint8Array}>)=>{
 try{
  const initialized=await init({module_or_path:wasmUrl});
  self.postMessage({phase:'composing'});
  const output=render_pdf(JSON.stringify(event.data.request),event.data.assets);
  try{const bytes=output.bytes;const report={...JSON.parse(output.report) as Record<string,unknown>,wasmLinearMemoryBytes:initialized.memory.buffer.byteLength};self.postMessage({ok:true,bytes,report},{transfer:[bytes.buffer]});}finally{output.free()}
 }catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)})}
};
