// A whole block kept out of the published wiki: "Ocultar este bloque de la
// wiki" marks the paragraph the cursor is in; the wiki leaves it out.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { WikiHidden, WikiHiddenBlock, WikiSpoiler } from '@/components/editor/wiki/marks';
import { WikiMarksControls } from '@/components/editor/wiki/WikiMarks';
import { buildWorldWiki } from '@/services/worldWikiExport';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testWikiHiddenBlock(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'root');
  const editorHost = document.createElement('div'); host.appendChild(editorHost);
  const controlsHost = document.createElement('div'); host.appendChild(controlsHost);
  const editor = new Editor({ element: editorHost, extensions: [StarterKit, WikiHidden, WikiSpoiler, WikiHiddenBlock], content: '<p>El faro guía a los barcos.</p><p>El farero es el traidor.</p>' });
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(controlsHost); root.render(createElement(WikiMarksControls, { editor, locale: 'es' })); await pause(); });
    // The cursor in the second paragraph.
    const second = editor.state.doc.child(0).nodeSize + 2;
    await act(async () => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, second))); await pause(); });
    (controlsHost.querySelector('details') as HTMLDetailsElement).open = true;
    await act(async () => { (controlsHost.querySelector('[data-testid="wiki-hide-block"]') as HTMLButtonElement).click(); await pause(); });
    const html = editor.getHTML();
    assert(/<p data-wh-wiki-hidden="true"[^>]*>El farero es el traidor\.<\/p>/.test(html) && !/<p[^>]*data-wh-wiki-hidden[^>]*>El faro guía/.test(html), `Marked: ${html}`);
    assert(controlsHost.querySelector('[data-testid="wiki-hide-block"]')?.getAttribute('aria-pressed') === 'true', 'Pressed');
    const project = { id: 'whb', title: 'Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 } as Project;
    const entry = { id: 'whb-1', projectId: 'whb', type: 'location', title: 'El faro', content: html, fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry;
    const wiki = buildWorldWiki({ project, entries: [entry], maps: [], pins: [], images: [] }, { includeImages: false, locale: 'es' }).html;
    assert(wiki.includes('El faro guía a los barcos.') && !wiki.includes('El farero es el traidor.'), 'The wiki leaves the block out');
    // Again: shown again.
    await act(async () => { (controlsHost.querySelector('[data-testid="wiki-hide-block"]') as HTMLButtonElement).click(); await pause(); });
    assert(!/data-wh-wiki-hidden/.test(editor.getHTML()), 'Unmarked');
    return ['Wiki visibility: "Ocultar este bloque de la wiki" marks the whole paragraph "El farero es el traidor." (outlined in the editor), the exported wiki leaves it out and keeps the other; pressed again it is shown'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    editor.destroy(); editorHost.remove(); controlsHost.remove();
  }
}
