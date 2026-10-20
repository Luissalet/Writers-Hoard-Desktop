import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
import { blockIdentifier, blockLabel, type CodexBlockHost } from '../codexBlocks/model';
import MediaBlockView from './MediaBlockView';
export interface MediaBlockTarget { projectId: string; assetId: string; label: string }
declare module '@tiptap/core' { interface Commands<ReturnType> { localMediaBlock: { insertLocalMediaBlock: (target: MediaBlockTarget) => ReturnType } } }
export const MediaBlock = Node.create<CodexBlockHost & { nodeView: boolean }>({
  name: 'localMediaBlock', group: 'block', atom: true, selectable: true,
  addOptions() { return { context: () => ({}), nodeView: true }; },
  addAttributes() { return {
    projectId: { default: '', parseHTML: element => blockIdentifier(element.getAttribute('data-project-id')), renderHTML: () => ({}) },
    assetId: { default: '', parseHTML: element => blockIdentifier(element.getAttribute('data-asset-id')), renderHTML: () => ({}) },
    label: { default: '', parseHTML: element => blockLabel(element.getAttribute('data-label')), renderHTML: () => ({}) },
  }; },
  parseHTML() { return [{ tag: 'figure[data-wh-media-block="true"]' }]; },
  renderHTML({ node }) { return ['figure', { 'data-wh-media-block': 'true', 'data-project-id': blockIdentifier(node.attrs.projectId), 'data-asset-id': blockIdentifier(node.attrs.assetId), 'data-label': blockLabel(node.attrs.label) }, ['figcaption', {}, `Media: ${blockLabel(node.attrs.label)}`]]; },
  renderText({ node }) { return `[Media: ${blockLabel(node.attrs.label)}]`; },
  addCommands() { return { insertLocalMediaBlock: target => ({ state, commands }) => {
    const attrs = { projectId: blockIdentifier(target.projectId), assetId: blockIdentifier(target.assetId), label: blockLabel(target.label) };
    if (!this.editor.isEditable || !attrs.assetId || attrs.projectId !== this.options.context().projectId) return false;
    const { from, to, $from, $to } = state.selection;
    if ($from.parent.type.name === CHAPTER_HEADING_NAME || $to.parent.type.name === CHAPTER_HEADING_NAME) return false;
    let crossesChapter = false; state.doc.nodesBetween(from, to, node => { if (node.type.name === CHAPTER_HEADING_NAME) crossesChapter = true; });
    return !crossesChapter && commands.insertContent({ type: this.name, attrs });
  } }; },
  addNodeView() { return this.options.nodeView ? ReactNodeViewRenderer(MediaBlockView) : null; },
});
