import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {renderPublishingPdf} from '@/engines/writings/pdf/publishingPdf';
import {bookPreset,TRIM_SIZES,type BookTrim} from '@/engines/writings/bookStyle';
import type {Writing} from '@/types';

const b64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)};
const writing=(id:string,content:string):Writing=>({id,projectId:'qa-c42-layout',title:id,content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1});
export async function testPublishingPdfLayout():Promise<string[]>{
 if(window.electronAPI!==undefined)throw Error('Browser-only matrix');
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1800;const c=canvas.getContext('2d')!;c.fillStyle='#456d57';c.fillRect(0,0,1200,1800);c.fillStyle='#f5d6a0';c.fillRect(60,60,1080,1680);const src=canvas.toDataURL('image/png');
 const artifacts:unknown[]=[];Reflect.set(window,'__C42_PDF_ARTIFACTS',artifacts);
 for(const trim of ['a4','letter','a5','6x9'] as BookTrim[]){
  const full=trim==='a4',style={...bookPreset(trim==='letter'?'sourcebook':'modern'),trim};
  const before=trim==='letter'?'<p>COL_BEFORE</p><div data-wh-column-break="true"></div><p>COL_AFTER</p>':'';
  const content=`<p>BEFORE_BREAK ${trim}.<sup data-footnote-id="note-a" data-footnote="NOTE_A_CHAPTER"></sup></p><div data-wh-page-break="true"></div><p>AFTER_BREAK ${trim}.</p>${before}<table><tr><th colspan="2">MERGED_HEADER</th></tr><tr><td rowspan="2">ROW_SPAN</td><td>CELL_ONE</td></tr><tr><td>CELL_TWO</td></tr></table><p><img src="${src}" data-wh-width="25"></p>`;
  const doc=composePublishingDocument([writing('Chapter A',content),writing('Chapter B','<p>BODY_B<sup data-footnote-id="note-b" data-footnote="NOTE_B_CHAPTER"></sup></p>')],{projectTitle:'Layout '+trim,author:'Author marker',includeTitlePage:full,includeSynopsis:false,chapterLabel:'Chapter',includeToc:full,locale:'es',generatedAt:1793040000123,footnotePlacement:'chapter',footnoteStyle:'roman',notesLabel:'Notas',bookStyle:style,marginsMm:{top:11,bottom:13,inside:17,outside:19},initialPageNumber:7,...(full?{cover:{src,width:1200,height:1800,alt:'Own cover'},copyright:'COPYRIGHT_MARKER',blurb:{title:'BLURB_TITLE',text:'BLURB_BODY'},bibliographyTitle:'BIBLIOGRAPHY',bibliography:['SOURCE_MARKER']}:{}),includeInlineImages:false});
  const out=await renderPublishingPdf(doc);
  artifacts.push({name:`layout-${trim}.pdf`,base64:b64(out.bytes),byteLength:out.bytes.length,report:out.report,expected:{trim,widthMm:TRIM_SIZES[trim].width,heightMm:TRIM_SIZES[trim].height,cover:full,initialPageNumber:7,chapterNotes:true,physicalBreak:true,columns:style.columns,markers:['BEFORE_BREAK','AFTER_BREAK','NOTE_A_CHAPTER','NOTE_B_CHAPTER','MERGED_HEADER','ROW_SPAN','CELL_ONE','CELL_TWO','BODY_B',...(full?['COPYRIGHT_MARKER','BLURB_BODY','SOURCE_MARKER']:[])]}});
 }
 return ['four trims, physical margins/start, owned cover, chapter notes, nested spans, page and column breaks'];
}
