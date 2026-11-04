import {DOMParser as ProseMirrorDOMParser,type Schema} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import {RICH_MARK_KEYS,type RichMarkValue,type RichText} from '../convergence/richTypes';
import {tablePasteArea,type RichTablePasteCell,type RichTablePasteTarget} from '../convergence/tablePaste';
import {axisCellAtPosition} from './blockProsemirror';
import {restoreSourceCellSelection,sourceCellSelectionEnds} from './tableCellSelection';
import type {RichEditorSession} from './session';

function clipboardTable(html:string,schema:Schema,document:Document):RichTablePasteCell[][]|null{
 const template=document.createElement('template');
 template.innerHTML=html;
 const tables=template.content.querySelectorAll('table');
 if(tables.length!==1)return null;
 const table=tables[0],parser=ProseMirrorDOMParser.fromSchema(schema),matrix:RichTablePasteCell[][]=[];
 for(const row of Array.from(table.rows)){
  const cells:RichTablePasteCell[]=[];
  for(const cell of Array.from(row.cells)){
   if(cell.colSpan!==1||cell.rowSpan!==1||cell.querySelector('img,figure,picture,video,audio,iframe,object,embed'))return null;
   const parsed=parser.parse(cell),paragraphs:RichText[][]=[];
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
   cells.push({header:cell.tagName==='TH',paragraphs});
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
 const [tableId,rowId,columnId]=anchor,order=session.blockDocument().axisOrder?.find(item=>item.tableId===tableId);
 if(!order)return true;
 const matrix=clipboardTable(html,view.state.schema,view.dom.ownerDocument);
 if(!matrix)return true;
 const target:RichTablePasteTarget={rows:order.rows,columns:order.columns,anchor:[rowId,columnId],...(head?{head:[head[1],head[2]]}:{})};
 const area=tablePasteArea(order,target,matrix,session.links);
 try{
  const field=session.field,capture=session.replica.richBlockEditCapture(field,[tableId]);
  if(!session.applyBatch([{type:'rich-table-paste',field,capture,target,matrix}]))return true;
  const {state}=view,updated=session.blockDocument().axisOrder?.find(item=>item.tableId===tableId);
  if(updated){
   const first=JSON.stringify([tableId,updated.rows[area.top],updated.columns[area.left]]);
   const last=JSON.stringify([tableId,updated.rows[area.top+area.height-1],updated.columns[area.left+area.width-1]]);
   const selection=restoreSourceCellSelection(state.doc,[first,last]);
   if(selection)view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory',false));
  }
 }catch(reason){session.fail(reason,true);}
 return true;
}
