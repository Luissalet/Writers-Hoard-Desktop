import {Extension} from '@tiptap/core';
import type {Node as PMNode} from '@tiptap/pm/model';
import {Plugin,Selection} from '@tiptap/pm/state';
import {CellSelection,cellAround,inSameTable} from '@tiptap/pm/tables';
import {Decoration,DecorationSet,type EditorView} from '@tiptap/pm/view';
import type {RichAction} from '../convergence/richTypes';
import type {RichBlockEditingAction} from '../convergence/blockEditingTypes';
import {isRichImageAlignment,isRichImageSize} from '../convergence/imageFormat';
import {sourceImageClipboardData} from './imageClipboardData';
import type {RichEditorSession} from './session';
import {RICH_INTERNAL} from './prosemirror';

const roles={table:'table',tableRow:'row',tableCell:'cell',tableHeader:'header_cell'} as const;
type CellEnds=readonly [string,string];

export function sourceCellSelectionEnds(selection:Selection):CellEnds|null {
 if(!(selection instanceof CellSelection))return null;
 const anchor=selection.$anchorCell.nodeAfter?.attrs.cellAddress,head=selection.$headCell.nodeAfter?.attrs.cellAddress;
 return typeof anchor==='string'&&typeof head==='string'?[anchor,head]:null;
}

export function restoreSourceCellSelection(doc:PMNode,[anchor,head]:CellEnds):Selection|null {
 let a:number|undefined,h:number|undefined;
 doc.descendants((node,pos)=>{
  if(node.type.spec.tableRole!=='cell'&&node.type.spec.tableRole!=='header_cell')return;
  if(node.attrs.cellAddress===anchor)a=pos;
  if(node.attrs.cellAddress===head)h=pos;
  return false;
 });
 if(a!==undefined&&h!==undefined)return CellSelection.create(doc,a,h);
 const remaining=a??h;
 return remaining===undefined?null:Selection.near(doc.resolve(remaining+1));
}

function cleanSourceCellClipboard(dom:HTMLElement){
 for(const cell of dom.querySelectorAll('td,th'))if(!cell.childElementCount)cell.append(dom.ownerDocument.createElement('p'));
 for(const element of dom.querySelectorAll('*'))for(const attribute of element.getAttributeNames()){
  if(attribute.startsWith('data-writer-')||['id','columns','columnid'].includes(attribute))element.removeAttribute(attribute);
 }
}

function writeSourceCellClipboard(view:EditorView,selection:CellSelection,clipboard:DataTransfer,images:PMNode[]):boolean {
 const {dom,text}=view.serializeForClipboard(selection.content());
 const placeholders=Array.from(dom.querySelectorAll('[data-writer-rich-image]'));
 if(images.length){
  if(placeholders.length!==images.length)return false;
  const figures=new Map(Array.from(view.dom.querySelectorAll<HTMLElement>('figure[data-writer-image]'),element=>[element.getAttribute('data-writer-image'),element]));
  for(const [index,placeholder] of placeholders.entries()){
   const {id,displaySize,alignment}=images[index].attrs,figure=figures.get(id);
   const source=figure&&sourceImageClipboardData.get(figure);
   if(!source)return false;
   const image=dom.ownerDocument.createElement('img');
   image.setAttribute('src',source);
   image.setAttribute('alt','');
   if(isRichImageSize(displaySize))image.dataset.imageSize=displaySize;
   if(isRichImageAlignment(alignment))image.dataset.imageAlignment=alignment;
   placeholder.replaceWith(image);
  }
 }else for(const placeholder of placeholders)placeholder.remove();
 cleanSourceCellClipboard(dom);
 const html=dom.innerHTML;
 try{
  clipboard.clearData();
  clipboard.setData('text/html',html);
  clipboard.setData('text/plain',text);
  return clipboard.getData('text/html')===html&&clipboard.getData('text/plain')===text;
 }catch{return false;}
}

function selectedSourceImages(selection:CellSelection):PMNode[]{
 const images:PMNode[]=[];
 selection.content().content.descendants(node=>{if(node.type.name==='richImage')images.push(node);});
 return images;
}

export function copySourceCellSelection(view:EditorView,event:ClipboardEvent,session?:RichEditorSession):boolean {
 const selection=view.state.selection;
 if(!(selection instanceof CellSelection)||!sourceCellSelectionEnds(selection))return false;
 event.preventDefault();
 const images=session?.imageCells?selectedSourceImages(selection):[];
 if(event.clipboardData)writeSourceCellClipboard(view,selection,event.clipboardData,images);
 return true;
}

export function cutSourceCellSelection(session:RichEditorSession,view:EditorView,event:ClipboardEvent):boolean {
 const selection=view.state.selection,ends=sourceCellSelectionEnds(selection);
 if(!(selection instanceof CellSelection)||!ends)return false;
 event.preventDefault();
 if(!session.editable||!view.editable||view.composing)return true;
 const images=session.imageCells?selectedSourceImages(selection):[];
 if(!event.clipboardData||!writeSourceCellClipboard(view,selection,event.clipboardData,images))return true;
 clearSourceCellSelection(session,view,selection,images);
 return true;
}

function clearSourceCellSelection(session:RichEditorSession,view:EditorView,selection:CellSelection,images:PMNode[]){
 const leaves:{id:string;length:number}[]=[];
 let unsupported=false;
 selection.forEachCell(cell=>cell.descendants(node=>{
  if(node.type.name==='richImage')return false;
  if(!node.isTextblock||!node.content.size)return;
  if(typeof node.attrs.id!=='string'){unsupported=true;return false;}
  leaves.push({id:node.attrs.id,length:node.content.size});
  return false;
 }));
 if(unsupported)return;
 try{
  const field=session.field,actions:(RichAction|RichBlockEditingAction)[]=leaves.map(({id,length})=>({
   type:'rich-text-splice',field,nodeId:id,range:session.replica.richRange(field,id,0,length),text:'',
  }));
  if(images.length)actions.push({type:'rich-block-hide',field,capture:session.replica.richBlockEditCapture(field,images.map(image=>String(image.attrs.id)))});
  if(!actions.length||!session.applyBatch(actions))return;
  const {state}=view,current=state.selection;
  if(current instanceof CellSelection){
   const caret=Selection.near(state.doc.resolve(current.$headCell.pos+1));
   view.dispatch(state.tr.setSelection(caret).setMeta('addToHistory',false));
  }
 }catch(reason){session.fail(reason,true);}
}

/** Use ProseMirror's selection type without adding generic table writers to Source. */
export const sourceTableCellSelection=Extension.create({
 name:'writerSourceTableCellSelection',
 extendNodeSchema(extension){return Object.hasOwn(roles,extension.name)?{tableRole:roles[extension.name as keyof typeof roles]}:{};},
 addProseMirrorPlugins(){return[new Plugin({
  filterTransaction(tr,state){return !(state.selection instanceof CellSelection)||!tr.docChanged||!!tr.getMeta(RICH_INTERNAL);},
  props:{
   handleDOMEvents:{mousedown(view,event){
    if(event.button!==0||event.altKey||event.metaKey||event.ctrlKey||!view.editable)return false;
    const {state}=view,previous=state.selection;
    if(!event.shiftKey){
     if(previous instanceof CellSelection){
      const point=view.posAtCoords({left:event.clientX,top:event.clientY});
      const caret=Selection.near(state.doc.resolve(point?.pos??previous.$headCell.pos+1));
      view.dispatch(state.tr.setSelection(caret).setMeta('addToHistory',false));
     }
     return false;
    }
    const dom=event.target instanceof Element?event.target.closest('td[data-writer-cell-address],th[data-writer-cell-address]'):null;
    if(!dom||!view.dom.contains(dom))return false;
    const anchor=previous instanceof CellSelection?previous.$anchorCell:cellAround(previous.$anchor);
    const head=cellAround(state.doc.resolve(view.posAtDOM(dom,0)));
    if(!anchor||!head||!inSameTable(anchor,head)||!(previous instanceof CellSelection)&&anchor.pos===head.pos)return false;
    event.preventDefault();
    view.dispatch(state.tr.setSelection(new CellSelection(anchor,head)).setMeta('addToHistory',false));
    view.focus();return true;
   }},
   handleKeyDown(view,event){
    const {state}=view,selection=state.selection;
    if(event.key!=='Escape'||!(selection instanceof CellSelection))return false;
    view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(selection.$headCell.pos+1))).setMeta('addToHistory',false));
    return true;
   },
   decorations(state){
    if(!(state.selection instanceof CellSelection))return null;
    const cells:Decoration[]=[];
    state.selection.forEachCell((node,pos)=>cells.push(Decoration.node(pos,pos+node.nodeSize,{class:'selectedCell outline outline-2 -outline-offset-2 outline-accent-gold/70'})));
    return DecorationSet.create(state.doc,cells);
   },
  },
 })];},
});
