import {DOMParser as ProseMirrorDOMParser,type Schema} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {TextSelection} from '@tiptap/pm/state';
import type {LocalToolStateAction} from '../stateActions';
import type {RichBlockDocument} from '../convergence/blockFormat';
import {richBlockChildren} from '../convergence/blockEditing';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import {assetBytes,assetFileMime} from '../assetFileFormat';
import {isRichImageAlignment,isRichImageSize,validateRichImageAsset} from '../convergence/imageFormat';
import {RICH_MARK_KEYS,type RichMarkValue,type RichText} from '../convergence/richTypes';
import {tablePasteArea,tablePasteContents,type RichTablePasteCell,type RichTablePasteImage,type RichTablePasteMatrix,type RichTablePasteTarget} from '../convergence/tablePaste';
import {areaContains,tableSpans} from '../convergence/tableSpanGeometry';
import {convergenceCanonical} from '../convergence/format';
import {axisCellAtPosition,blockPMLeaves} from './blockProsemirror';
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

function clipboardTable(html:string,schema:Schema,document:Document,allowSpans:boolean):(ClipboardCell|null)[][]|null{
 const template=document.createElement('template');
 template.innerHTML=html;
 const tables=template.content.querySelectorAll('table');
 if(tables.length!==1)return null;
 const table=tables[0],parser=ProseMirrorDOMParser.fromSchema(schema),matrix:(ClipboardCell|null)[][]=Array.from(table.rows,()=>[]),files=new Map<string,File>();
 if(!matrix.length)return null;
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
 for(const [y,row] of Array.from(table.rows).entries()){
  let x=0;
  for(const cell of Array.from(row.cells)){
   while(matrix[y][x]!==undefined)x++;
   const rows=cell.rowSpan,columns=cell.colSpan,merged=rows!==1||columns!==1;
   if(merged&&!allowSpans||rows<1||y+rows>matrix.length||cell.querySelector('picture,video,audio,iframe,object,embed,svg'))return null;
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
   for(let r=y;r<y+rows;r++)for(let c=x;c<x+columns;c++){
    if(matrix[r][c]!==undefined)return null;
    matrix[r][c]=null;
   }
   matrix[y][x]={header:cell.tagName==='TH',paragraphs,...(merged?{span:{rows,columns}}:{}),...(images.length?{images}:{})};
   x+=columns;
  }
 }
 const width=matrix[0].length;
 return width&&matrix.every(row=>row.length===width&&Array.from(row).every(cell=>cell!==undefined))?matrix:null;
}

function clipboardCaret(view:EditorView):number {
 const selection=view.dom.ownerDocument.getSelection(),node=selection?.anchorNode;
 if(!view.hasFocus()||!selection?.isCollapsed||!node||!view.dom.contains(node))return view.state.selection.from;
 // A paste can arrive before the editor has observed the latest DOM caret movement.
 try{return view.posAtDOM(node,selection.anchorOffset);}catch{return view.state.selection.from;}
}

function pasteNewSourceTable(session:RichEditorSession,view:EditorView,data:RichBlockDocument,parsed:(ClipboardCell|null)[][],textMatrix:RichTablePasteMatrix):boolean{
 const {state}=view,field=session.field;
 const from=clipboardCaret(view),insideTable=!!axisCellAtPosition(state.doc,from);
 const actions:LocalToolStateAction[]=[];
 let afterId:string|null=null;
 if(!insideTable){
  const leaf=blockPMLeaves(state.doc).find(item=>from>=item.pos+1&&from<=item.pos+1+item.node.content.size);
  if(!leaf||leaf.node.type.name!=='paragraph')return true;
  const block=data.blocks.find(item=>item.id===leaf.id);
  if(block?.parentId!==null&&data.blocks.length)return true;
  if(block){
   const offset=from-leaf.pos-1;
   const siblings=richBlockChildren(data,null),at=siblings.findIndex(item=>item.id===block.id);
   if(at<0)return true;
   afterId=offset===0?siblings[at-1]?.id??null:block.id;
   if(offset>0&&offset<leaf.node.content.size)actions.push({
    type:'rich-block-split',field,capture:session.replica.richBlockSplitCapture(field,block.id,offset),newNodeId:crypto.randomUUID(),
   });
  }
 }
 const table={id:crypto.randomUUID(),rows:parsed.map(()=>({id:crypto.randomUUID(),header:false})),columns:parsed[0].map(()=>({id:crypto.randomUUID()}))};
 const capture=session.replica.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId});
 return applyTableClipboard(session,view,parsed,textMatrix,matrix=>{
  if(!session.applyBatch([...actions,{type:'rich-table-create',field,capture,table,matrix}]))return true;
  const current=view.state;
  const first=blockPMLeaves(current.doc).find(item=>axisCellAtPosition(current.doc,item.pos+1)?.[0]===table.id);
  if(first)view.dispatch(current.tr.setSelection(TextSelection.create(current.doc,first.pos+1)).setMeta('addToHistory',false));
  return true;
 },()=>view.state.selection.empty&&clipboardCaret(view)===from&&convergenceCanonical(session.blockDocument())===convergenceCanonical(data));
}

export function pasteSourceTable(session:RichEditorSession,view:EditorView,event:ClipboardEvent):boolean{
 const html=event.clipboardData?.getData('text/html');
 if(!session.cellHeaders||!html||!/<table[\s>]/i.test(html))return false;
 const ends=sourceCellSelectionEnds(view.state.selection);
 const addresses=ends?.map(value=>JSON.parse(value) as [string,string,string]);
 const anchor=addresses?.[0]??axisCellAtPosition(view.state.doc,view.state.selection.from);
 const head=addresses?.[1];
 if(!anchor&&!session.cellSpans)return false;
 event.preventDefault();
 if(!session.editable||!view.editable||view.composing||head&&head[0]!==anchor?.[0])return true;
 const selection=view.state.selection;
 if(!ends&&!selection.empty&&JSON.stringify(axisCellAtPosition(view.state.doc,selection.to))!==JSON.stringify(anchor))return true;
 const data=session.blockDocument(),parsed=clipboardTable(html,view.state.schema,view.dom.ownerDocument,session.cellSpans);
 if(!parsed)return true;
 const textMatrix=parsed.map(row=>row.map(cell=>cell?{header:cell.header,paragraphs:cell.paragraphs,...(cell.span?{span:cell.span}:{})}:null));
 if(!head&&parsed.some(row=>row.some(cell=>cell?.span))){
  if(!selection.empty)return true;
  try{return pasteNewSourceTable(session,view,data,parsed,textMatrix);}
  catch(reason){session.fail(reason,true);return true;}
 }
 if(!anchor)return true;
 const [tableId,rowId,columnId]=anchor,order=data.axisOrder?.find(item=>item.tableId===tableId);
 if(!order)return true;
 const target:RichTablePasteTarget={rows:order.rows,columns:order.columns,anchor:[rowId,columnId],...(head?{head:[head[1],head[2]]}:{})};
 const field=session.field,capture=session.replica.richBlockEditCapture(field,[tableId]);
 let area;
 try{area=tablePasteArea(order,target,textMatrix,session.links,session.cellSpans?data:undefined);}catch{return true;}
 const apply=(matrix:RichTablePasteMatrix)=>{
  if(!session.applyBatch([{type:'rich-table-paste',field,capture,target,matrix}]))return true;
  const {state}=view,current=session.blockDocument(),updated=current.axisOrder?.find(item=>item.tableId===tableId);
  if(updated){
   const spans=session.cellSpans?tableSpans(updated,current.blocks):[];
   const address=(top:number,left:number)=>{
    const span=spans.find(item=>areaContains(item.area,{top,left,height:1,width:1}))?.area;
    return JSON.stringify([tableId,updated.rows[span?.top??top],updated.columns[span?.left??left]]);
   };
   const first=address(area.top,area.left),last=address(area.top+area.height-1,area.left+area.width-1);
   const selection=restoreSourceCellSelection(state.doc,[first,last]);
   if(selection)view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory',false));
  }
  return true;
 };
 return applyTableClipboard(session,view,parsed,textMatrix,apply,()=>{
  const current=session.blockDocument(),live=current.axisOrder?.find(item=>item.tableId===tableId);
  return view.state.selection.eq(selection)&&!!live&&convergenceCanonical(live)===convergenceCanonical(order)&&
   convergenceCanonical(tablePasteContents(current,live,area))===convergenceCanonical(tablePasteContents(data,order,area));
 });
}

function applyTableClipboard(session:RichEditorSession,view:EditorView,parsed:(ClipboardCell|null)[][],textMatrix:RichTablePasteMatrix,apply:(matrix:RichTablePasteMatrix)=>boolean,stillCurrent:()=>boolean):boolean{
 const files=[...new Set(parsed.flatMap(row=>row.flatMap(cell=>(cell?.images??[]).map(image=>image.file))))];
 if(!files.length){
  try{return apply(textMatrix);}catch(reason){session.fail(reason,true);return true;}
 }
 const assets=session.assets;
 if(!assets?.importImages)return true;
 void assets.importImages(files).then(rows=>{
  if(view.isDestroyed||!session.editable||session.assets!==assets)return;
  if(!stillCurrent())return;
  const imported=new Map(files.map((file,i)=>[file,rows[i]]));
  const matrix:RichTablePasteMatrix=parsed.map(row=>row.map(value=>{
   if(!value)return null;
   const {images,...cell}=value;
   return {...cell,...(images?{images:images.map(({file,...image})=>{
    const {sha256,mime,size}=imported.get(file)!,asset={sha256,mime,size};
    validateRichImageAsset(asset,session.imageRaster);
    return {...image,asset};
   })}:{})};
  }));
  apply(matrix);
 }).catch(()=>{});
 return true;
}
