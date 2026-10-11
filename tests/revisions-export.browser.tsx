import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { createAdvancedExtensions } from '@/components/editor/advanced/extensions';
import { createRevisionExtensions, proposeRevision } from '@/engines/writings/revisions';
import { projectWritingHtml } from '@/engines/writings/revisionProjection';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import DocumentTools from '@/components/editor/documents/DocumentTools';
import type { Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testRevisionsExport(): Promise<string[]> {
  const host = document.createElement('div'); document.body.append(host);
  const editor = new Editor({ element: host, extensions: [StarterKit, FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions()], content: '<p><strong>Antiguo</strong></p><p>texto y nota<sup data-footnote-id="n1" data-footnote="Una nota"></sup>.</p>' });
  const original = editor.getHTML();
  const passed: string[] = [];
  try {
    assert(proposeRevision(editor, { from: 1, to: 11, text: 'Nuevo', author: 'Luis', source: 'editor' }).ok, 'Proposal failed');
    const pending = editor.getHTML();
    const final = projectWritingHtml(pending);
    const rejected = projectWritingHtml(pending, 'reject');
    assert(final.includes('Nuevo') && !final.includes('Antiguo') && !final.includes('data-wh-revision-kind') && final.includes('data-footnote-id="n1"'), final);
    assert(rejected === original, 'Original projection lost structure or formatting');
    assert(editor.getHTML() === pending, 'Projection mutated pending source');
    passed.push('Final/original projections preserve formatting, notes and exact pending source');
    const markdown = htmlToMarkdown(pending);
    assert(markdown.includes('Nuevo') && !markdown.includes('Antiguo') && markdown.includes('Una nota'), markdown);
    const writing = { id: 'qa-revision-export', projectId: 'qa-revision-project', title: 'QA', content: pending, wordCount: 100, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 } as Writing;
    const publication = composePublishingDocument([writing], { projectTitle: 'QA', chapterLabel: 'Capítulo', includeTitlePage: false, includeSynopsis: false });
    assert(publication.sections[0].html.includes('Nuevo') && !publication.sections[0].html.includes('Antiguo') && publication.wordCount < 100, 'Publishing exported both versions or stale counts');
    assert(editor.getHTML() === pending, 'Publishing changed the chapter');
    passed.push('Existing Markdown/publication exports use the final text without duplicate originals');
    const ui = document.createElement('div'); globalThis.document.body.append(ui);
    const root = createRoot(ui);
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const oldApi = window.electronAPI;
    window.electronAPI = { documents: { call: async (request: { tool: string; args: Record<string, unknown> }) => {
      const { tool, args } = request;
      calls.push(request);
      if (tool === 'wh_document_import') return { ok: true, result: { sessionId: 'qa-projection' } };
      if (tool === 'wh_document_render') return { ok: true, result: { dataBase64: 'iVBORw0KGgo=', mimeType: 'image/png', width: 1, height: 1 } };
      return { ok: true, result: {} };
    } } } as unknown as NonNullable<typeof window.electronAPI>;
    try {
      await act(async () => root.render(createElement(DocumentTools, { editor, locale: 'es' })));
      await act(async () => ui.querySelector<HTMLButtonElement>('[aria-label="Herramientas de documento"]')!.click());
      const choice = ui.querySelector<HTMLSelectElement>('[aria-label="Texto para descargar"]'); assert(choice, 'Review projection choice missing');
      await act(async () => { choice.value = 'reject'; choice.dispatchEvent(new Event('change', { bubbles: true })); });
      const preview = Array.from(ui.querySelectorAll('button')).find(button => button.textContent?.includes('Previsualizar página')); assert(preview, 'Preview control missing');
      await act(async () => { preview.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
      const imported = calls.find(call => call.tool === 'wh_document_import');
      assert(typeof imported?.args.html === 'string' && imported.args.html.includes('Antiguo') && !imported.args.html.includes('Nuevo'), 'Original view did not reach native service');
      assert(editor.getHTML() === pending, 'Panel altered pending source');
      passed.push('Document panel explicitly projects the chosen version into native preview while retaining editor proposals');
    } finally { window.electronAPI = oldApi; await act(async () => root.unmount()); ui.remove(); }
    return passed;
  } finally { editor.destroy(); host.remove(); }
}
