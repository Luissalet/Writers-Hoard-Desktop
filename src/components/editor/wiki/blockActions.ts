// ============================================
// Block actions — fold, copy and extract the block the cursor is in
// ============================================
// A card or chapter is one rich-text body; these act on its outermost block
// (a paragraph, a list, a table, a box…): fold it under a one-line title
// (a toggle the reader opens), copy it with its formatting, or move it out
// into a Codex card of its own, leaving a live reference where it stood.

import type { Editor } from '@tiptap/core';
import { DOMSerializer, Fragment, type Node as PMNode } from '@tiptap/pm/model';

/** The outermost block around the cursor, with its position. */
export function outerBlockAt(editor: Editor): { pos: number; node: PMNode } | null {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) {
    const node = editor.state.doc.nodeAt($from.pos);
    return node && node.isBlock ? { pos: $from.pos, node } : null;
  }
  const node = $from.node(1);
  if (!node || node.type.name === 'chapterHeading') return null;
  return { pos: $from.before(1), node };
}

export function blockHtml(editor: Editor, node: PMNode): string {
  const host = document.createElement('div');
  host.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(node)));
  return host.innerHTML;
}

/** A short title for a block: its first words. */
export function blockTitle(text: string, fallback: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

/** Fold the block under a title (a toggle); a toggle unfolds back into its blocks. */
export function toggleFold(editor: Editor, fallbackTitle: string): boolean {
  const found = outerBlockAt(editor);
  const { schema } = editor.state;
  if (!found || !schema.nodes.toggleBlock || !schema.nodes.toggleSummary) return false;
  const { pos, node } = found;
  if (node.type.name === 'toggleBlock') {
    const inner: PMNode[] = [];
    node.forEach(child => { if (child.type.name !== 'toggleSummary') inner.push(child); });
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, inner));
    return true;
  }
  const title = blockTitle(node.textContent, fallbackTitle);
  const folded = schema.nodes.toggleBlock.create(null, [schema.nodes.toggleSummary.create(null, schema.text(title)), node]);
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, folded));
  return true;
}

/** Put the block on the clipboard as HTML (pastes with its formatting) and plain text. */
export async function copyBlock(editor: Editor): Promise<boolean> {
  const found = outerBlockAt(editor);
  if (!found) return false;
  const html = blockHtml(editor, found.node), text = found.node.textContent;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the block with a live Codex reference to `entryId` (the card the
 * block was moved into). Returns the block's HTML and title for the card.
 */
export function extractBlock(editor: Editor, fallbackTitle: string): { html: string; title: string; replace: (projectId: string, entryId: string) => boolean } | null {
  const found = outerBlockAt(editor);
  if (!found || found.node.type.name === 'codexLiveBlock') return null;
  const { pos, node } = found;
  const title = blockTitle(node.textContent, fallbackTitle);
  return {
    html: blockHtml(editor, node),
    title,
    replace: (projectId, entryId) => {
      const type = editor.state.schema.nodes.codexLiveBlock;
      const current = editor.state.doc.nodeAt(pos);
      if (!type || current !== node) return false;
      editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, type.create({ projectId, entryId, label: title })));
      return true;
    },
  };
}
