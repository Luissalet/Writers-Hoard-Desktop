import type { Editor } from '@tiptap/core';
import { CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
import { blockIdentifier, blockLabel, type CodexBlockTarget } from './model';
export function canInsertCodexTextLink(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { from, to, $from, $to } = editor.state.selection;
  if ($from.parent.type.name === CHAPTER_HEADING_NAME || $to.parent.type.name === CHAPTER_HEADING_NAME) return false;
  let crosses = false; editor.state.doc.nodesBetween(from, to, node => { if (node.type.name === CHAPTER_HEADING_NAME) crosses = true; });
  return !crosses;
}
/** Ordinary semantic links keep custom selected prose and existing format
 * export compatible; the scoped mention plugin supplies editor activation. */
export function insertCodexTextLink(editor: Editor, hostProjectId: string, target: CodexBlockTarget): boolean {
  if (!canInsertCodexTextLink(editor) || hostProjectId !== target.projectId || !blockIdentifier(target.entryId) || !blockIdentifier(target.projectId)) return false;
  const href = `/project/${encodeURIComponent(target.projectId)}/codex?entry=${encodeURIComponent(target.entryId)}`;
  return editor.state.selection.empty
    ? editor.chain().focus().insertContent({ type: 'text', text: blockLabel(target.label) || 'Codex', marks: [{ type: 'link', attrs: { href, target: null } }] }).run()
    : editor.chain().focus().setLink({ href, target: null }).run();
}
export function codexTextLinkTarget(href: string, projectId: string): string | undefined {
  try { const url = new URL(href, 'https://writer.invalid'); if (url.origin === 'https://writer.invalid' && url.pathname === `/project/${encodeURIComponent(projectId)}/codex`) return blockIdentifier(url.searchParams.get('entry')) || undefined; } catch { /* Unrelated/invalid links are ordinary text. */ }
}
