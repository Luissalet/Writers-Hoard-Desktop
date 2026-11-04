import type {RichEditorSession} from './session';
import type {EditorState,Transaction} from '@tiptap/pm/state';
import {TextSelection} from '@tiptap/pm/state';
import {axisCellAtPosition,blockPMLeaves} from './blockProsemirror';
import {richBlockChildren} from '../convergence/blockEditing';
import {tableCellOf} from '../convergence/tableFormat';
import type {RichTableAxis} from '../convergence/tableAxesFormat';
interface View {state:EditorState;dispatch:(tr:Transaction)=>void}
export function selectedTable(session:RichEditorSession,view:View):string|undefined {
 if(session.axes)return axisCellAtPosition(view.state.doc,view.state.selection.from)?.[0];
 const data=session.blockDocument(),leaf=blockPMLeaves(view.state.doc).find(n=>n.id&&view.state.selection.from>=n.pos+1&&view.state.selection.from<=n.pos+1+n.node.content.size);let block=data.blocks.find(b=>b.id===leaf?.id);
 while(block){if(block.type==='table')return block.id;block=data.blocks.find(b=>b.id===block!.parentId);}return undefined;
}
export function insertFixedTable(session:RichEditorSession,view:View,rows=3,columns=3):boolean {
 if(!session.tables||!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||rows<1||columns<1)return false;
 const data=session.blockDocument(),leaf=blockPMLeaves(view.state.doc).find(n=>n.id&&view.state.selection.from>=n.pos+1&&view.state.selection.from<=n.pos+1+n.node.content.size),anchor=data.blocks.find(b=>b.id===leaf?.id);if(anchor&&tableCellOf(data,anchor.id))return false;
 if(session.axes){
  if(selectedTable(session,view))return false;
  const destination=anchor?{parentId:anchor.parentId,slot:anchor.slot,afterId:anchor.id}:{parentId:null,slot:'body' as const,afterId:richBlockChildren(data,null).at(-1)?.id??null};
  return session.gesture(()=>{session.beforeViewChange?.();const table={id:crypto.randomUUID(),rows:Array.from({length:rows},(_,i)=>({id:crypto.randomUUID(),header:i===0})),columns:Array.from({length:columns},()=>({id:crypto.randomUUID()}))};session.apply({type:'rich-table-create',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[],destination),table});session.afterViewChange?.();const first=blockPMLeaves(view.state.doc).find(n=>axisCellAtPosition(view.state.doc,n.pos+1)?.[0]===table.id);if(first)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,first.pos+1)).setMeta('addToHistory',false));});
 }
 const destination=anchor?{parentId:anchor.parentId,slot:anchor.slot,afterId:anchor.id}:{parentId:null,slot:'body' as const,afterId:richBlockChildren(data,null).at(-1)?.id??null},table={id:crypto.randomUUID(),columns:Array.from({length:columns},()=>crypto.randomUUID()),rows:Array.from({length:rows},()=>({id:crypto.randomUUID(),cells:[] as {id:string;columnId:string;header:boolean;paragraph:{id:string;text:string}}[]}))};
 for(const [r,row]of table.rows.entries())row.cells=table.columns.map(columnId=>({id:crypto.randomUUID(),columnId,header:r===0,paragraph:{id:crypto.randomUUID(),text:''}}));
 return session.gesture(()=>{session.beforeViewChange?.();session.apply({type:'rich-table-insert',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[],destination),table});session.afterViewChange?.();const first=blockPMLeaves(view.state.doc).find(n=>n.id===table.rows[0].cells[0].paragraph.id);if(first)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,first.pos+1)).setMeta('addToHistory',false));});
}
export function controlFixedTable(session:RichEditorSession,view:View,action:'up'|'down'|'hide'):boolean {
 const id=selectedTable(session,view);if(!id)return false;const data=session.blockDocument(),table=data.blocks.find(b=>b.id===id)!;
 return session.gesture(()=>{session.beforeViewChange?.();if(action==='hide')session.apply({type:'rich-block-hide',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[id])});else{const siblings=richBlockChildren(data,table.parentId,table.slot),at=siblings.findIndex(b=>b.id===id),after=action==='up'?at>0?siblings[at-2]?.id??null:undefined:siblings[at+1]?.id;if(after===undefined)return;const destination={parentId:table.parentId,slot:table.slot,afterId:after};session.apply({type:'rich-block-move',field:session.field,capture:session.replica.richBlockMoveCapture(session.field,id,destination)});}session.afterViewChange?.();});
}
export function controlTableAxis(session:RichEditorSession,view:View,axis:RichTableAxis,action:'before'|'after'|'hide'):boolean {
 const cell=session.axes?axisCellAtPosition(view.state.doc,view.state.selection.from):null;if(!cell)return false;
 const [tableId,rowId,columnId]=cell,id=axis==='rows'?rowId:columnId,order=session.blockDocument().axisOrder?.find(o=>o.tableId===tableId),index=order?.[axis].indexOf(id)??-1;if(!order||index<0)return false;
 return session.gesture(()=>{session.beforeViewChange?.();const capture=session.replica.richTableAxisCapture(session.field,tableId,axis,action==='before'?order[axis][index-1]??null:id);
  if(action==='hide')session.apply({type:'rich-table-axis-hide',field:session.field,capture});else session.apply({type:'rich-table-axis-insert',field:session.field,capture,id:crypto.randomUUID()});session.afterViewChange?.();});
}
export function firstTableRow(session:RichEditorSession,tableId:string){
 const data=session.blockDocument(),id=data.axisOrder?.find(table=>table.tableId===tableId)?.rows[0];
 return id===undefined?undefined:data.blocks.find(block=>block.id===id&&block.type==='table-row');
}
export function toggleTableHeader(session:RichEditorSession,view:View):boolean {
 const tableId=session.axes?selectedTable(session,view):undefined,row=tableId?firstTableRow(session,tableId):undefined;
 if(!row)return false;
 return session.gesture(()=>{
  session.beforeViewChange?.();
  const field=session.field,capture=session.replica.richBlockEditCapture(field,[row.id]);
  session.apply({type:'rich-table-row-header',field,capture,header:row.attrs.header!==true});
  session.afterViewChange?.();
 });
}
export function rejectCrossCellClipboard(session:RichEditorSession,view:View,event:ClipboardEvent):boolean {
 if(!session.axes)return false;const {from,to}=view.state.selection,a=axisCellAtPosition(view.state.doc,from),b=axisCellAtPosition(view.state.doc,to);if((a||b)&&JSON.stringify(a)!==JSON.stringify(b)){event.preventDefault();return true;}return false;
}
/** Plain multiline paste stays within one captured cell; unsupported structure is rejected whole. */
export function pasteFixedTableText(session:RichEditorSession,view:View,event:ClipboardEvent):boolean {
 if(!session.tables||!session.editable)return false;const html=event.clipboardData?.getData('text/html')??'';
 if(/<(?:table|img|video|iframe)\b/i.test(html)){event.preventDefault();return true;}
 const text=event.clipboardData?.getData('text/plain');if(text===undefined||!/[\r\n]/.test(text))return false;
 if(html.trim()){event.preventDefault();return true;}
 const {from,to}=view.state.selection,leaves=blockPMLeaves(view.state.doc),leaf=leaves.find(n=>(n.id||session.axes&&n.node.attrs.cellAddress)&&from>=n.pos+1&&to<=n.pos+1+n.node.content.size);if(!leaf||!(leaf.id&&tableCellOf(session.blockDocument(),leaf.id)||session.axes&&leaf.node.attrs.cellAddress)){event.preventDefault();return true;}
 const value=text.replaceAll('\r\n','\n').replaceAll('\r','\n');event.preventDefault();view.dispatch(view.state.tr.insertText(value,from,to));return true;
}
