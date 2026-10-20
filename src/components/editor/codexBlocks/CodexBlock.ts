import { Node } from '@tiptap/core';
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
    label: { default: '', parseHTML: element => blockLabel(element.getAttribute('data-label')), renderHTML: () => ({}) },
  }; },
  parseHTML() { return [{ tag: 'aside[data-wh-codex-block="true"]' }]; },
  renderHTML({ node }) { const projectId = blockIdentifier(node.attrs.projectId), entryId = blockIdentifier(node.attrs.entryId), label = blockLabel(node.attrs.label); return ['aside', { 'data-wh-codex-block': 'true', 'data-project-id': projectId, 'data-entry-id': entryId, 'data-label': label }, ['p', {}, label ? `Codex: ${label}` : 'Codex reference']]; },
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
  addNodeView() { return this.options.nodeView ? ReactNodeViewRenderer(CodexBlockView) : null; },
});
