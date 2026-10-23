// The three prep blocks as editor nodes. Each is one atom whose data lives in a
// single attribute; the stored HTML is the readable block from engines/prepBlocks/model,
// and a React view draws the controls while writing.
import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { ReactElement } from 'react';
import type { CodexBlockHost } from '../codexBlocks/model';
import { checkText, encounterRowText, handoutText, normalizePrep, parsePrepData, prepBlockElement, type CheckData, type EncounterData, type HandoutData, type PrepKind, type PrepLang } from '@/engines/prepBlocks/model';
import CheckBlockView from './CheckBlockView';
import EncounterBlockView from './EncounterBlockView';
import HandoutBlockView from './HandoutBlockView';

export const PREP_NODE_NAMES: Record<PrepKind, string> = { check: 'prepCheck', encounter: 'prepEncounter', handout: 'prepHandout' };
export type PrepHost = CodexBlockHost & { nodeView: boolean };

function prepNode(kind: PrepKind, View: (props: NodeViewProps) => ReactElement) {
  const tag = kind === 'handout' ? 'figure' : 'div';
  return Node.create<PrepHost>({
    name: PREP_NODE_NAMES[kind], group: 'block', atom: true, selectable: true, draggable: true,
    addOptions() { return { context: () => ({}), nodeView: true }; },
    addAttributes() { return { data: { default: normalizePrep(kind, {}), parseHTML: element => parsePrepData(kind, element.getAttribute('data-wh-prep-data')), renderHTML: () => ({}) } }; },
    parseHTML() { return [{ tag: `${tag}[data-wh-prep="${kind}"]` }]; },
    renderHTML({ node, HTMLAttributes }) { return prepBlockElement(kind, node.attrs.data, HTMLAttributes as Record<string, string>); },
    renderText({ node }) {
      const data = normalizePrep(kind, node.attrs.data);
      return kind === 'check' ? checkText(data as CheckData) : kind === 'encounter' ? `${(data as EncounterData).title}: ${(data as EncounterData).rows.map(encounterRowText).join(', ')}` : handoutText(data as HandoutData);
    },
    addNodeView() { return this.options.nodeView ? ReactNodeViewRenderer(View) : null; },
  });
}
export const PrepCheck = prepNode('check', CheckBlockView);
export const PrepEncounter = prepNode('encounter', EncounterBlockView);
export const PrepHandout = prepNode('handout', HandoutBlockView);

/** Put a new block of this kind at the caret. A check and an encounter are for the table only, so they start out kept from the wiki. */
export function insertPrepBlock(editor: Editor, kind: PrepKind, lang: PrepLang): boolean {
  return editor.chain().focus().insertContent({ type: PREP_NODE_NAMES[kind], attrs: { data: normalizePrep(kind, { lang }), wikiHidden: kind !== 'handout' } }).run();
}
