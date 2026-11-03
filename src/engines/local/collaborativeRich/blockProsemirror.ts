import {tableCellOf} from '../convergence/tableFormat';
import {Node,mergeAttributes} from '@tiptap/core';
import type {Node as PMNode,Schema} from '@tiptap/pm/model';
import {TextSelection,type Transaction,type EditorState} from '@tiptap/pm/state';
import type {RichEditorSession} from '@/engines/local/collaborativeRich/session';
import {RICH_INTERNAL} from '@/engines/local/collaborativeRich/prosemirror';
import type {RichRange} from '@/engines/local/convergence/richTypes';
import type {RichBlockDocument,RichBlock} from '@/engines/local/convergence/blockTypes';
import {richBlockChildren} from '@/engines/local/convergence/blockEditing';

/** One layout adapter over admitted state; RAW cycles never reach PM. */
export function blockPMDocument(schema:Schema,data:RichBlockDocument):PMNode {
 const leaf=(block:RichBlock,summary=false)=>schema.nodes[summary?'blockSummary':block.type].create({id:block.id,...block.attrs,...(summary?{leafKind:block.type}: {})},block.content!.map(t=>schema.text(t.text,(t.marks??[]).map(m=>schema.marks[m.type].create(m.type==='link'?m.attrs:undefined)))));
 const node=(block:RichBlock):PMNode=>{
  if(block.content)return leaf(block);
  const name=({'bullet-list':'bulletList','ordered-list':'orderedList','list-item':'listItem',blockquote:'blockquote',toggle:'toggle','table':'table','table-row':'tableRow','table-cell':'tableCell','table-header':'tableHeader'} as Record<string,string>)[block.type];
  const children=block.type==='toggle'?[...richBlockChildren(data,block.id,'summary').map(b=>leaf(b,true)),...richBlockChildren(data,block.id).map(node)]:richBlockChildren(data,block.id).map(node);
  return schema.nodes[name].create({id:block.id,...block.attrs},children);
 };
 const content=richBlockChildren(data,null).map(node);return schema.nodes.doc.create(null,content.length?content:[schema.nodes.paragraph.create({id:null})]);
}
export function blockPMLeaves(doc:PMNode){const out:{id:string|null;node:PMNode;pos:number}[]=[];doc.descendants((node,pos)=>{if(node.isTextblock){out.push({id:typeof node.attrs.id==='string'?node.attrs.id:null,node,pos});return false;}});return out;}
export function selectedBlockLeaves(doc:PMNode,from:number,to:number){return blockPMLeaves(doc).filter(n=>n.pos+1<=to&&n.pos+1+n.node.content.size>=from).map(n=>n.id).filter((id):id is string=>id!==null);}
export interface BlockBookmark {anchor:RichRange|null;head:RichRange|null}
export function blockBookmark(session:RichEditorSession,doc:PMNode,anchor:number,head:number):BlockBookmark {
 const capture=(pos:number)=>{const leaves=blockPMLeaves(doc),n=leaves.find(n=>pos>=n.pos+1&&pos<=n.pos+1+n.node.content.size);return n?.id?session.replica.richRange(session.field,n.id,pos-n.pos-1,pos-n.pos-1):null;};return{anchor:capture(anchor),head:capture(head)};
}
export function projectBlockView(session:RichEditorSession,tr:Transaction,bookmark:BlockBookmark,restoreSelection=false):Transaction {
 const target=blockPMDocument(tr.doc.type.schema,session.blockDocument()),from=tr.doc.content.findDiffStart(target.content),oldAnchor=tr.selection.anchor,oldHead=tr.selection.head,stored=tr.storedMarks;
 if(from!==null){const end=tr.doc.content.findDiffEnd(target.content);if(!end)throw Error('local_tool_blocks_projection_invalid');const overlap=from-Math.min(end.a,end.b);tr.replace(from,end.a+Math.max(0,overlap),target.slice(from,end.b+Math.max(0,overlap)));}
 const resolve=(point:RichRange|null,fallback:number)=>{if(!point)return tr.mapping.map(fallback);const effective=session.replica.resolveRichPoint(point);if(effective.detached)return tr.mapping.map(fallback);const leaf=blockPMLeaves(tr.doc).find(n=>n.id===effective.nodeId);return leaf?leaf.pos+1+Math.min(effective.offset,leaf.node.content.size):tr.mapping.map(fallback);};
 if(tr.docChanged||restoreSelection){const a=Math.max(0,Math.min(tr.doc.content.size,resolve(bookmark.anchor,oldAnchor))),h=Math.max(0,Math.min(tr.doc.content.size,resolve(bookmark.head,oldHead)));tr.setSelection(TextSelection.between(tr.doc.resolve(a),tr.doc.resolve(h)));}
 return tr.setStoredMarks(stored).setMeta(RICH_INTERNAL,true).setMeta('preventClearDocument',true).setMeta('addToHistory',false);
}
export type BlockFormat='paragraph'|'h1'|'h2'|'h3'|'bullet-list'|'ordered-list'|'blockquote'|'toggle'|'unwrap';
/** Toolbar commands author the same public operations; no PM HTML replacement. */
export function formatBlocks(session:RichEditorSession,nodeIds:string[],format:BlockFormat):boolean {
 if(!nodeIds.length)return false;
 return session.gesture(()=>{
  session.beforeViewChange?.();const p=session.replica,field=session.field;
  if(format==='paragraph'||format==='h1'||format==='h2'||format==='h3')session.apply({type:'rich-block-transform',field,capture:p.richBlockEditCapture(field,nodeIds),kind:format==='paragraph'?'paragraph':'heading',attrs:format==='paragraph'?{}:{level:Number(format.slice(1))}});
  else if(format==='bullet-list'||format==='ordered-list'){
   const data=session.blockDocument(),parents=nodeIds.map(id=>{let b=data.blocks.find(b=>b.id===id);while(b?.parentId){const parent=data.blocks.find(n=>n.id===b!.parentId);if(parent?.type==='bullet-list'||parent?.type==='ordered-list')return parent;b=parent;}return undefined;}),list=parents[0];
   if(list&&parents.every(b=>b?.id===list.id))session.apply(list.type===format?{type:'rich-block-unwrap',field,capture:p.richBlockEditCapture(field,[list.id])}:{type:'rich-block-transform',field,capture:p.richBlockEditCapture(field,[list.id]),kind:format,attrs:{}});
   else session.apply({type:'rich-block-wrap',field,capture:p.richBlockCapture(field,{nodeIds}),wrapper:{id:crypto.randomUUID(),type:format,attrs:{}},items:nodeIds.map(leafId=>({id:crypto.randomUUID(),leafId}))});
  }
  else if(format==='unwrap')session.apply({type:'rich-block-unwrap',field,capture:p.richBlockEditCapture(field,nodeIds)});
  else{
   const data=session.blockDocument(),first=data.blocks.find(b=>b.id===nodeIds[0]),parent=data.blocks.find(b=>b.id===first?.parentId);
   if(parent?.type===format&&nodeIds.every(id=>data.blocks.find(b=>b.id===id)?.parentId===parent.id))session.apply({type:'rich-block-unwrap',field,capture:p.richBlockEditCapture(field,[parent.id])});
   else session.apply({type:'rich-block-container',field,capture:p.richBlockEditCapture(field,nodeIds),container:{id:crypto.randomUUID(),type:format,attrs:{}}});
  }
  session.afterViewChange?.();
 });
}
export function blockTextKey(session:RichEditorSession,view:{state:EditorState;dispatch:(tr:Transaction)=>void},key:string,outdent=false):boolean {
 const state=view.state;
 const {from,to}=state.selection,leaves=blockPMLeaves(state.doc),index=leaves.findIndex(n=>n.id&&from>=n.pos+1&&to<=n.pos+1+n.node.content.size),leaf=leaves[index];if(!leaf?.id)return false;
 const offset=from-leaf.pos-1;
 if(session.tables){
  const data=session.blockDocument(),cell=tableCellOf(data,leaf.id);
  if(cell&&key==='Tab'){
   const byId=new Map(data.blocks.map(b=>[b.id,b])),row=byId.get(byId.get(cell)!.parentId!),table=byId.get(row!.parentId!),cells=richBlockChildren(data,table!.id).flatMap(r=>richBlockChildren(data,r.id)),at=cells.findIndex(c=>c.id===cell),next=cells[at+(outdent?-1:1)];if(!next)return false;
   const target=leaves.find(n=>n.id&&tableCellOf(data,n.id)===next.id);if(target){view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,target.pos+1)).setMeta('addToHistory',false));return true;}return true;
  }
  if(cell&&from===to&&key==='Backspace'&&offset===0&&(!leaves[index-1]?.id||tableCellOf(data,leaves[index-1].id!)!==cell))return true;
  if(cell&&from===to&&key==='Delete'&&offset===leaf.node.content.size&&(!leaves[index+1]?.id||tableCellOf(data,leaves[index+1].id!)!==cell))return true;
 }

 if(key==='Tab'){const data=session.blockDocument(),block=data.blocks.find(b=>b.id===leaf.id),item=data.blocks.find(b=>b.id===block?.parentId),list=data.blocks.find(b=>b.id===item?.parentId);if(item?.type!=='list-item'||!list)return false;if(!outdent&&richBlockChildren(data,list.id)[0]?.id===item.id||outdent&&data.blocks.find(b=>b.id===list.parentId)?.type!=='list-item')return false;return session.gesture(()=>{session.beforeViewChange?.();session.apply({type:'rich-block-list-indent',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[leaf.id!]),direction:outdent?'out':'in',...(!outdent?{listId:crypto.randomUUID()}:{})});session.afterViewChange?.();});}
 if(key==='Enter')return session.gesture(()=>{
  session.beforeViewChange?.();if(to>from)session.apply({type:'rich-text-splice',field:session.field,nodeId:leaf.id!,range:session.replica.richRange(session.field,leaf.id!,offset,to-leaf.pos-1),text:''});
  const data=session.blockDocument(),block=data.blocks.find(b=>b.id===leaf.id)!,parent=data.blocks.find(b=>b.id===block.parentId);
  if(from===to&&offset===0&&block.type==='paragraph'&&block.content?.length===0&&parent?.type==='list-item'&&richBlockChildren(data,parent.id).length===1){session.apply({type:'rich-block-exit-empty-item',field:session.field,capture:session.replica.richBlockEmptyItemCapture(session.field,leaf.id!),continuationListId:crypto.randomUUID()});session.afterViewChange?.();const placed=blockPMLeaves(view.state.doc).find(n=>n.id===leaf.id);if(placed)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,placed.pos+1)));return;}
  const newId=crypto.randomUUID();session.apply({type:'rich-block-split',field:session.field,capture:session.replica.richBlockSplitCapture(session.field,leaf.id!,offset),newNodeId:newId,...(parent?.type==='list-item'?{newItemId:crypto.randomUUID()}:{})});session.afterViewChange?.();const placed=blockPMLeaves(view.state.doc).find(n=>n.id===newId);if(placed)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,placed.pos+1)));
 });
 if(key!=='Backspace'||from!==to||offset!==0||index===0)return false;
 const previous=leaves[index-1];if(!previous.id)return false;
 // The public capture proves tree adjacency; DOM position alone grants no join.
 let capture;try{capture=session.replica.richBlockJoinCapture(session.field,previous.id,leaf.id);}catch{return false;}
 return session.gesture(()=>{session.beforeViewChange?.();session.apply({type:'rich-block-join',field:session.field,capture});session.afterViewChange?.();const placed=blockPMLeaves(view.state.doc).find(n=>n.id===previous.id);if(placed)view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,placed.pos+1+previous.node.content.size)));});
}
/** Collapse is local presentation keyed by block identity, outside saved state. */
export function blockNodes(collapsed:Set<string>,tables=false){
 const attributes={id:{default:null,parseHTML:(element:HTMLElement)=>element.getAttribute('data-writer-block'),renderHTML:(attrs:Record<string,unknown>)=>attrs.id?{'data-writer-block':attrs.id}:{}}};
 const ordinary=(name:string,tag:string,content:string,extra:Record<string,{default:unknown}>={})=>Node.create({name,group:name==='listItem'||name==='tableRow'?undefined:'block',content,draggable:true,addAttributes(){return{...attributes,...extra};},parseHTML(){return[{tag}];},renderHTML({HTMLAttributes}){return[tag,mergeAttributes(HTMLAttributes,...(name==='bulletList'?[{style:'list-style-type:disc'}]:name==='orderedList'?[{style:'list-style-type:decimal'}]:[])),0];}});
 return[
  Node.create({name:'doc',topNode:true,content:'block+'}),Node.create({name:'text',group:'inline'}),ordinary('paragraph','p','inline*'),
  Node.create({name:'heading',group:'block',content:'inline*',draggable:true,addAttributes(){return{...attributes,level:{default:1}};},parseHTML(){return[1,2,3].map(level=>({tag:'h'+level,attrs:{level}}));},renderHTML({node,HTMLAttributes}){return['h'+Number(node.attrs.level),mergeAttributes(HTMLAttributes),0];}}),
  ...(tables?[
   Node.create({name:'table',group:'block',content:'tableRow+',draggable:true,isolating:true,addAttributes(){return{...attributes,columns:{default:[]}};},parseHTML(){return[{tag:'table'}];},renderHTML({HTMLAttributes}){return['table',mergeAttributes({class:'my-3 w-full table-fixed border-collapse'},HTMLAttributes),['tbody',0]];}}),
   ordinary('tableRow','tr','(tableCell|tableHeader)+'),
   ...(['tableCell','tableHeader']as const).map(name=>Node.create({name,content:'block+',isolating:true,addAttributes(){return{...attributes,columnId:{default:null}};},parseHTML(){return[{tag:name==='tableCell'?'td':'th'}];},renderHTML({HTMLAttributes}){return[name==='tableCell'?'td':'th',mergeAttributes({class:'min-w-12 border border-border p-2 align-top'+(name==='tableHeader'?' bg-elevated font-semibold':'')},HTMLAttributes),0];}})),
  ]:[]),
  ordinary('bulletList','ul','listItem*'),ordinary('orderedList','ol','listItem*',{start:{default:1}}),ordinary('listItem','li','block*'),ordinary('blockquote','blockquote','block*'),
  Node.create({name:'blockSummary',content:'inline*',addAttributes(){return{...attributes,leafKind:{default:'paragraph'},level:{default:1}};},parseHTML(){return[{tag:'summary'}];},renderHTML({HTMLAttributes}){return['summary',mergeAttributes(HTMLAttributes),0];}}),
  Node.create({name:'toggle',group:'block',content:'blockSummary block*',draggable:true,addAttributes(){return attributes;},parseHTML(){return[{tag:'details'}];},renderHTML({HTMLAttributes}){return['details',mergeAttributes(HTMLAttributes,{open:''}),0];},addNodeView(){return({node})=>{const dom=document.createElement('details');let blockId=String(node.attrs.id??'');dom.dataset.writerBlock=blockId;dom.open=!collapsed.has(blockId);const toggle=()=>{if(dom.open)collapsed.delete(blockId);else collapsed.add(blockId);};dom.addEventListener('toggle',toggle);return{dom,contentDOM:dom,update(next){if(next.type!==node.type||next.attrs.id!==blockId)return false;blockId=String(next.attrs.id);return true;},ignoreMutation(mutation){return mutation.type==='attributes'&&mutation.target===dom&&mutation.attributeName==='open';},destroy(){dom.removeEventListener('toggle',toggle);}};}}}),
 ];
}
