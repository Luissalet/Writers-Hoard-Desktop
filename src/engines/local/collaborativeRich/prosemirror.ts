import {isLocalToolRichBlockField} from '../stateCodec';
import {inlineCells,richInlineFormat,matchInlineLinks,type InlineFormat} from './inlineFormatting';
import {blockPMDocument,blockBookmark,projectBlockView} from './blockProsemirror';
import {authorBlockTransaction,normalizeBlockIds,blockCompositionTransaction} from './blockAdmission';
import type {Node as PMNode,Schema} from '@tiptap/pm/model';
import {Fragment} from '@tiptap/pm/model';
import {AddMarkStep,RemoveMarkStep,ReplaceStep,ReplaceAroundStep} from '@tiptap/pm/transform';
import {Plugin,PluginKey,Selection,TextSelection,type EditorState,type Transaction} from '@tiptap/pm/state';
import {RICH_MARKS,type RichDocument,type RichRange,type RichParagraph} from '../convergence/richTypes';
import type {RichEditorSession} from './session';

export const RICH_INTERNAL='writers-rich-internal';
export const RICH_ACK='writers-rich-ack';
type Paragraph={node:PMNode;start:number;end:number};
function paragraphs(doc:PMNode):Paragraph[]{const list:Paragraph[]=[];doc.forEach((node,start)=>{if(node.type.name!=='paragraph'||node.content.content.some(n=>!n.isText))throw Error('local_tool_rich_editor_schema_invalid');list.push({node,start,end:start+node.nodeSize});});return list;}
const text=(p:RichParagraph)=>p.content.map(t=>t.text).join('');
function point(doc:PMNode,pos:number,bias:'left'|'right'){
 const list=paragraphs(doc);if(!list.length)throw Error('local_tool_rich_editor_empty_view');
 let i=list.findIndex(p=>pos<p.end||pos===p.end&&bias==='left');if(i<0)i=list.length-1;
 const p=list[i];return{index:i,offset:Math.max(0,Math.min(p.node.content.size,pos-p.start-1))};
}
function splice(session:RichEditorSession,nodeId:string,from:number,to:number,value:string,format:InlineFormat={marks:[]}){if(from===to&&!value)return;session.apply({type:'rich-text-splice',field:session.field,nodeId,range:session.replica.richRange(session.field,nodeId,from,to),text:value,marks:format.marks,...(format.link?{link:format.link}:{})});}
function insert(session:RichEditorSession,nodeId:string,at:number,value:string,marks:InlineFormat[]){
 let i=0;while(i<value.length){let end=i+1;while(end<value.length&&JSON.stringify(marks[end])===JSON.stringify(marks[i]))end++;splice(session,nodeId,at+i,at+i,value.slice(i,end),marks[i]??{marks:[]});i=end;}
}
function matchMarks(session:RichEditorSession,ids:string[],target:Paragraph[]){
 const current=session.document();if(current.content.length!==target.length||current.content.some((p,i)=>p.id!==ids[i]||text(p)!==target[i].node.textContent))throw Error('local_tool_rich_editor_translation_invalid');
 for(let n=0;n<ids.length;n++){
  const want=inlineCells(target[n].node,session.links),have:InlineFormat[]=[];for(const part of current.content[n].content)for(let i=0;i<part.text.length;i++)have.push(richInlineFormat(part.marks));
  for(const mark of RICH_MARKS){let at=0;while(at<want.length){const enabled=want[at].marks.includes(mark);if(have[at].marks.includes(mark)===enabled){at++;continue;}let to=at+1;while(to<want.length&&want[to].marks.includes(mark)===enabled&&have[to].marks.includes(mark)!==enabled)to++;session.apply({type:'rich-mark',field:session.field,nodeId:ids[n],range:session.replica.richRange(session.field,ids[n],at,to),mark,enabled});at=to;}}
  matchInlineLinks(session,ids[n],want,have);
 }
}
function newParagraph(session:RichEditorSession,afterId:string|null,node:PMNode){const id=crypto.randomUUID();session.apply({type:'rich-insert-paragraph',field:session.field,id,afterId,text:''});insert(session,id,0,node.textContent,inlineCells(node,session.links));return id;}

/** Translate actual PM steps, capturing only after earlier actions have completed. */
function authorAcceptedRichTransaction(session:RichEditorSession,tr:Transaction):void {
 if(!tr.docChanged||tr.getMeta(RICH_INTERNAL))return;if(blockSession(session))return authorBlockTransaction(session,tr);
 // Reject an unrepresentable schema/step before the first local mutation.
 paragraphs(tr.before);paragraphs(tr.doc);
 for(const step of tr.steps)if(!(step instanceof ReplaceStep||step instanceof AddMarkStep||step instanceof RemoveMarkStep||step instanceof ReplaceAroundStep))throw Error('local_tool_rich_editor_step_unsupported');
 const admitted=richPMDocument(tr.before.type.schema,session.document());if(admitted.childCount!==tr.before.childCount||admitted.content.content.some((p,i)=>!p.content.eq(tr.before.child(i).content)))throw Error('local_tool_rich_editor_admission_branch');
 let ids=session.document().content.map(p=>p.id);
 const observed=paragraphs(tr.before).map(p=>p.node.attrs.id as unknown);if(new Set(observed).size===ids.length&&observed.every(id=>typeof id==='string'&&ids.includes(id))&&observed.some((id,i)=>id!==ids[i]))throw Error('local_tool_rich_editor_admission_branch');
  const beforeRows=paragraphs(tr.before),afterRows=paragraphs(tr.doc);
  // Native drag/drop can be a delete+insert pair. Preserve nodes and units for an exact move.
  const requested=afterRows.map(p=>{const same=beforeRows.findIndex(before=>before.node===p.node);return same<0?p.node.attrs.id as unknown:ids[same];}),unique=new Set(requested);
  const move=ids.length===requested.length&&unique.size===ids.length&&requested.some((id,i)=>id!==ids[i])&&requested.every(id=>typeof id==='string'&&ids.includes(id))&&afterRows.every((p,i)=>{const previous=beforeRows[ids.indexOf(requested[i] as string)]?.node;return previous?.content.eq(p.node.content);});
  if(move){for(let i=0;i<requested.length;i++){const wanted=requested[i] as string;if(ids[i]===wanted)continue;session.apply({type:'rich-move-paragraph',field:session.field,id:wanted,afterId:i?requested[i-1] as string:null});ids=session.document().content.map(p=>p.id);}return;}
  for(let index=0;index<tr.steps.length;index++){
   const step=tr.steps[index],before=tr.docs[index],applied=step.apply(before);if(applied.failed||!applied.doc)throw Error('local_tool_rich_editor_step_invalid');const after=applied.doc,rows=paragraphs(before),next=paragraphs(after);
   if(!ids.length){for(const p of next)ids.push(newParagraph(session,ids.at(-1)??null,p.node));matchMarks(session,ids,next);continue;}
   if(step instanceof AddMarkStep||step instanceof RemoveMarkStep){matchMarks(session,ids,next);continue;}
   if(step instanceof ReplaceAroundStep){if(rows.length!==next.length||rows.some((p,i)=>!p.node.content.eq(next[i].node.content)))throw Error('local_tool_rich_editor_step_unsupported');continue;}
   if(!(step instanceof ReplaceStep))throw Error('local_tool_rich_editor_step_unsupported');
   const beginBoundary=rows.findIndex(p=>p.start===step.from),endBoundary=step.to===before.content.size?rows.length:rows.findIndex(p=>p.start===step.to);
   if(beginBoundary>=0&&endBoundary>=beginBoundary&&step.slice.openStart===0&&step.slice.openEnd===0){
    const removed=endBoundary-beginBoundary,added=next.length-(rows.length-removed);if(added<0)throw Error('local_tool_rich_editor_translation_invalid');
    for(const id of ids.slice(beginBoundary,endBoundary))session.apply({type:'rich-delete-paragraph',field:session.field,id});
    const kept=ids.slice(0,beginBoundary),created:string[]=[];for(const p of next.slice(beginBoundary,beginBoundary+added))created.push(newParagraph(session,created.at(-1)??kept.at(-1)??null,p.node));
    ids=[...kept,...created,...ids.slice(endBoundary)];matchMarks(session,ids,next);continue;
   }
   const from=point(before,step.from,'right'),to=point(before,step.to,'left'),map=step.getMap(),left=point(after,map.map(step.from,-1),'right').index,right=point(after,map.map(step.to,1),'left').index;
   if(left!==from.index||right<left)throw Error('local_tool_rich_editor_translation_invalid');
   const prefix=rows[from.index].node.textContent.slice(0,from.offset),suffix=rows[to.index].node.textContent.slice(to.offset),wanted=next.slice(left,right+1);
   if(!wanted.length||!wanted[0].node.textContent.startsWith(prefix)||!wanted.at(-1)!.node.textContent.endsWith(suffix))throw Error('local_tool_rich_editor_translation_invalid');
   const first=ids[from.index],last=ids[to.index];
   if(from.index===to.index)splice(session,first,from.offset,to.offset,'');
   else{
    splice(session,first,from.offset,rows[from.index].node.content.size,'');splice(session,last,0,to.offset,'');
    for(const id of ids.slice(from.index+1,to.index))session.apply({type:'rich-delete-paragraph',field:session.field,id});
    session.apply({type:'rich-join',field:session.field,capture:session.replica.richJoinCapture(session.field,first,last)});
   }
   const produced=[first];let id=first,at=prefix.length;
   for(let n=0;n<wanted.length;n++){
    const node=wanted[n].node,start=n===0?prefix.length:0,end=node.content.size-(n===wanted.length-1?suffix.length:0);if(end<start)throw Error('local_tool_rich_editor_translation_invalid');
    const value=node.textContent.slice(start,end);insert(session,id,at,value,inlineCells(node,session.links).slice(start,end));at+=value.length;
    if(n<wanted.length-1){const nextId=crypto.randomUUID();session.apply({type:'rich-split',field:session.field,capture:session.replica.richSplitCapture(session.field,id,at),newNodeId:nextId});id=nextId;produced.push(id);at=0;}
   }
   ids=[...ids.slice(0,from.index),...produced,...ids.slice(to.index+1)];matchMarks(session,ids,next);
  }
  const result=session.document();if(result.content.length!==afterRows.length||result.content.some((p,i)=>text(p)!==afterRows[i].node.textContent))throw Error('local_tool_rich_editor_translation_invalid');
}

/** Collapse native provisional composition steps to its final minimal PM slice once. */
export function richCompositionTransaction(before:EditorState,after:EditorState):Transaction{
 const withoutIds=(doc:PMNode)=>doc.type.create(null,paragraphs(doc).map(p=>p.node.type.create({...p.node.attrs,id:null},p.node.content,p.node.marks)));
 const old=withoutIds(before.doc),next=withoutIds(after.doc),tr=before.tr,start=old.content.findDiffStart(next.content);
 if(start!==null){const end=old.content.findDiffEnd(next.content);if(!end)throw Error('local_tool_rich_editor_composition_invalid');const overlap=start-Math.min(end.a,end.b),a=end.a+Math.max(0,overlap),b=end.b+Math.max(0,overlap);tr.replace(start,a,after.doc.slice(start,b));}
 if(!withoutIds(tr.doc).eq(next))throw Error('local_tool_rich_editor_composition_invalid');return tr.setSelection(Selection.fromJSON(tr.doc,after.selection.toJSON()));
}

export function richPMDocument(schema:Schema,doc:RichDocument):PMNode{
 const content=doc.content.map(p=>schema.nodes.paragraph.create({id:p.id},p.content.map(t=>schema.text(t.text,(t.marks??[]).map(m=>schema.marks[m.type].create(m.type==='link'?m.attrs:undefined))))));
 return schema.nodes.doc.create(null,content.length?content:[schema.nodes.paragraph.create({id:null})]);
}
type Bookmark={anchor:RichRange|null;head:RichRange|null};
export function richBookmark(session:RichEditorSession,doc:PMNode,anchor:number,head:number):Bookmark{
 if(blockSession(session))return blockBookmark(session,doc,anchor,head);
 const capture=(pos:number)=>{const p=point(doc,pos,'right'),node=doc.child(p.index),id=node.attrs.id as string|null;if(!id)return null;return session.replica.richRange(session.field,id,p.offset,p.offset);};return{anchor:capture(anchor),head:capture(head)};
}
/** Patch affected paragraph spans; never replace the document on each local keystroke. */
export function projectRichView(session:RichEditorSession,tr:Transaction,bookmark:Bookmark):Transaction{
 if(blockSession(session))return projectBlockView(session,tr,bookmark);
 const oldAnchor=tr.selection.anchor,oldHead=tr.selection.head,storedMarks=tr.storedMarks,target=richPMDocument(tr.doc.type.schema,session.document());
 // Work right-to-left so positions of earlier unchanged paragraphs stay stable.
 const current=paragraphs(tr.doc),desired=paragraphs(target);let prefix=0,suffix=0;
 while(prefix<current.length&&prefix<desired.length&&current[prefix].node.eq(desired[prefix].node))prefix++;
 while(suffix<current.length-prefix&&suffix<desired.length-prefix&&current[current.length-1-suffix].node.eq(desired[desired.length-1-suffix].node))suffix++;
 if(prefix<current.length-suffix||prefix<desired.length-suffix){const from=current[prefix]?.start??tr.doc.content.size,to=suffix?current[current.length-suffix].start:tr.doc.content.size;tr.replaceWith(from,to,Fragment.fromArray(desired.slice(prefix,desired.length-suffix).map(p=>p.node)));}
 const resolve=(capture:RichRange|null,fallback:number)=>{if(!capture)return Math.min(fallback,tr.doc.content.size);const p=session.replica.resolveRichPoint(capture);if(p.detached)return tr.mapping.map(fallback);let pos=0;for(let i=0;i<tr.doc.childCount;i++){const n=tr.doc.child(i);if(n.attrs.id===p.nodeId)return pos+1+Math.min(p.offset,n.content.size);pos+=n.nodeSize;}return tr.mapping.map(fallback);};
 if(tr.docChanged){const anchor=resolve(bookmark.anchor,oldAnchor),head=resolve(bookmark.head,oldHead);tr.setSelection(TextSelection.between(tr.doc.resolve(Math.max(0,Math.min(anchor,tr.doc.content.size))),tr.doc.resolve(Math.max(0,Math.min(head,tr.doc.content.size)))));}
 return tr.setStoredMarks(storedMarks).setMeta('preventClearDocument',true).setMeta(RICH_INTERNAL,true).setMeta('addToHistory',false);
}


export interface RichAcceptedRecord {sequence:number;token:object;transaction:Transaction}
interface RichAdmissionJournal {epoch:object;sequence:number;acknowledged:number;records:RichAcceptedRecord[]}
const admissionKey=new PluginKey<RichAdmissionJournal>('writersRichAccepted');
/** Pure plugin state: speculative states and filtered transactions never reach the controller. */
export function createRichAdmissionJournal(canEdit:()=>boolean=()=>true){return new Plugin<RichAdmissionJournal>({key:admissionKey,
 // Admission only: never author, drain or mutate state from a transaction filter.
 filterTransaction:tr=>!tr.docChanged||!!tr.getMeta(RICH_INTERNAL)||canEdit(),
 state:{
 init:()=>({epoch:{},sequence:0,acknowledged:0,records:[]}),
 apply(tr,previous){
  const requested=tr.getMeta(RICH_ACK),acknowledged=typeof requested==='number'&&Number.isSafeInteger(requested)?Math.max(previous.acknowledged,Math.min(requested,previous.sequence)):previous.acknowledged;
  const records=acknowledged===previous.acknowledged?previous.records:previous.records.filter(r=>r.sequence>acknowledged);
  if(!tr.docChanged||tr.getMeta(RICH_INTERNAL))return{...previous,acknowledged,records};
  const sequence=previous.sequence+1;return{...previous,sequence,acknowledged,records:[...records,{sequence,token:{},transaction:tr}]};
 }
}});}
export function hasRichAcceptedWork(session:RichEditorSession,state:EditorState){const journal=admissionKey.getState(state);return!!journal?.records.some(r=>!session.hasAcceptedRecord(r.token));}
/** Only attributes and the journal ACK change here. Text/marks have already been accepted by PM. */
function normalizeRichIds(tr:Transaction,doc:RichDocument,session:RichEditorSession){
 if(blockSession(session))return normalizeBlockIds(session,tr).setMeta(RICH_INTERNAL,true).setMeta('preventClearDocument',true).setMeta('addToHistory',false);
 const target=richPMDocument(tr.doc.type.schema,doc);if(target.childCount!==tr.doc.childCount)throw Error('local_tool_rich_editor_admission_mismatch');let pos=0;
 for(let i=0;i<tr.doc.childCount;i++){const node=tr.doc.child(i),wanted=target.child(i);if(!node.content.eq(wanted.content))throw Error('local_tool_rich_editor_admission_mismatch');if(node.attrs.id!==wanted.attrs.id)tr.setNodeMarkup(pos,undefined,{...node.attrs,id:wanted.attrs.id});pos+=node.nodeSize;}
 return tr.setMeta(RICH_INTERNAL,true).setMeta('preventClearDocument',true).setMeta('addToHistory',false);
}
/** Drain actual view.state after Tiptap commits; nested events observe consumed sequence cursors. */
export function drainRichAccepted(session:RichEditorSession,read:()=>EditorState,dispatch:(tr:Transaction)=>void):boolean{
 if(!hasRichAcceptedWork(session,read()))return true;
 return session.gesture(()=>drainAcceptedInside(session,read,dispatch));
}
function drainAcceptedInside(session:RichEditorSession,read:()=>EditorState,dispatch:(tr:Transaction)=>void):void{
  for(;;){
   const state=read(),journal=admissionKey.getState(state);if(!journal)throw Error('local_tool_rich_editor_journal_missing');
   const records=journal.records.filter(r=>!session.hasAcceptedRecord(r.token));
   if(!records.length){if(!state.doc.eq(sessionPMDocument(session,state.schema)))throw Error('local_tool_rich_editor_normalization_vetoed');return;}
   const cut=records.at(-1)!.sequence;
   // Mark consumed before authoring/dispatch, even on failure or veto of the internal ACK.
   session.consumeAccepted(journal.epoch,cut,journal.records.filter(r=>r.sequence<=cut).map(r=>r.token));
   for(const record of records)authorAcceptedRichTransaction(session,record.transaction);
   dispatch(normalizeRichIds(read().tr,session.document(),session).setMeta(RICH_ACK,cut));
   const committed=admissionKey.getState(read());if(committed?.epoch!==journal.epoch||committed.acknowledged<cut)throw Error('local_tool_rich_editor_ack_vetoed');
   // Any newly appended/nested accepted steps are drained before allowing Save or another gesture.
  }
}
/** Composition acknowledges provisional records, but authors ONLY its final minimal slice. */
export function commitRichComposition(session:RichEditorSession,before:EditorState,read:()=>EditorState,dispatch:(tr:Transaction)=>void):boolean{
 const state=read(),journal=admissionKey.getState(state);if(!journal)throw Error('local_tool_rich_editor_journal_missing');
 const transaction=blockSession(session)?blockCompositionTransaction(before,state):richCompositionTransaction(before,state),cut=journal.sequence;
 return session.gesture(()=>{
  session.consumeAccepted(journal.epoch,cut,journal.records.filter(r=>r.sequence<=cut).map(r=>r.token));authorAcceptedRichTransaction(session,transaction);
  dispatch(normalizeRichIds(read().tr,session.document(),session).setMeta(RICH_ACK,cut));
  const committed=admissionKey.getState(read());if(committed?.epoch!==journal.epoch||committed.acknowledged<cut)throw Error('local_tool_rich_editor_ack_vetoed');
  drainAcceptedInside(session,read,dispatch);
 });
}

export function blockSession(session:RichEditorSession){const field=session.contract.codec.fields[session.field];return isLocalToolRichBlockField(field);}
export function sessionPMDocument(session:RichEditorSession,schema:Schema){return blockSession(session)?blockPMDocument(schema,session.blockDocument()):richPMDocument(schema,session.document());}
