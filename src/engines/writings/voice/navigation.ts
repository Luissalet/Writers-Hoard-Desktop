import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { DialogueAnchor } from './dialogue';

/** Project the manuscript paragraphs onto ProseMirror document positions. */
export function findDialogueRange(doc: ProseMirrorNode, anchor: DialogueAnchor) {
  let text = '';
  const positions: number[] = [];
  doc.descendants((node, position) => {
    if (node.isBlock || node.type.name === 'hardBreak') {
      text += '\n';
      positions.push(position);
    }
    if (!node.isText || !node.text) return;
    text += node.text.replace(/\u00a0/g, ' ');
    for (let i = 0; i < node.text.length; i++) positions.push(position + i);
  });

  const start = text.length - text.trimStart().length;
  const paragraphs = text.trim().split(/(\n+)/);
  let offset = start;
  for (let index = 0; index < paragraphs.length; index += 2) {
    const paragraph = paragraphs[index];
    if (index / 2 === anchor.paragraph) {
      if (paragraph.slice(anchor.column, anchor.column + anchor.quote.length) !== anchor.quote) return null;
      const from = positions[offset + anchor.column];
      const last = positions[offset + anchor.column + anchor.quote.length - 1];
      return from === undefined || last === undefined ? null : { from, to: last + 1 };
    }
    offset += paragraph.length + (paragraphs[index + 1]?.length ?? 0);
  }
  return null;
}

export function navigateEditorToDialogue(editor: Editor, anchor: DialogueAnchor): boolean {
  const range = findDialogueRange(editor.state.doc, anchor);
  if (!range) return false;
  return editor.chain().focus().setTextSelection(range).scrollIntoView().run();
}
