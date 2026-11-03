import {inlineCells,richInlineFormat,matchInlineLinks,type InlineFormat} from './inlineFormatting';
import {localToolStateEqual} from '../stateActions';
import type {Node as PMNode} from '@tiptap/pm/model';
import type {EditorState,Transaction} from '@tiptap/pm/state';
import {ReplaceStep,AddMarkStep,RemoveMarkStep} from '@tiptap/pm/transform';
import type {RichEditorSession} from './session';
import {blockPMDocument,blockPMLeaves} from './blockProsemirror';
import {RICH_MARKS} from '../convergence/richTypes';

const signature=(doc:PMNode,withoutIds=false):unknown=>{const json=doc.toJSON();const walk=(node:Record<string,unknown>):unknown=>({type:node.type,...(node.attrs?{attrs:Object.fromEntries(Object.entries(node.attrs as Record<string,unknown>).filter(([key])=>!withoutIds||key!=='id'))}:{}),content:(Array.isArray(node.content)?node.content as Record<string,unknown>[]:[]).filter(n=>n.type!=='text').map(walk)});return walk(json);};
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
 if(!session.blockDocument().blocks.length){
  if(after.length!==1||after[0].node.type.name!=='paragraph')throw Error('local_tool_blocks_editor_empty_view');const id=crypto.randomUUID();session.apply({type:'rich-block-insert',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[],{parentId:null,slot:'body',afterId:null}),block:{id,type:'paragraph',attrs:{}},text:''});ids=[id];
 }
 for(const splice of exact){if(!splice)continue;const id=ids[splice.at];if(!id)throw Error('local_tool_blocks_editor_identity_missing');let at=0,removed=false;while(at<splice.value.length){let to=at+1;while(to<splice.value.length&&JSON.stringify(splice.marks[to])===JSON.stringify(splice.marks[at]))to++;session.apply({type:'rich-text-splice',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,splice.from+at,removed?splice.from+at:splice.to),text:splice.value.slice(at,to),marks:splice.marks[at].marks,...(splice.marks[at].link?{link:splice.marks[at].link}:{})});removed=true;at=to;}if(!removed&&splice.to>splice.from)session.apply({type:'rich-text-splice',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,splice.from,splice.to),text:''});}
 for(let n=0;n<after.length;n++){
  const id=ids[n];if(!id)throw Error('local_tool_blocks_editor_identity_missing');const want=inlineCells(after[n].node,session.links);
  const actual=session.blockDocument().blocks.find(b=>b.id===id)!,have:InlineFormat[]=[];for(const text of actual.content!)for(let i=0;i<text.text.length;i++)have.push(richInlineFormat(text.marks));
  for(const mark of RICH_MARKS){let index=0;while(index<want.length){const enabled=want[index].marks.includes(mark);if(have[index].marks.includes(mark)===enabled){index++;continue;}let to=index+1;while(to<want.length&&want[to].marks.includes(mark)===enabled&&have[to].marks.includes(mark)!==enabled)to++;session.apply({type:'rich-mark',field:session.field,nodeId:id,range:session.replica.richRange(session.field,id,index,to),mark,enabled});index=to;}}
  matchInlineLinks(session,id,want,have);
 }
}
export function normalizeBlockIds(session:RichEditorSession,tr:Transaction):Transaction {
 const target=blockPMDocument(tr.doc.type.schema,session.blockDocument());if(!localToolStateEqual(signature(tr.doc,true),signature(target,true))||tr.doc.textContent!==target.textContent)throw Error('local_tool_blocks_editor_normalization_invalid');
 const wanted=new Map<number,PMNode>();target.descendants((node,pos)=>{wanted.set(pos,node);});
 tr.doc.descendants((node,pos)=>{const next=wanted.get(pos);if(next&&node.type===next.type&&node.attrs.id!==next.attrs.id)tr.setNodeMarkup(pos,undefined,{...node.attrs,id:next.attrs.id});});
 if(!tr.doc.eq(target))throw Error('local_tool_blocks_editor_normalization_invalid');return tr;
}
export function blockCompositionTransaction(before:EditorState,after:EditorState):Transaction {
 const tr=before.tr,from=before.doc.content.findDiffStart(after.doc.content);if(from!==null){const end=before.doc.content.findDiffEnd(after.doc.content);if(!end)throw Error('local_tool_blocks_editor_composition_invalid');const overlap=from-Math.min(end.a,end.b);tr.replace(from,end.a+Math.max(0,overlap),after.doc.slice(from,end.b+Math.max(0,overlap)));}return tr;
}
