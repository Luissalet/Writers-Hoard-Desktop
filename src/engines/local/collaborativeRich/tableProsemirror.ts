import type {RichEditorSession} from './session';
import type {EditorState,Transaction} from '@tiptap/pm/state';
import {TextSelection} from '@tiptap/pm/state';
import {blockPMLeaves} from './blockProsemirror';
import {richBlockChildren} from '../convergence/blockEditing';
import {tableCellOf} from '../convergence/tableFormat';
interface View {state:EditorState;dispatch:(tr:Transaction)=>void}
export function selectedTable(session:RichEditorSession,view:View):string|undefined {
 const data=session.blockDocument(),leaf=blockPMLeaves(view.state.doc).find(n=>n.id&&view.state.selection.from>=n.pos+1&&view.state.selection.from<=n.pos+1+n.node.content.size);let block=data.blocks.find(b=>b.id===leaf?.id);
 while(block){if(block.type==='table')return block.id;block=data.blocks.find(b=>b.id===block!.parentId);}return undefined;
}
export function insertFixedTable(session:RichEditorSession,view:View,rows=3,columns=3):boolean {
 if(!session.tables||!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||rows<1||columns<1)return false;
 const data=session.blockDocument(),leaf=blockPMLeaves(view.state.doc).find(n=>n.id&&view.state.selection.from>=n.pos+1&&view.state.selection.from<=n.pos+1+n.node.content.size),anchor=data.blocks.find(b=>b.id===leaf?.id);if(anchor&&tableCellOf(data,anchor.id))return false;
 const destination=anchor?{parentId:anchor.parentId,slot:anchor.slot,afterId:anchor.id}:{parentId:null,slot:'body' as const,afterId:richBlockChildren(data,null).at(-1)?.id??null},table={id:crypto.randomUUID(),columns:Array.from({length:columns},()=>crypto.randomUUID()),rows:Array.from({length:rows},()=>({id:crypto.randomUUID(),cells:[] as {id:string;columnId:string;header:boolean;paragraph:{id:string;text:string}}[]}))};
 for(const [r,row]of table.rows.entries())row.cells=table.columns.map(columnId=>({id:crypto.randomUUID(),columnId,header:r===0,paragraph:{id:crypto.randomUUID(),text:''}}));
 return session.gesture(()=>{session.beforeViewChange?.();session.apply({type:'rich-table-insert',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[],destination),table});session.afterViewChange?.();const first=blockPMLeaves(view.state.doc).find(n=>n.id===table.rows[0].cells[0].paragraph.id);if(first)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,first.pos+1)).setMeta('addToHistory',false));});
}
export function controlFixedTable(session:RichEditorSession,view:View,action:'up'|'down'|'hide'):boolean {
 const id=selectedTable(session,view);if(!id)return false;const data=session.blockDocument(),table=data.blocks.find(b=>b.id===id)!;
 return session.gesture(()=>{session.beforeViewChange?.();if(action==='hide')session.apply({type:'rich-block-hide',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[id])});else{const siblings=richBlockChildren(data,table.parentId,table.slot),at=siblings.findIndex(b=>b.id===id),after=action==='up'?at>0?siblings[at-2]?.id??null:undefined:siblings[at+1]?.id;if(after===undefined)return;const destination={parentId:table.parentId,slot:table.slot,afterId:after};session.apply({type:'rich-block-move',field:session.field,capture:session.replica.richBlockMoveCapture(session.field,id,destination)});}session.afterViewChange?.();});
}
/** Plain multiline paste stays within one captured cell; unsupported structure is rejected whole. */
export function pasteFixedTableText(session:RichEditorSession,view:View,event:ClipboardEvent):boolean {
 if(!session.tables||!session.editable)return false;const html=event.clipboardData?.getData('text/html')??'';
 if(/<(?:table|img|video|iframe)\b/i.test(html)){event.preventDefault();return true;}
 const text=event.clipboardData?.getData('text/plain');if(text===undefined||!/[\r\n]/.test(text))return false;
 if(html.trim()){event.preventDefault();return true;}
 const {from,to}=view.state.selection,leaves=blockPMLeaves(view.state.doc),leaf=leaves.find(n=>n.id&&from>=n.pos+1&&to<=n.pos+1+n.node.content.size);if(!leaf?.id||!tableCellOf(session.blockDocument(),leaf.id)){event.preventDefault();return true;}
 const value=text.replaceAll('\r\n','\n').replaceAll('\r','\n');event.preventDefault();view.dispatch(view.state.tr.insertText(value,from,to));return true;
}
