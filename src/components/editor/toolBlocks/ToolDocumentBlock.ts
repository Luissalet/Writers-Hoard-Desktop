import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
import type { CodexBlockHost } from '../codexBlocks/model';
import { TOOL_BLOCK_NAME, toolTarget, targetAllowed, type ToolDocumentTarget } from './model';
import ToolDocumentBlockView from './ToolDocumentBlockView';
declare module '@tiptap/core' { interface Commands<ReturnType> { toolDocumentBlock: { insertToolDocumentBlock: (target:ToolDocumentTarget) => ReturnType } } }
export const ToolDocumentBlock = Node.create<CodexBlockHost & {nodeView:boolean}>({
  name:TOOL_BLOCK_NAME, group:'block', atom:true, selectable:true,
  addOptions() { return {context:()=>({}),nodeView:true}; },
  addAttributes() { return Object.fromEntries(['projectId','kind','documentId','label'].map(key => [key,{default:'',parseHTML:(element:HTMLElement)=>element.getAttribute({'projectId':'data-project-id','kind':'data-tool-kind','documentId':'data-document-id','label':'data-label'}[key]!),renderHTML:()=>({})}])); },
  parseHTML() { return [{tag:'figure[data-wh-tool-block="true"]'}]; },
  renderHTML({node}) { const target=toolTarget(node.attrs); return ['figure',{'data-wh-tool-block':'true','data-project-id':target?.projectId??'','data-tool-kind':target?.kind??'','data-document-id':target?.documentId??'','data-label':target?.label??''},['figcaption',{},target?.label||'Linked local tool document']]; },
  renderText({node}) { const target=toolTarget(node.attrs); return `[${target?.kind??'document'}: ${target?.label??''}]`; },
  addCommands() { return {insertToolDocumentBlock:target=>({commands,state})=>{
    const safe=toolTarget({...target}); if(!safe||!this.editor.isEditable||!targetAllowed(safe,this.options.context()))return false;
    const {from,to,$from,$to}=state.selection; if($from.parent.type.name===CHAPTER_HEADING_NAME||$to.parent.type.name===CHAPTER_HEADING_NAME)return false;
    let crosses=false;state.doc.nodesBetween(from,to,node=>{if(node.type.name===CHAPTER_HEADING_NAME)crosses=true;});
    return !crosses&&commands.insertContent({type:this.name,attrs:safe});
  }}; },
  addNodeView() {return this.options.nodeView?ReactNodeViewRenderer(ToolDocumentBlockView):null;},
});
