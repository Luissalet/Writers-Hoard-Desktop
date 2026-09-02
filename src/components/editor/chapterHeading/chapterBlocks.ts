// ============================================
// Chapter headings — the pure half
// ============================================
//
// Everything about a book document that needs no editor and no React: the
// node's name, the transaction meta that lets a heading go, and the walk that
// cuts a document into chapter blocks. `ChapterHeadingNode.ts` (the Tiptap
// extension) and `engines/writings/bookDocument.ts` (the save model) both read
// this file, and neither has to import the other.

import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { generateId } from '@/utils/idGenerator';

/** The node's name in the schema, and what `editor.isActive` is asked for. */
export const CHAPTER_HEADING_NAME = 'chapterHeading';

/**
 * The heading's content group. Not `block`, on purpose: a blockquote or a
 * list item takes `block+`, and a heading that could be wrapped in one would
 * stop being a chapter boundary while keeping its id — the guard would let
 * the wrap through, and the save would write the chapter's prose twice. Only
 * the book's own document node (`BookDocument`) admits the group.
 */
export const CHAPTER_GROUP = 'chapter';

/** The attribute every serialised heading carries, so a pasted one parses as a chapter and a bare `h1` does not. */
export const CHAPTER_HEADING_ATTR = 'data-chapter-heading';

/**
 * Transaction meta naming the writing ids whose heading this transaction is
 * allowed to drop. Without it, a transaction that loses a heading is refused
 * outright (see the guard plugin in the node): a chapter's heading is the only
 * thing that keeps its prose from silently becoming the previous chapter's.
 */
export const CHAPTER_HEADING_REMOVAL_META = 'chapterHeadingRemoval';

/**
 * A per-editor identity for a heading node. Never persisted: it exists so an
 * autosave that created a row can find, afterwards, the heading it created it
 * for — the document may have moved under the write, so a position or an
 * index would not do.
 */
export function freshClientId(): string {
  return generateId('chh');
}

/** One chapter's span in the document: its heading (if any) and its prose. */
export interface ChapterBlock {
  /** Position of the block's first top-level node. */
  from: number;
  /** Position after the block's last top-level node. */
  to: number;
  /** Position of the heading node, or null for prose before the first heading. */
  headingPos: number | null;
  writingId: string | null;
  clientId: string | null;
}

/**
 * Cut a document into chapter blocks along its top-level headings. Only
 * top-level headings count: a heading that ended up inside a blockquote or a
 * list is content, and is saved as such.
 */
export function chapterBlocks(doc: ProseMirrorNode, type: NodeType): ChapterBlock[] {
  const blocks: ChapterBlock[] = [];
  let current: ChapterBlock | null = null;
  let offset = 0;
  // A plain loop rather than `doc.forEach`: a closure assigning `current`
  // leaves TypeScript believing it is still null afterwards.
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type === type) {
      if (current) {
        current.to = offset;
        blocks.push(current);
      }
      current = {
        from: offset,
        to: offset + node.nodeSize,
        headingPos: offset,
        writingId: typeof node.attrs.writingId === 'string' ? node.attrs.writingId : null,
        clientId: typeof node.attrs.clientId === 'string' ? node.attrs.clientId : null,
      };
    } else if (!current) {
      current = { from: offset, to: offset, headingPos: null, writingId: null, clientId: null };
    }
    offset += node.nodeSize;
  }
  if (current) {
    current.to = doc.content.size;
    blocks.push(current);
  }
  return blocks;
}

/**
 * The writing ids carried by headings anywhere in `doc`. Descends into
 * containers (a blockquote, a list) but not into textblocks, so the walk costs
 * one visit per block rather than one per character.
 */
export function headingWritingIds(doc: ProseMirrorNode, type: NodeType): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type === type) {
      if (typeof node.attrs.writingId === 'string') ids.add(node.attrs.writingId);
      return false;
    }
    return !node.isTextblock;
  });
  return ids;
}

/**
 * How many top-level headings carry each writing id. A multiset, not a set:
 * a heading pasted back beside its original makes two of one id, and a
 * transaction that took one of them away must still be seen to have taken
 * a heading. Only the top level counts, because only a top-level heading is
 * a chapter boundary (see `CHAPTER_GROUP`).
 */
export function topLevelHeadingCounts(doc: ProseMirrorNode, type: NodeType): Map<string, number> {
  const counts = new Map<string, number>();
  doc.forEach((node) => {
    if (node.type !== type || typeof node.attrs.writingId !== 'string') return;
    counts.set(node.attrs.writingId, (counts.get(node.attrs.writingId) ?? 0) + 1);
  });
  return counts;
}

/**
 * Position of the nearest chapter heading before `pos` at the top level, or
 * null when `pos` is in the first chapter (or in the prose before it).
 */
export function previousHeadingPos(doc: ProseMirrorNode, type: NodeType, pos: number): number | null {
  const index = doc.resolve(pos).index(0);
  let offset = pos;
  for (let i = index - 1; i >= 0; i--) {
    const child = doc.child(i);
    offset -= child.nodeSize;
    if (child.type === type) return offset;
  }
  return null;
}

/** Position of the nearest chapter heading after `pos` at the top level, or null. */
export function nextHeadingPos(doc: ProseMirrorNode, type: NodeType, pos: number): number | null {
  const index = doc.resolve(pos).index(0);
  let offset = pos + doc.child(index).nodeSize;
  for (let i = index + 1; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type === type) return offset;
    offset += child.nodeSize;
  }
  return null;
}
