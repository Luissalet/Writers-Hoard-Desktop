import { deriveWritingHeadings } from '@/engines/writings/navigation';
import { createWritingEditor, writingForEditorial } from './editorialDocument';
import type { ToolArgs } from './shared';
export async function whGetWritingHeadings(args: ToolArgs) {
  const writing = await writingForEditorial(args, false); const editor = createWritingEditor(writing.content);
  try { return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt, headings: deriveWritingHeadings(editor.state.doc) }; }
  finally { editor.destroy(); }
}
