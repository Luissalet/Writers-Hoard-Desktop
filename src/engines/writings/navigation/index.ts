import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { CHAPTER_HEADING_NAME } from '@/components/editor/chapterHeading/chapterBlocks';

export interface WritingHeading {
  level: number;
  text: string;
  /** Positions before and after the heading node in the current document. */
  from: number;
  to: number;
  chapterId?: string;
}

export function deriveWritingHeadings(doc: ProseMirrorNode): WritingHeading[] {
  const headings: WritingHeading[] = [];
  let chapterId: string | undefined;
  doc.descendants((node, from, parent) => {
    const chapter = node.type.name === CHAPTER_HEADING_NAME && parent === doc;
    if (chapter) chapterId = typeof node.attrs.writingId === 'string' && node.attrs.writingId ? node.attrs.writingId : undefined;
    if (!chapter && node.type.name !== 'heading') return;
    const level = chapter ? 1 : Number(node.attrs.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) return false;
    headings.push({ level, text: node.textContent, from, to: from + node.nodeSize, ...(chapterId ? { chapterId } : {}) });
    return false;
  });
  return headings;
}
