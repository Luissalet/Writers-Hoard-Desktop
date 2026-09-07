import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface EditorQuoteRange {
  from: number;
  to: number;
}

function closestOccurrence(text: string, quote: string, preferredStart?: number): number {
  let cursor = text.indexOf(quote);
  if (cursor < 0 || preferredStart === undefined) return cursor;
  let closest = cursor;
  let distance = Math.abs(cursor - preferredStart);
  while (cursor >= 0) {
    const next = text.indexOf(quote, cursor + Math.max(1, quote.length));
    if (next < 0) break;
    const nextDistance = Math.abs(next - preferredStart);
    if (nextDistance < distance) {
      closest = next;
      distance = nextDistance;
    }
    cursor = next;
  }
  return closest;
}

/**
 * Map an exact prose quote back through ProseMirror's node boundaries.
 * Findings store plain-text anchors because HTML formatting may change; this
 * rebuilds the character→document-position map at navigation time.
 */
export function findQuoteRangeInDocument(
  doc: ProseMirrorNode,
  quote: string,
  preferredStart?: number,
): EditorQuoteRange | null {
  let text = '';
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isBlock && text && !text.endsWith('\n')) {
      text += '\n';
      positions.push(pos);
    }
    if (!node.isText || !node.text) return;
    for (let index = 0; index < node.text.length; index++) {
      text += node.text[index];
      positions.push(pos + index);
    }
  });
  let index = closestOccurrence(text, quote, preferredStart);
  let length = quote.length;
  if (index < 0) {
    const wanted = quote.replace(/\s+/g, ' ').trim();
    let collapsed = '';
    const collapsedToOriginal: number[] = [];
    let whitespace = false;
    for (let cursor = 0; cursor < text.length; cursor++) {
      if (/\s/.test(text[cursor])) {
        if (whitespace) continue;
        whitespace = true;
        collapsed += ' ';
        collapsedToOriginal.push(cursor);
      } else {
        whitespace = false;
        collapsed += text[cursor];
        collapsedToOriginal.push(cursor);
      }
    }
    const foldedPreferred = preferredStart === undefined
      ? undefined
      : collapsedToOriginal.findIndex(original => original >= preferredStart);
    const found = closestOccurrence(
      collapsed,
      wanted,
      foldedPreferred === -1 ? collapsed.length : foldedPreferred,
    );
    if (found < 0) return null;
    index = collapsedToOriginal[found];
    const last = collapsedToOriginal[found + wanted.length - 1] ?? index;
    length = last - index + 1;
  }
  const from = positions[index];
  const last = positions[index + length - 1];
  if (from === undefined || last === undefined) return null;
  return { from, to: last + 1 };
}

export function navigateEditorToQuote(editor: Editor, quote: string, preferredStart?: number): boolean {
  const range = findQuoteRangeInDocument(editor.state.doc, quote, preferredStart);
  if (!range) return false;
  editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  return true;
}
