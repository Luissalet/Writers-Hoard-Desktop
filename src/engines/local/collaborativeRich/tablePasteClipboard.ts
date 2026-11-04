import {DOMParser as ProseMirrorDOMParser,type Schema} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import {assetBytes,assetFileMime} from '../assetFileFormat';
import {isRichImageAlignment,isRichImageSize,validateRichImageAsset} from '../convergence/imageFormat';
import {RICH_MARK_KEYS,type RichMarkValue,type RichText} from '../convergence/richTypes';
import {tablePasteArea,tablePasteContents,type RichTablePasteCell,type RichTablePasteImage,type RichTablePasteTarget} from '../convergence/tablePaste';
import {convergenceCanonical} from '../convergence/format';
import {axisCellAtPosition} from './blockProsemirror';
import {restoreSourceCellSelection,sourceCellSelectionEnds} from './tableCellSelection';
import type {RichEditorSession} from './session';

type ClipboardImage=Omit<RichTablePasteImage,'asset'>&{file:File};
type ClipboardCell=Omit<RichTablePasteCell,'images'>&{images?:ClipboardImage[]};

function readClipboardParagraphs(element:HTMLElement,parser:ProseMirrorDOMParser):RichText[][]|null{
 const parsed=parser.parse(element),paragraphs:RichText[][]=[];
 for(let i=0;i<parsed.childCount;i++){
  const paragraph=parsed.child(i),runs:RichText[]=[];
  if(paragraph.type.name!=='paragraph')return null;
  for(let j=0;j<paragraph.childCount;j++){
   const node=paragraph.child(j),marks:RichMarkValue[]=[];
   if(!node.isText||!node.text)return null;
   for(const type of RICH_MARK_KEYS){
    const mark=node.marks.find(value=>value.type.name===type);
    if(!mark)continue;
    if(type==='link'){
     const href=typeof mark.attrs.href==='string'?normalizeEditorLinkHref(mark.attrs.href):null;
     if(href)marks.push({type,attrs:{href}});
    }else marks.push({type});
   }
   const previous=runs.at(-1);
   if(previous&&JSON.stringify(previous.marks??[])===JSON.stringify(marks))previous.text+=node.text;
   else runs.push({type:'text',text:node.text,...(marks.length?{marks}:{})});
  }
  paragraphs.push(runs);
 }
 return paragraphs;
}

function clipboardTable(html:string,schema:Schema,document:Document):ClipboardCell[][]|null{
 const template=document.createElement('template');
 template.innerHTML=html;
 const tables=template.content.querySelectorAll('table');
 if(tables.length!==1)return null;
 const table=tables[0],parser=ProseMirrorDOMParser.fromSchema(schema),matrix:ClipboardCell[][]=[],files=new Map<string,File>();
 const fileFor=(image:HTMLImageElement)=>{
  const src=image.getAttribute('src')??'',cached=files.get(src);
  if(cached)return cached;
  const match=/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(src);
  if(!match)return null;
  try{
   const name='clipboard-image.'+match[2].toLowerCase(),mime=match[1].toLowerCase(),bytes=assetBytes(match[3]);
   if(assetFileMime('image',name,mime,bytes)!==mime)return null;
   const file=new File([bytes],name,{type:mime});files.set(src,file);return file;
  }catch{return null;}
 };
 for(const row of Array.from(table.rows)){
  const cells:ClipboardCell[]=[];
  for(const cell of Array.from(row.cells)){
   if(cell.colSpan!==1||cell.rowSpan!==1||cell.querySelector('picture,video,audio,iframe,object,embed,svg'))return null;
   const paragraphs:RichText[][]=[],images:ClipboardImage[]=[],chunk=document.createElement('div');
   const flush=()=>{
    if(!chunk.hasChildNodes())return true;
    if(!Array.from(chunk.childNodes).some(node=>node.nodeType===1||node.textContent?.trim())){chunk.replaceChildren();return true;}
    const parsed=readClipboardParagraphs(chunk,parser);
    if(!parsed)return false;
    paragraphs.push(...parsed);chunk.replaceChildren();return true;
   };
   for(const child of Array.from(cell.childNodes)){
    const element=child.nodeType===1?child as HTMLElement:undefined;
    const nested=element?.querySelectorAll('img');
    const image=element?.tagName==='IMG'?element as HTMLImageElement:
     nested?.length===1&&!element?.textContent?.trim()?nested[0]:undefined;
    if(image){
     const file=fileFor(image);
     if(!file||!flush())return null;
     const {imageSize,imageAlignment}=image.dataset;
     images.push({file,afterParagraph:paragraphs.length-1,displaySize:isRichImageSize(imageSize)?imageSize:'medium',alignment:isRichImageAlignment(imageAlignment)?imageAlignment:'left'});
    }else{
     if(nested?.length||element?.tagName==='FIGURE')return null;
     chunk.append(child.cloneNode(true));
    }
   }
   if(!flush())return null;
   cells.push({header:cell.tagName==='TH',paragraphs,...(images.length?{images}:{})});
  }
  if(!cells.length||matrix.length&&cells.length!==matrix[0].length)return null;
  matrix.push(cells);
 }
 return matrix.length?matrix:null;
}

export function pasteSourceTable(session:RichEditorSession,view:EditorView,event:ClipboardEvent):boolean{
 const html=event.clipboardData?.getData('text/html');
 if(!session.cellHeaders||!html||!/<table[\s>]/i.test(html))return false;
 const ends=sourceCellSelectionEnds(view.state.selection);
 const addresses=ends?.map(value=>JSON.parse(value) as [string,string,string]);
 const anchor=addresses?.[0]??axisCellAtPosition(view.state.doc,view.state.selection.from);
 const head=addresses?.[1];
 if(!anchor)return false;
 event.preventDefault();
 if(!session.editable||!view.editable||view.composing||head&&head[0]!==anchor[0])return true;
 if(!ends&&!view.state.selection.empty&&JSON.stringify(axisCellAtPosition(view.state.doc,view.state.selection.to))!==JSON.stringify(anchor))return true;
 const [tableId,rowId,columnId]=anchor,document=session.blockDocument(),order=document.axisOrder?.find(item=>item.tableId===tableId);
 if(!order)return true;
 const parsed=clipboardTable(html,view.state.schema,view.dom.ownerDocument);
 if(!parsed)return true;
 const target:RichTablePasteTarget={rows:order.rows,columns:order.columns,anchor:[rowId,columnId],...(head?{head:[head[1],head[2]]}:{})};
 const field=session.field,capture=session.replica.richBlockEditCapture(field,[tableId]);
 const textMatrix=parsed.map(row=>row.map(({header,paragraphs})=>({header,paragraphs})));
 const area=tablePasteArea(order,target,textMatrix,session.links);
 const apply=(matrix:RichTablePasteCell[][])=>{
  if(!session.applyBatch([{type:'rich-table-paste',field,capture,target,matrix}]))return true;
  const {state}=view,updated=session.blockDocument().axisOrder?.find(item=>item.tableId===tableId);
  if(updated){
   const first=JSON.stringify([tableId,updated.rows[area.top],updated.columns[area.left]]);
   const last=JSON.stringify([tableId,updated.rows[area.top+area.height-1],updated.columns[area.left+area.width-1]]);
   const selection=restoreSourceCellSelection(state.doc,[first,last]);
   if(selection)view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory',false));
  }
  return true;
 };
 const files=[...new Set(parsed.flatMap(row=>row.flatMap(cell=>(cell.images??[]).map(image=>image.file))))];
 if(!files.length){
  try{return apply(textMatrix);}catch(reason){session.fail(reason,true);return true;}
 }
 const assets=session.assets,selection=view.state.selection;
 if(!assets?.importImages)return true;
 void assets.importImages(files).then(rows=>{
  if(view.isDestroyed||!session.editable||session.assets!==assets||!view.state.selection.eq(selection))return;
  const current=session.blockDocument(),live=current.axisOrder?.find(item=>item.tableId===tableId);
  if(!live||convergenceCanonical(live)!==convergenceCanonical(order)||
     convergenceCanonical(tablePasteContents(current,live,area))!==convergenceCanonical(tablePasteContents(document,order,area)))return;
  const imported=new Map(files.map((file,i)=>[file,rows[i]]));
  const matrix:RichTablePasteCell[][]=parsed.map(row=>row.map(({images,...cell})=>({
   ...cell,...(images?{images:images.map(({file,...image})=>{
    const {sha256,mime,size}=imported.get(file)!,asset={sha256,mime,size};
    validateRichImageAsset(asset,session.imageRaster);
    return {...image,asset};
   })}:{}),
  })));
  apply(matrix);
 }).catch(()=>{});
 return true;
}
