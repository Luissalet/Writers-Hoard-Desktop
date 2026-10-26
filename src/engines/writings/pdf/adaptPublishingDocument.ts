import {formattingFromElement,SCENE_BREAK_TEXT} from '@/components/editor/advanced/model';
import {renderFootnoteRefs,formatFootnoteMarker,renderEndnotesHtml,renderBookEndnotesHtml,type EndnoteGroup} from '@/components/editor/footnotes/footnoteModel';
import {PAPER_COLORS,TRIM_SIZES,TITLE_ORNAMENT_TEXT} from '../bookStyle';
import {xmlSafeText,type PublishingDocument} from '../publishingDocument';
import type {AdaptedPublishingPdf,PdfAttrs,PdfBlock,PdfCell,PdfPart,PdfRequest,PdfSegment} from './types';

const PT=72/25.4;
const BLOCK=/^(P|DIV|SECTION|ARTICLE|ASIDE|BLOCKQUOTE|PRE|H[1-6]|UL|OL|LI|TABLE|FIGURE|HR)$/;
const family=(name:string)=>({serif:'Source Serif 4',sans:'Source Sans 3',mono:'JetBrains Mono',inherit:'Source Serif 4'}[name]??name);
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const paragraph=(text:string,style:PdfAttrs={},para:PdfAttrs={}):PdfBlock=>({kind:'paragraph',parts:[{kind:'text',text:xmlSafeText(text),style}],para});
const aborted=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Export canceled','AbortError')};

/** Materialize HTML semantic runs once. UTF8 byte indices are assigned by Story insertion in Rust. */
export async function adaptPublishingDocument(document:PublishingDocument,signal?:AbortSignal):Promise<AdaptedPublishingPdf>{
 const book=document.bookStyle,trim=TRIM_SIZES[book?.trim??'a4'];
 const paper=PAPER_COLORS[book?.paper??'white'];
 const margins=document.marginsMm??(book?{top:trim.margin,bottom:trim.margin,inside:trim.margin,outside:trim.margin}:{top:22,bottom:22,inside:20,outside:20});
 if(!Object.values(margins).every(v=>Number.isFinite(v)&&v>=0)||margins.inside+margins.outside>=trim.width||margins.top+margins.bottom>=trim.height)throw Error('Invalid physical margins');
 const request:PdfRequest={title:document.title,...(document.author?{author:document.author}:{}),created:Math.floor(document.generatedAt/1000),width:trim.width*PT,height:trim.height*PT,margins:{top:margins.top*PT,bottom:margins.bottom*PT,inside:margins.inside*PT,outside:margins.outside*PT},initialPageNumber:document.initialPageNumber??1,paper:paper.background,ink:paper.ink,segments:[],assets:[]};
 const chunks:Uint8Array[]=[],assetBySrc=new Map<string,{id:number;width:number;height:number}>();let length=0;
 const diagnostics:string[]=[];
 const contentWidth=request.width-request.margins.inside-request.margins.outside;
 const contentHeight=request.height-request.margins.top-request.margins.bottom;
 const defaultStyle:PdfAttrs={fontFamily:'Source Serif 4',fontStyle:'Regular',size:12,leading:{kind:'points',value:12*(book?.lineHeight??1.5)},fill:paper.ink,language:document.locale.startsWith('es')?'Spanish':'English: USA',ligatures:true,tracking:1000*(book?.letterSpacing??0)};
 async function image(src:string,width:number,block:boolean):Promise<PdfPart|undefined>{
  aborted(signal);
  if(!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(src)){diagnostics.push('Remote or uncaptured image omitted; no network request');return undefined;}
  let asset=assetBySrc.get(src);
  if(!asset){
   const [head,data]=src.split(',',2);let bytes:Uint8Array;
   try{bytes=Uint8Array.from(atob(data.replace(/\s/g,'')),c=>c.charCodeAt(0))}catch{throw Error('Invalid local PDF image base64')}
   const mime=head.slice(5,head.indexOf(';')).toLowerCase().replace('image/jpg','image/jpeg');
   const bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:mime}));
   try{aborted(signal);asset={id:request.assets.length+1,width:bitmap.width,height:bitmap.height};request.assets.push({id:asset.id,offset:length,length:bytes.length,mime,width:bitmap.width,height:bitmap.height});chunks.push(bytes);length+=bytes.length;assetBySrc.set(src,asset)}finally{bitmap.close()}
  }
  const target=Math.min(width,asset.width*0.75);const height=target*asset.height/asset.width;
  // A full block image fits without stretching and keeps its natural ratio.
  const scale=block?Math.min(1,(contentHeight-24)/height):1;
  return {kind:'image',asset:asset.id,width:target*scale,height:height*scale,block};
 }
 function styled(element:Element,inherited:PdfAttrs):PdfAttrs{
  const style={...inherited},format=formattingFromElement(element),tag=element.tagName;
  if(format.fontFamily)style.fontFamily=family(format.fontFamily);
  if(format.fontSize)style.size=format.fontSize;
  if(format.color)style.fill=format.color;
  if(format.smallCaps!==undefined)style.capitalization=format.smallCaps?'smallCaps':'normal';
  if(tag==='STRONG'||tag==='B')style.fontStyle=String(style.fontStyle).includes('Italic')?'Bold Italic':'Bold';
  if(tag==='EM'||tag==='I')style.fontStyle=String(style.fontStyle).includes('Bold')?'Bold Italic':'Italic';
  if(tag==='CODE'||tag==='PRE'){style.fontFamily='JetBrains Mono';style.fontStyle='Regular';style.size=10;}
  if(tag==='U')style.underline=true;if(tag==='S'||tag==='DEL')style.strikethrough=true;
  if(tag==='SUP')style.position='superscript';if(tag==='SUB')style.position='subscript';
  return style;
 }
 async function inline(nodes:Iterable<Node>,inherited:PdfAttrs,width:number,pre=false):Promise<PdfPart[]>{
  const parts:PdfPart[]=[];
  for(const node of nodes){
   if(node.nodeType===Node.TEXT_NODE){let text=xmlSafeText(node.textContent??'');if(!pre)text=text.replace(/[\t\r\n ]+/g,' ');if(text)parts.push({kind:'text',text,style:{...inherited}});continue;}
   if(!(node instanceof Element))continue;
   const style=styled(node,inherited);
   if(node.tagName==='BR'){parts.push({kind:'text',text:'\u2028',style});continue;}
   if(node.tagName==='IMG'){
    const percent=Number(node.getAttribute('data-wh-width'));const chosen=[25,50,75,100].includes(percent)?width*percent/100:width;
    const part=await image(node.getAttribute('src')??'',chosen,true);if(part)parts.push(part);continue;
   }
   parts.push(...await inline(node.childNodes,style,width,pre||node.tagName==='PRE'));
  }
  return parts;
 }
 async function blocks(container:Element,width:number,inherited:PdfAttrs=defaultStyle):Promise<PdfBlock[]>{
  const out:PdfBlock[]=[];let loose:Node[]=[];
  async function flush(){if(loose.length){const parts=await inline(loose,inherited,width);if(parts.some(p=>p.kind==='image'||p.text.trim()))out.push({kind:'paragraph',parts,para:{spaceAfter:6,hyphenate:false}});loose=[]}}
  for(const node of container.childNodes){
   aborted(signal);
   if(!(node instanceof Element)||!BLOCK.test(node.tagName)){loose.push(node);continue;}
   await flush();const tag=node.tagName,format=formattingFromElement(node),style=styled(node,inherited);
   if(tag==='TABLE'){
    const rows=[...node.querySelectorAll('tr')].filter(r=>r.closest('table')===node);const occupied=new Set<string>(),cells:PdfCell[]=[];let columns=0;
    for(let r=0;r<rows.length;r++){let c=0;for(const cell of [...rows[r].children].filter(c=>c.tagName==='TD'||c.tagName==='TH')){
     while(occupied.has(`${r}:${c}`))c++;const rowSpan=Number(cell.getAttribute('rowspan')??1),colSpan=Number(cell.getAttribute('colspan')??1);
     if(!Number.isSafeInteger(rowSpan)||!Number.isSafeInteger(colSpan)||rowSpan<1||colSpan<1||r+rowSpan>rows.length)throw Error('Invalid PDF table span');
     for(let rr=r;rr<r+rowSpan;rr++)for(let cc=c;cc<c+colSpan;cc++){if(occupied.has(`${rr}:${cc}`))throw Error('Overlapping PDF table spans');occupied.add(`${rr}:${cc}`)}
     const cellStyle=cell.tagName==='TH'?{...style,fontStyle:'Bold'}:style;
     let content=await blocks(cell,width/Math.max(1,rows[r].children.length)*colSpan,cellStyle);if(!content.length)content=[paragraph('',cellStyle)];
     cells.push({row:r,column:c,rowSpan,colSpan,blocks:content});c+=colSpan;columns=Math.max(columns,c);
    }}
    let headers=0;for(const row of rows){if([...row.children].every(c=>c.tagName==='TH'))headers++;else break;}
    headers=Math.min(headers,Math.max(0,rows.length-1));out.push({kind:'table',rows:rows.length,columns,headers,cells,wide:false});continue;
   }
   if(tag==='OL'||tag==='UL'){
    let number=Number(node.getAttribute('start')??1);for(const li of node.children){if(li.tagName!=='LI')continue;const child=await blocks(li,width,style);const prefix=tag==='OL'?`${number++}. `:'• ';
     if(child[0]?.kind==='paragraph')child[0].parts.unshift({kind:'text',text:prefix,style});else child.unshift(paragraph(prefix,style));out.push(...child);
    }continue;
   }
   if(node.hasAttribute('data-wh-column-break')||node.hasAttribute('data-wh-page-break')){
    if(node.hasAttribute('data-wh-column-break')&&book?.columns!==2)continue;
    out.push(paragraph('',style,{startParagraph:node.hasAttribute('data-wh-column-break')?'nextColumn':'nextPage'}));continue;
   }
   if(tag==='HR'){
    const ornament=node.getAttribute('data-wh-ornament')??'line';const text=SCENE_BREAK_TEXT[ornament as keyof typeof SCENE_BREAK_TEXT]??'—';out.push(paragraph(text,style,{align:'center',spaceBefore:12,spaceAfter:12}));continue;
   }
   if(['DIV','SECTION','ARTICLE','FIGURE','ASIDE','BLOCKQUOTE','LI'].includes(tag)){
    const children=await blocks(node,width,style);
    if(tag==='ASIDE'||tag==='BLOCKQUOTE')for(const block of children)if(block.kind==='paragraph'){block.para={...block.para,leftIndent:12,rightIndent:12,shadingOn:tag==='ASIDE',shadingColor:paper.ink,shadingTint:0.07,spaceBefore:6,spaceAfter:6};}
    out.push(...children);continue;
   }
   const heading=/^H[1-6]$/.test(tag);if(heading){style.fontStyle='Bold';style.size=tag==='H1'?(book?.titleSize??20):tag==='H2'?16:13;}
   const para:PdfAttrs={hyphenate:false,spaceAfter:heading?12:12*(book?.paragraphs==='spaced'?book.paragraphSpacing:0.15),align:format.alignment==='justify'?'leftJustified':format.alignment??(book?.align==='justify'?'leftJustified':'left'),keepWithNext:heading?1:0};
   if(format.firstLineIndent!==undefined)para.firstLineIndent=format.firstLineIndent*Number(style.size);
   if(format.indent)para.leftIndent=format.indent*1.5*Number(style.size);
   if(format.lineHeight)style.leading={kind:'points',value:Number(style.size)*format.lineHeight};
   if(format.dropCap){para.dropCapLines=3;para.dropCapChars=1;}
   if(tag==='H2'||node.querySelector('img[data-wh-width="page"]'))para.spanColumns={kind:'span',columns:0};
   if(tag==='PRE'){
    const lines=(node.textContent??'').replace(/\r/g,'').split('\n');
    for(const [i,text] of lines.entries())out.push(paragraph(text,style,{...para,align:'left',spaceAfter:0,keepLinesTogether:true,keepWithNext:i<lines.length-1?1:0}));
    continue;
   }
   const parts=await inline(node.childNodes,style,node.querySelector('img[data-wh-width="page"]')?contentWidth:width);
   out.push({kind:'paragraph',parts,para});
  }
  await flush();return out;
 }
 async function html(value:string,width:number){return blocks(new DOMParser().parseFromString(value,'text/html').body,width)}
 const title=(value:string,size=book?.titleSize??20)=>paragraph(value,{...defaultStyle,fontStyle:'Bold',size},{align:'center',spaceAfter:16,spanColumns:{kind:'span',columns:0},keepWithNext:1});
 if(document.cover){const part=await image(document.cover.src,request.width,true);if(!part)throw Error('Captured cover image unavailable');request.segments.push({id:'cover',cover:true,columns:1,blocks:[{kind:'paragraph',parts:[part],para:{}}]})}
 if(document.includeTitlePage)request.segments.push({id:'title',columns:1,blocks:[title(document.title,26),...(document.author?[paragraph(document.author,defaultStyle,{align:'center',spaceAfter:12})]:[]),paragraph(`${document.wordCount.toLocaleString(document.locale)} ${document.wordLabel}`,defaultStyle,{align:'center'})]});
 if(document.copyright)request.segments.push({id:'copyright',columns:1,blocks:[paragraph(document.copyright,defaultStyle)]});
 if(document.includeToc)request.segments.push({id:'toc',columns:1,blocks:[title(document.tocTitle)],toc:document.sections.map(s=>({id:s.id,title:s.title}))});
 const groups:EndnoteGroup[]=[];let nextNumber=1;
 for(const [index,section] of document.sections.entries()){
  const notes=renderFootnoteRefs(section.html,n=>`<sup>${escape(formatFootnoteMarker(n.index,document.footnoteStyle))}</sup>`,document.footnotePlacement==='book'?nextNumber:1);
  const columns=book?.columns??1;const width=(contentWidth-(columns-1)*7*PT)/columns;
  const segment:PdfSegment={id:section.id,columns,blocks:[]};
  if(section.headerImage?.layout==='banner'&&section.headerImage.label)segment.blocks.push(paragraph(section.headerImage.label,defaultStyle));
  if(section.headerImage){const part=await image(section.headerImage.src,contentWidth,true);if(part)segment.blocks.push({kind:'paragraph',parts:[part],para:{spanColumns:{kind:'span',columns:0}}})}
  segment.blocks.push(title(section.title));
  if(book&&book.titleOrnament!=='none')segment.blocks.push(paragraph(TITLE_ORNAMENT_TEXT[book.titleOrnament],defaultStyle,{align:'center',spanColumns:{kind:'span',columns:0},spaceAfter:12}));
  if(section.synopsis)segment.blocks.push(paragraph(section.synopsis,{...defaultStyle,fontStyle:'Italic'},{spaceAfter:12}));
  segment.blocks.push(...await html(notes.html,width));
  if(document.footnotePlacement==='book'){nextNumber+=notes.notes.length;groups.push({title:section.title,notes:notes.notes,scope:index+1})}
  else segment.blocks.push(...await html(renderEndnotesHtml(notes.notes,{heading:document.notesLabel,style:document.footnoteStyle,scope:index+1}),width));
  request.segments.push(segment);
 }
 if(groups.some(g=>g.notes.length))request.segments.push({id:'notes',columns:1,blocks:await html(renderBookEndnotesHtml(groups,{heading:document.notesLabel,style:document.footnoteStyle}),contentWidth)});
 if(document.bibliography.length)request.segments.push({id:'bibliography',columns:1,blocks:[title(document.bibliographyTitle??''),...document.bibliography.map(text=>paragraph(text,defaultStyle))]});
 if(document.blurb)request.segments.push({id:'blurb',columns:1,blocks:[title(document.blurb.title),paragraph(document.blurb.text,defaultStyle)]});
 const assets=new Uint8Array(length);let at=0;for(const chunk of chunks){assets.set(chunk,at);at+=chunk.length;}
 aborted(signal);return {request,assets,diagnostics};
}
