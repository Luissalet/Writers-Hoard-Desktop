import {composePublishingDocument,type PublishingDocument} from '@/engines/writings/publishingDocument';
import {renderPublishingPdf} from '@/engines/writings/pdf/publishingPdf';
import {bookPreset} from '@/engines/writings/bookStyle';
import type {Writing} from '@/types';

function check(v:unknown,message:string):asserts v{if(!v)throw Error(message)}
function writing(id:string,content:string):Writing{return {id,projectId:'qa-c42-pdf',title:id,content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1}}
function png(){const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const c=canvas.getContext('2d')!;c.fillStyle='#1d785d';c.fillRect(0,0,80,40);c.fillStyle='#f8db74';c.fillRect(4,4,24,32);return canvas.toDataURL('image/png')}
function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)}
async function rejects(doc:PublishingDocument,needle:string){let error='';try{await renderPublishingPdf(doc)}catch(e){error=String(e)}check(error.includes(needle),`Expected ${needle}; got ${error||'PDF succeeded'}`);return error}

/** Run under the existing Vite origin so this exercises the shipping Worker and emitted WASM URL. */
export async function testPublishingBrowserPdf():Promise<string[]>{
 check(window.electronAPI===undefined,'Browser PDF test must not have electronAPI');
 const image=png();
 const rows=Array.from({length:160},(_,i)=>`<tr><td>R${String(i).padStart(3,'0')}A</td><td>R${String(i).padStart(3,'0')}B café 日本語</td></tr>`).join('');
 const words=Array.from({length:700},(_,i)=>`palabra${i}`).join(' ');
 const source=`<h2>Título ancho</h2><p>Árbol áéíóú ñ. office affinity 日本語。 <strong>Negrita</strong> <em>Cursiva</em><sup data-footnote-id="n1" data-footnote="Nota uno propia."></sup></p><p>${words}</p><p><img data-wh-width="page" src="${image}"></p><table><thead><tr><th>Cabecera A</th><th>Cabecera B</th></tr></thead><tbody>${rows}</tbody></table><aside data-wh-callout="note"><p>Recuadro propio íntegro.</p></aside><pre>  espacio  doble\n    segunda línea</pre>`;
 const doc=composePublishingDocument([writing('Capítulo A',source),writing('Capítulo B','<p>Fin propio.<sup data-footnote-id="n2" data-footnote="Nota dos propia."></sup></p>')],{projectTitle:'Libro PDF Browser',author:'Writer QA',includeTitlePage:true,includeSynopsis:false,includeToc:true,chapterLabel:'Capítulo',notesLabel:'Notas',tocTitle:'Índice',locale:'es',footnotePlacement:'book',generatedAt:1793040000000,bookStyle:bookPreset('sourcebook'),includeInlineImages:false,marginsMm:{top:20,bottom:20,inside:22,outside:16},initialPageNumber:7});
 const started=performance.now(),out=await renderPublishingPdf(doc);const elapsedMs=performance.now()-started;
 check(new TextDecoder().decode(out.bytes.subarray(0,5))==='%PDF-','PDF header');
 const report=out.report as {pages:number;passes:number;anchors:Record<string,number>;warnings:unknown[]};
 check(report.pages>=6&&report.passes>=2,'Autoflow and TOC must compose multiple pages to stability');
 check(report.anchors['Capítulo A']>report.anchors.toc&&report.anchors['Capítulo B']>report.anchors['Capítulo A'],'Known chapter anchors and TOC numbers');
 check(report.warnings.length===0,'No fallback export warning');
 const artifact={name:'browser-rich-book.pdf',base64:b64(out.bytes),byteLength:out.bytes.length,report,elapsedMs,expected:{tableRows:160,paragraphWords:700,portableImagesEnabled:false,pdfMustRetainImage:true,notes:['Nota uno propia.','Nota dos propia.'],tokens:Array.from({length:160},(_,i)=>`R${String(i).padStart(3,'0')}A`),words:Array.from({length:700},(_,i)=>`palabra${i}`)}};
 Reflect.set(window,'__C42_PDF_ARTIFACTS',[artifact]);
 const missing=composePublishingDocument([writing('Missing','<p><span data-wh-font="Unavailable QA Font">Missing font must fail.</span></p>')],{projectTitle:'Negative',includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',locale:'es'});
 const missingFont=await rejects(missing,'missing-font');
 const impossible=composePublishingDocument([writing('Impossible','<table><tr><td>'+Array.from({length:300},()=>'<p>Unbreakable row content.</p>').join('')+'</td></tr></table>')],{projectTitle:'Negative',includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',locale:'es'});
 const noProgress=await rejects(impossible,'layout-no-progress');
 Reflect.set(window,'__C42_PDF_NEGATIVES',{missingFont,noProgress});
 return [`real Browser Worker PDF ${out.bytes.length} bytes/${report.pages} pages, TOC stable in ${report.passes} passes`, 'table rows with same anchor, long paragraph, two columns, page-wide image, notes/book and pre whitespace', 'missing font and impossible row fail visibly without partial PDF'];
}
