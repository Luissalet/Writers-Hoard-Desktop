import {clipboardParagraphRuns,inlineCells,richInlineFormat,matchInlineLinks,type InlineFormat} from './inlineFormatting';
import {localToolStateEqual} from '../stateActions';
import type {Node as PMNode,Slice} from '@tiptap/pm/model';
import type {EditorState,Transaction} from '@tiptap/pm/state';
import {AllSelection,TextSelection} from '@tiptap/pm/state';
import {ReplaceStep,AddMarkStep,RemoveMarkStep} from '@tiptap/pm/transform';
import type {EditorView} from '@tiptap/pm/view';
import type {RichEditorSession} from './session';
import {axisCellAtPosition,blockPMDocument,blockPMLeaves} from './blockProsemirror';
import {RICH_MARKS,type RichMark,type RichParagraph,type RichText} from '../convergence/richTypes';
import {richBlockChildren} from '../convergence/blockEditing';

const signature=(doc:PMNode,withoutIds=false):unknown=>{const json=doc.toJSON();const walk=(node:Record<string,unknown>):unknown=>({type:node.type,...(node.attrs?{attrs:Object.fromEntries(Object.entries(node.attrs as Record<string,unknown>).filter(([key])=>!withoutIds||key!=='id'&&!(key==='cellAddress'&&node.type==='paragraph')))}:{}),content:(Array.isArray(node.content)?node.content as Record<string,unknown>[]:[]).filter(n=>n.type!=='text').map(walk)});return walk(json);};

/** Admit a full-document paragraph paste as one reversible edit. */
export function pasteSelectedRootParagraphs(session:RichEditorSession,view:EditorView,event:ClipboardEvent,slice:Slice):boolean {
 const {state}=view,paragraph=state.doc.firstChild,incoming=slice.content.firstChild;
 if(!session.editable||!view.editable||view.composing||!(state.selection instanceof AllSelection)||!incoming)return false;
 const html=event.clipboardData?.getData('text/html')??'';
 if(/<(?:table|img|picture|video|audio|iframe|object|embed|svg)\b/i.test(html)||event.clipboardData?.files.length)return false;
 if(state.doc.childCount===1&&paragraph?.type.name==='paragraph'&&slice.content.childCount===1&&incoming.type===paragraph.type){
  const tr=state.tr.replaceWith(1,1+paragraph.content.size,incoming.content);
  tr.setSelection(TextSelection.create(tr.doc,1+incoming.content.size));
  event.preventDefault();
  view.dispatch(tr.setMeta('paste',true).setMeta('uiEvent','paste').scrollIntoView());
  return true;
 }
 const paragraphs:RichParagraph[]=[];
 for(let index=0;index<slice.content.childCount;index++){
  const content=clipboardParagraphRuns(slice.content.child(index));
  if(!content)return false;
  paragraphs.push({id:crypto.randomUUID(),type:'paragraph',content});
 }
 const roots=richBlockChildren(session.blockDocument(),null);
 if(roots.length?state.doc.childCount!==roots.length||roots.some((block,index)=>state.doc.child(index).attrs.id!==block.id):
    state.doc.childCount!==1||paragraph?.type.name!=='paragraph'||paragraph.attrs.id!==null)return false;
 event.preventDefault();
 const {field,replica}=session;
 try{
  const capture=replica.richBlockEditCapture(field,roots.map(block=>block.id),{parentId:null,slot:'body',afterId:null});
  if(session.applyBatch([{type:'rich-block-replace-with-paragraphs',field,capture,paragraphs}])){
   const last=blockPMLeaves(view.state.doc).find(leaf=>leaf.id===paragraphs.at(-1)!.id);
   if(last)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,last.pos+1+last.node.content.size)).scrollIntoView());
  }
 }catch(error){session.fail(error,true);}
 return true;
}

/** Paste two or more paragraphs at a collapsed caret in a root paragraph as one reversible gesture. */
export function pasteRootParagraphsAtCaret(session:RichEditorSession,view:EditorView,event:ClipboardEvent,slice:Slice):boolean {
 const {state}=view,{selection}=state;
 if(!session.editable||!view.editable||view.composing||!selection.empty||slice.content.childCount<2||axisCellAtPosition(state.doc,selection.from))return false;
 const html=event.clipboardData?.getData('text/html')??'';
 if(/<(?:table|img|picture|video|audio|iframe|object|embed|svg)\b/i.test(html)||event.clipboardData?.files.length)return false;
 const leaf=blockPMLeaves(state.doc).find(item=>selection.from>=item.pos+1&&selection.from<=item.pos+1+item.node.content.size);
 if(!leaf?.id||leaf.node.type.name!=='paragraph')return false;
 const data=session.blockDocument(),block=data.blocks.find(item=>item.id===leaf.id);
 if(!block||block.type!=='paragraph'||block.parentId!==null||block.slot!=='body')return false;
 const incoming:RichText[][]=[];
 for(let index=0;index<slice.content.childCount;index++){const runs=clipboardParagraphRuns(slice.content.child(index));if(!runs)return false;incoming.push(runs);}
 const offset=selection.from-leaf.pos-1,length=leaf.node.content.size,field=session.field,{replica}=session;
 const roots=richBlockChildren(data,null),at=roots.findIndex(item=>item.id===block.id);
 if(at<0)return false;
 event.preventDefault();
 const ids=incoming.map(()=>crypto.randomUUID());
 const insertRuns=(id:string,start:number,runs:RichText[])=>{
  let position=start;
  for(const run of runs){
   const link=run.marks?.find(mark=>mark.type==='link'),marks=(run.marks??[]).filter(mark=>mark.type!=='link').map(mark=>mark.type) as RichMark[];
   session.apply({type:'rich-text-splice',field,nodeId:id,range:replica.richRange(field,id,position,position),text:run.text,marks,...(link?.type==='link'?{link:{href:link.attrs.href}}:{})});
   position+=run.text.length;
  }
  return position;
 };
 const addBlock=(id:string,afterId:string|null)=>session.apply({type:'rich-block-insert',field,capture:replica.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId}),block:{id,type:'paragraph',attrs:{}},text:''});
 let caret:{id:string;position:number}|undefined;
 session.gesture(()=>{
  session.beforeViewChange?.();
  const last=incoming.length-1;
  if(offset===0){
   // The paragraph keeps its identity as the last pasted paragraph and its whole text becomes the suffix.
   let afterId=roots[at-1]?.id??null;
   for(let index=0;index<last;index++){addBlock(ids[index],afterId);afterId=ids[index];insertRuns(ids[index],0,incoming[index]);}
   caret={id:block.id,position:insertRuns(block.id,0,incoming[last])};
  }else{
   let previous=block.id;const lastId=ids[last];
   if(offset<length)session.apply({type:'rich-block-split',field,capture:replica.richBlockSplitCapture(field,block.id,offset),newNodeId:lastId});
   insertRuns(block.id,offset,incoming[0]);
   for(let index=1;index<last;index++){addBlock(ids[index],previous);previous=ids[index];insertRuns(ids[index],0,incoming[index]);}
   if(offset===length)addBlock(lastId,previous);
   caret={id:lastId,position:insertRuns(lastId,0,incoming[last])};
  }
  session.afterViewChange?.();
  const target=blockPMLeaves(view.state.doc).find(item=>item.id===caret!.id);
  if(target)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,target.pos+1+caret!.position)).scrollIntoView());
 });
 return true;
}

/** Preflight the complete accepted shape before the first public text mutation. */
export function authorBlockTransaction(session:RichEditorSession,tr:Transaction):void {
 if(!tr.docChanged)return;
 const target=blockPMDocument(tr.before.type.schema,session.blockDocument());if(!tr.before.eq(target))throw Error('local_tool_blocks_editor_admission_branch');
 const before=blockPMLeaves(tr.before),after=blockPMLeaves(tr.doc);
 if(!localToolStateEqual(signature(tr.before),signature(tr.doc)))throw Error('local_tool_blocks_editor_structural_step_unsupported');
 if(before.length!==after.length)throw Error('local_tool_blocks_editor_translation_invalid');
 let ids=before.map(n=>n.id);
 const exact=tr.steps.map((step,index)=>{
  if(step instanceof AddMarkStep||step instanceof RemoveMarkStep)return null;if(!(step instanceof ReplaceStep))throw Error('local_tool_blocks_editor_step_unsupported');
  const rows=blockPMLeaves(tr.docs[index]),at=rows.findIndex(n=>step.from>=n.pos+1&&step.to<=n.pos+1+n.node.content.size);if(at<0)throw Error('local_tool_blocks_editor_structural_step_unsupported');
  let content=step.slice.content;if(step.slice.openStart!==step.slice.openEnd)throw Error('local_tool_blocks_editor_structural_step_unsupported');for(let i=0;i<step.slice.openStart;i++){if(content.childCount!==1)throw Error('local_tool_blocks_editor_structural_step_unsupported');content=content.firstChild!.content;}
  const inline=rows[at].node.type.create(rows[at].node.attrs,content);return{at,from:step.from-rows[at].pos-1,to:step.to-rows[at].pos-1,value:inline.textContent,marks:inlineCells(inline,session.links)};
 });
 if(session.axes){
  const changed=after.map((leaf,i)=>leaf.node.content.eq(before[i].node.content)?-1:i).filter(i=>i>=0),first=changed.find(i=>!before[i].id&&typeof before[i].node.attrs.cellAddress==='string');
  if(first!==undefined){
   const address=axisCellAtPosition(tr.before,before[first].pos+1),leaf=after[first].node,formats=inlineCells(leaf,session.links),format=formats[0];
   if(changed.length!==1||!address||!leaf.textContent||before[first].node.content.size||JSON.stringify(address)!==before[first].node.attrs.cellAddress||formats.some(f=>JSON.stringify(f)!==JSON.stringify(format)))throw Error('local_tool_table_cell_input_invalid');
   const capture=session.replica.richTableCellCapture(session.field,...address);session.assertTableCellCommit(capture);
   session.apply({type:'rich-table-cell-insert',field:session.field,capture,fragment:{id:crypto.randomUUID(),paragraph:{id:crypto.randomUUID(),text:leaf.textContent,...(format?.marks.length?{marks:format.marks}:{}),...(format?.link?{link:format.link}:{})}}});return;
  }
 }
 if(!session.blockDocument().blocks.length||session.axes&&before.length===1&&!before[0].id&&!before[0].node.attrs.cellAddress){
  if(after.length!==1||after[0].node.type.name!=='paragraph')throw Error('local_tool_blocks_editor_empty_view');const id=crypto.randomUUID();session.apply({type:'rich-block-insert',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[],{parentId:null,slot:'body',afterId:null}),block:{id,type:'paragraph',attrs:{}},text:''});ids=[id];
 }
 for(const splice of exact){if(!splice)continue;const id=ids[splice.at];if(!id)throw Error('local_tool_blocks_editor_identity_missing');let at=0,removed=false;while(at<splice.value.length){let to=at+1;while(to<splice.value.length&&JSON.stringify(splice.marks[to])===JSON.stringify(splice.marks[at]))to++;session.apply({type:'rich-text-splice',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,splice.from+at,removed?splice.from+at:splice.to),text:splice.value.slice(at,to),marks:splice.marks[at].marks,...(splice.marks[at].link?{link:splice.marks[at].link}:{})});removed=true;at=to;}if(!removed&&splice.to>splice.from)session.apply({type:'rich-text-splice',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,splice.from,splice.to),text:''});}
 for(let n=0;n<after.length;n++){
  const id=ids[n];if(!id&&session.axes&&after[n].node.attrs.cellAddress&&!after[n].node.content.size)continue;if(!id)throw Error('local_tool_blocks_editor_identity_missing');const want=inlineCells(after[n].node,session.links);
  const actual=session.blockDocument().blocks.find(b=>b.id===id)!,have:InlineFormat[]=[];for(const text of actual.content!)for(let i=0;i<text.text.length;i++)have.push(richInlineFormat(text.marks));
  for(const mark of RICH_MARKS){let index=0;while(index<want.length){const enabled=want[index].marks.includes(mark);if(have[index].marks.includes(mark)===enabled){index++;continue;}let to=index+1;while(to<want.length&&want[to].marks.includes(mark)===enabled&&have[to].marks.includes(mark)!==enabled)to++;session.apply({type:'rich-mark',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,index,to),mark,enabled});index=to;}}
  matchInlineLinks(session,id,want,have);
 }
}
export function normalizeBlockIds(session:RichEditorSession,tr:Transaction):Transaction {
 const target=blockPMDocument(tr.doc.type.schema,session.blockDocument());if(!localToolStateEqual(signature(tr.doc,true),signature(target,true))||tr.doc.textContent!==target.textContent)throw Error('local_tool_blocks_editor_normalization_invalid');
 const wanted=new Map<number,PMNode>();target.descendants((node,pos)=>{wanted.set(pos,node);});
 tr.doc.descendants((node,pos)=>{const next=wanted.get(pos);if(next&&node.type===next.type&&(node.attrs.id!==next.attrs.id||node.attrs.cellAddress!==next.attrs.cellAddress))tr.setNodeMarkup(pos,undefined,next.attrs);});
 if(!tr.doc.eq(target))throw Error('local_tool_blocks_editor_normalization_invalid');return tr;
}
export function blockCompositionTransaction(before:EditorState,after:EditorState):Transaction {
 const tr=before.tr,from=before.doc.content.findDiffStart(after.doc.content);if(from!==null){const end=before.doc.content.findDiffEnd(after.doc.content);if(!end)throw Error('local_tool_blocks_editor_composition_invalid');const overlap=from-Math.min(end.a,end.b);tr.replace(from,end.a+Math.max(0,overlap),after.doc.slice(from,end.b+Math.max(0,overlap)));}return tr;
}
