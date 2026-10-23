import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import { createSheet } from '@/engines/character-sheets/types';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { createCodexBlockHost } from '@/components/editor/codexBlocks/model';
import { ToolDocumentBlock } from '@/components/editor/toolBlocks/ToolDocumentBlock';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { toolBlockCopy } from '@/components/editor/toolBlocks/copy';

const P = 'tool-sheet-preview-regression';
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const block = (id: string) => `<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="character-sheets" data-document-id="${id}" data-label="Cached sheet must not be shown"><figcaption>Cached sheet must not be shown</figcaption></figure>`;
const normalized = (svg: Element) => svg.outerHTML.replace(/sheet-ink-[a-f\d-]+/g, 'sheet-ink-ID');
const expected = (sheet: ReturnType<typeof createSheet>, locale: 'en'|'es') => {
  const container = document.createElement('div'); container.innerHTML = sheetPaper(sheet, locale).svg;
  return normalized(container.querySelector('svg')!);
};

export async function testToolSheetPreview(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host), passed: string[] = [];
  const sheet = createSheet('coc7', 'Saved investigator <safe>'); sheet.revision = 1;
  sheet.details.notes = '<script>unsafe source</script> & authored detail';
  sheet.ink = { version: 1, surface: 'paper-v1', width: 1000, strokes: [{ id: 'existing-ink', tool: 'pen', color: '#272b2b', width: 3, points: [{ x: 15, y: 20000 }, { x: 30, y: 20001 }] }] };
  const project: Project = { id: P, title: 'Preview QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1, characterSheets: [sheet] };
  let editor: Editor | null = null, changes = 0, stopReader: (() => void) | undefined;
  const waitFor = async (check: () => boolean, message: string) => { for (let i = 0; i < 70; i++) { if (check()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const context = createCodexBlockHost({ projectId: P, scopeId: 'sheet-preview' });
  function Fixture({ editable }: { editable: boolean }) {
    const current = useEditor({ editable, extensions: [StarterKit, ToolDocumentBlock.configure(context)], content: '<p>Host prose</p>' + block(sheet.id) + block('missing'), onUpdate: () => { changes++; } });
    useEffect(() => { editor = current; }, [current]);
    return <EditorContent editor={current} />;
  }
  try {
    await db.projects.put(project);
    for (const [locale, editable] of [['en', true], ['es', false]] as const) {
      await act(async () => { useLocaleStore.setState({ locale, loaded: true }); await pause(); });
      const sourceBefore = JSON.stringify(await db.projects.get(P));
      await act(async () => { root.render(<MemoryRouter><Fixture key={locale} editable={editable} /></MemoryRouter>); await pause(); });
      await waitFor(() => host.textContent?.includes(sheet.title) === true, 'real sheet NodeView did not resolve');
      const views = host.querySelectorAll('[data-wh-tool-live-view]'), paper = views[0].querySelector('svg[data-sheet-paper]');
      assert(paper, `Actual ${editable ? 'editable' : 'readonly'} Tiptap NodeView resolves the saved sheet title but omits its paper`);
      assert(normalized(paper) === expected(sheet, locale), 'NodeView changed the existing paper, coordinates, ink or localized content');
      assert(!views[0].querySelector('script') && views[0].textContent?.includes('<script>unsafe source</script>'), 'Authored sheet content was not escaped');
      await waitFor(() => views[1].textContent?.includes(toolBlockCopy[locale].unavailable) === true, 'missing sheet did not show unavailable state');
      assert(!views[1].querySelector('[data-sheet-paper]') && !views[1].textContent?.includes('Cached sheet must not be shown'), 'Missing source exposed cached paper/title');
      assert(editor && editor.isEditable === editable, 'Fixture did not exercise requested editor mode');
      const hostBefore = editor.getHTML(), changesBefore = changes;
      const reader = document.createElement('div'); reader.innerHTML = block(sheet.id) + block('missing'); host.append(reader);
      stopReader = hydrateToolDocumentBlocks(reader, P, locale);
      await waitFor(() => Boolean(reader.querySelector('[data-sheet-paper]')), 'Reader did not hydrate sheet paper');
      assert(normalized(reader.querySelector('[data-sheet-paper]')!) === normalized(paper), 'Reader and NodeView paper differ');
      assert(JSON.stringify(await db.projects.get(P)) === sourceBefore, 'Preview/Reader changed saved sheet or project');
      sheet.title += ' revised';
      await act(async () => { await db.projects.update(P, { characterSheets: [sheet] }); await pause(); });
      await waitFor(() => views[0].querySelector('[data-sheet-paper]')?.getAttribute('aria-label') === sheet.title, 'Saved source update did not refresh embedded paper');
      assert(editor.getHTML() === hostBefore && changes === changesBefore, 'Live preview edited host content or undo');
      assert(normalized(views[0].querySelector('[data-sheet-paper]')!) === expected(sheet, locale), 'Refreshed paper no longer matches native renderer');
      stopReader(); stopReader = undefined; reader.remove();
      passed.push(`Actual ${editable ? 'editable EN' : 'readonly ES'} Tiptap sheet NodeView and Reader render identical escaped paper/ink, refresh source without host edits and handle missing sheet`);
    }
    return passed;
  } finally { stopReader?.(); await act(async () => { root.unmount(); await pause(); }); await db.projects.delete(P); }
}
