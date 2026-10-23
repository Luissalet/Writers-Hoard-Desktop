import { Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { LOCAL_TOOL_DOCUMENT_MIME, decodeLocalToolDocumentDrag } from '@/engines/local/references';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
import CodexBlockView from './CodexBlockView';
import { blockIdentifier, blockLabel, blockMatchesProject, CODEX_BLOCK_NAME, type CodexBlockHost, type CodexBlockTarget } from './model';
declare module '@tiptap/core' {
  interface Commands<ReturnType> { codexLiveBlock: { insertCodexLiveBlock: (target: CodexBlockTarget) => ReturnType } }
}
/** Only pointers and a bounded title fallback are serialized; never source body. */
export const CodexBlock = Node.create<CodexBlockHost & { nodeView: boolean }>({
  name: CODEX_BLOCK_NAME, group: 'block', atom: true, selectable: true,
  addOptions() { return { context: () => ({}), nodeView: true }; },
  addAttributes() { return {
    projectId: { default: '', parseHTML: element => blockIdentifier(element.getAttribute('data-project-id')), renderHTML: () => ({}) },
    entryId: { default: '', parseHTML: element => blockIdentifier(element.getAttribute('data-entry-id')), renderHTML: () => ({}) },
    presentation:{default:'preview',parseHTML:element=>element.getAttribute('data-presentation')==='editor'?'editor':'preview',renderHTML:()=>({})},
    label: { default: '', parseHTML: element => blockLabel(element.getAttribute('data-label')), renderHTML: () => ({}) },
  }; },
  parseHTML() { return [{ tag: 'aside[data-wh-codex-block="true"]' }]; },
  renderHTML({ node }) { const projectId = blockIdentifier(node.attrs.projectId), entryId = blockIdentifier(node.attrs.entryId), label = blockLabel(node.attrs.label); return ['aside', { 'data-wh-codex-block': 'true', 'data-project-id': projectId, 'data-entry-id': entryId, 'data-label': label,...(node.attrs.presentation==='editor'?{'data-presentation':'editor'}:{}) }, ['p', {}, label ? `Codex: ${label}` : 'Codex reference']]; },
  renderText({ node }) { return blockLabel(node.attrs.label) ? `[Codex: ${blockLabel(node.attrs.label)}]` : '[Codex reference]'; },
  addCommands() { return { insertCodexLiveBlock: target => ({ commands, state }) => {
    const safe = { projectId: blockIdentifier(target.projectId), entryId: blockIdentifier(target.entryId), label: blockLabel(target.label) };
    if (!this.editor.isEditable || !blockMatchesProject(safe, this.options.context())) return false;
    const { from, to, $from, $to } = state.selection;
    if ($from.parent.type.name === CHAPTER_HEADING_NAME || $to.parent.type.name === CHAPTER_HEADING_NAME) return false;
    let crossesChapter = false;
    state.doc.nodesBetween(from, to, node => { if (node.type.name === CHAPTER_HEADING_NAME) crossesChapter = true; });
    if (crossesChapter) return false;
    return commands.insertContent({ type: this.name, attrs: safe });
  } }; },
  addProseMirrorPlugins() {
    const host = this.options;
    // A Codex card dragged from the library onto the text becomes a live block where it is dropped.
    return [new Plugin({ key: new PluginKey('codexCardDrop'), props: { handleDrop: (view, event) => {
      const raw = (event as DragEvent).dataTransfer?.getData(LOCAL_TOOL_DOCUMENT_MIME);
      if (!raw || !view.editable) return false;
      let drag; try { drag = decodeLocalToolDocumentDrag(raw); } catch { return false; }
      if (drag.reference.kind !== 'codex') return false;
      const target = { projectId: blockIdentifier(drag.projectId), entryId: blockIdentifier(drag.reference.documentId), label: '' };
      if (!blockMatchesProject(target, host.context())) return false;
      const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
      if (!at) return false;
      const $at = view.state.doc.resolve(at.pos);
      for (let depth = $at.depth; depth > 0; depth--) if ($at.node(depth).type.name === CHAPTER_HEADING_NAME) return false;
      event.preventDefault();
      view.dispatch(view.state.tr.replaceRangeWith(at.pos, at.pos, view.state.schema.nodes[CODEX_BLOCK_NAME].create(target)).scrollIntoView());
      return true;
    } } })];
  },
  addNodeView() { return this.options.nodeView ? ReactNodeViewRenderer(CodexBlockView,{stopEvent:({event})=>event.target instanceof Element&&!!event.target.closest('[data-tool-editor-surface]')}) : null; },
});
