import Link from '@tiptap/extension-link';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode, Mark } from '@tiptap/pm/model';
import { CODEX_IMAGE_ATTRIBUTE, codexImageTarget } from '@/services/codexReference/imageHtml';

export const CodexLink = Link.extend({
  addCommands() {
    const parent = this.parent?.();
    return { ...parent, setLink: attributes => props => {
      const target = codexImageTarget(attributes.href);
      const changedTarget = (mark: Mark) => {
        const previous = codexImageTarget(mark.attrs.href);
        return previous && (!target || previous.projectId !== target.projectId || previous.entryId !== target.entryId);
      };
      let retarget = false;
      const {from,to,$from} = props.state.selection;
      if (from === to) retarget = $from.marks().some(mark => mark.type.name === 'link' && changedTarget(mark));
      else props.state.doc.nodesBetween(from,to,node => { if (node.marks.some(mark => mark.type.name === 'link' && changedTarget(mark))) retarget = true; });
      const next = { ...attributes, ...(retarget ? {codexImage:false} : {}) };
      return parent?.setLink?.(next)(props) ?? false;
    } };
  },
  addAttributes() {
    return { ...this.parent?.(), codexImage: {
      default: false,
      parseHTML: element => element.getAttribute(CODEX_IMAGE_ATTRIBUTE) === 'true' && Boolean(codexImageTarget(element.getAttribute('href'))),
      renderHTML: attributes => attributes.codexImage === true && codexImageTarget(attributes.href) ? { [CODEX_IMAGE_ATTRIBUTE]: 'true' } : {},
    } };
  },
});

export interface CodexLinkOccurrence { from: number; to: number; mark: Mark }
/** Equal Link attrs define one appearance; bold/revision partitions do not. */
export function codexLinkOccurrences(doc: PmNode): CodexLinkOccurrence[] {
  const occurrences: CodexLinkOccurrence[] = [];
  doc.descendants((node, position) => {
    if (!node.isInline) return;
    const mark = node.marks.find(mark => mark.type.name === 'link');
    if (!mark || !codexImageTarget(mark.attrs.href)) return;
    const previous = occurrences.at(-1);
    if (previous && previous.to === position && previous.mark.eq(mark)) previous.to += node.nodeSize;
    else occurrences.push({ from: position, to: position + node.nodeSize, mark });
  });
  return occurrences;
}

export function selectedCodexLink(editor: Editor, projectId: string, range: {from:number;to:number} = editor.state.selection): CodexLinkOccurrence | undefined {
  if (editor.isDestroyed || !editor.isEditable || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from > range.to) return;
  const candidates = codexLinkOccurrences(editor.state.doc).filter(item => item.from <= range.from && item.to >= range.to && codexImageTarget(item.mark.attrs.href)?.projectId === projectId);
  // At a boundary between distinct appearances the caret is ambiguous.
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The UI and MCP use the same finite, atomic gesture and writer history. */
export function setCodexLinkImage(editor: Editor, projectId: string, value: boolean, range: {from:number;to:number} = editor.state.selection): boolean {
  if (typeof value !== 'boolean') return false;
  const occurrence = selectedCodexLink(editor, projectId, range);
  if (!occurrence) return false;
  if (occurrence.mark.attrs.codexImage === value) return true;
  const { from, to, mark } = occurrence;
  editor.view.dispatch(editor.state.tr.addMark(from, to, mark.type.create({ ...mark.attrs, codexImage: value })));
  return true;
}
