import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {renderPublishingPdf} from '@/engines/writings/pdf/publishingPdf';
import type {Writing} from '@/types';
export async function testPublishingPdfLong():Promise<string[]>{
 if(window.electronAPI!==undefined)throw Error('Browser-only long-book measurement');
 const rows=240;
 const content=Array.from({length:rows},(_,i)=>`<p>LONG_TOKEN_${String(i).padStart(3,'0')} ${'prosa larga áéíóú office affinity '.repeat(15)}</p>`).join('');
 const writing:Writing={id:'long-owned',projectId:'qa-c42-long',title:'Long owned book',content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1};
 const doc=composePublishingDocument([writing],{projectTitle:'Long owned book',includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',locale:'es',generatedAt:1793040000000});
 const start=performance.now(),out=await renderPublishingPdf(doc),elapsedMs=performance.now()-start;
 const report=out.report as {pages:number;wasmLinearMemoryBytes:number};
 if(report.pages<20||!report.wasmLinearMemoryBytes)throw Error('Long book fixture/measurement did not exercise full autoflow');
 let binary='';for(let i=0;i<out.bytes.length;i+=32768)binary+=String.fromCharCode(...out.bytes.subarray(i,i+32768));
 Reflect.set(window,'__C42_PDF_ARTIFACTS',[{name:'long-owned-book.pdf',base64:btoa(binary),byteLength:out.bytes.length,report,elapsedMs,expected:{rows,wordCount:doc.wordCount,wordPhrase:'prosa larga áéíóú office affinity',phraseCopies:rows*15}}]);
 return [`owned long book ${doc.wordCount} words/${report.pages} pages/${out.bytes.length} bytes/${elapsedMs.toFixed(1)} ms; linear memory ${report.wasmLinearMemoryBytes} bytes, not RSS`];
}
