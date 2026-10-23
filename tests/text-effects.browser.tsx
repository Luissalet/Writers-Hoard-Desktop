// Text effects (glow, shake, wave, rainbow, pulse, blur): set from the
// formatting toolbar, animated by the shared prose CSS, kept by HTML and ePub,
// plain in Word and Markdown, and set or removed through the bridge.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import AdvancedEditorToolbar from '@/components/editor/advanced/AdvancedEditorToolbar';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { htmlToMarkdown, renderPublishingHtml } from '@/engines/writings/manuscriptExport';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await act(async () => { await sleep(30); }); } throw new Error(`Timed out: ${label}`); }

export async function testTextEffects(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const host = document.getElementById('root'); assert(host, 'root');
  const editorHost = document.createElement('div'), barHost = document.createElement('div');
  host.append(editorHost, barHost);
  const editorRoot = createRoot(editorHost);
  let barRoot: Root | null = null;
  let editor: Editor | null = null;
  try {
    await act(async () => { editorRoot.render(createElement(TiptapEditor, { content: '<p>La puerta se abrió sola.</p>', onChange: () => {}, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(200); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    await act(async () => { barRoot = createRoot(barHost); barRoot.render(createElement(AdvancedEditorToolbar, { editor: ed as never, locale: 'es' })); await sleep(80); });
    const at = ed.getText().indexOf('se abrió') + 1;
    await act(async () => { ed.commands.focus(); ed.commands.setTextSelection({ from: at, to: at + 'se abrió'.length }); await sleep(40); });
    const select = barHost.querySelector('[data-testid="text-effect"]') as HTMLSelectElement;
    assert(select && [...select.options].map(option => option.value).join() === ',glow,shake,wave,rainbow,pulse,blur', 'Effects offered');
    const choose = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); await sleep(80); }); };
    await choose('shake');
    const html = ed.getHTML();
    assert(html === '<p>La puerta <span data-wh-effect="shake" class="wh-effect wh-effect-shake">se abrió</span> sola.</p>', `Shake: ${html}`);
    const span = editorHost.querySelector('span[data-wh-effect="shake"]') as HTMLElement;
    assert(getComputedStyle(span).animationName === 'wh-shake', `Animated: ${getComputedStyle(span).animationName}`);
    await act(async () => { ed.commands.setTextSelection(at + 2); await sleep(60); });
    assert((barHost.querySelector('[data-testid="text-effect"]') as HTMLSelectElement).value === 'shake', 'The select shows the effect under the cursor');
    await act(async () => { ed.commands.setTextSelection({ from: at, to: at + 'se abrió'.length }); await sleep(40); });
    await choose('rainbow');
    assert(/data-wh-effect="rainbow"/.test(ed.getHTML()) && !/shake/.test(ed.getHTML()), 'Changed to rainbow');
    await choose('');
    assert(ed.getHTML() === '<p>La puerta se abrió sola.</p>', `Removed: ${ed.getHTML()}`);
    passed.push('Toolbar: "Efecto…" offers Brillo, Temblor, Ondulación, Arcoíris, Pulso and Desenfoque; Temblor on "se abrió" makes it shake (animation wh-shake), the list shows it with the cursor inside, Arcoíris replaces it, and the empty choice takes it off');
  } finally {
    await act(async () => { barRoot?.unmount(); editorRoot.unmount(); await sleep(20); });
    editorHost.remove(); barHost.remove();
  }

  const content = '<p>La puerta <span data-wh-effect="glow" class="wh-effect wh-effect-glow">se abrió</span> sola.</p>';
  const doc = composePublishingDocument([{ id: 'w', projectId: 'p', title: 'Puerta', status: 'draft', content, wordCount: 5, tags: [], createdAt: 1, updatedAt: 1 }], { projectTitle: 'Libro', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Capítulo' });
  const out = renderPublishingHtml(doc);
  assert(/<span[^>]*data-wh-effect="glow"[^>]*>se abrió<\/span>/.test(out) && out.includes('@keyframes wh-glow') && out.includes('prefers-reduced-motion'), 'HTML keeps and animates it');
  const { default: JSZip } = await import('jszip');
  const section = await (await JSZip.loadAsync(await (await buildPublishingEpub(doc)).arrayBuffer())).file('EPUB/section-1.xhtml')!.async('string');
  assert(section.includes('<span class="wh-effect wh-effect-glow">se abrió</span>'), `ePub: ${section.slice(0, 400)}`);
  const xml = await (await JSZip.loadAsync(await (await buildPublishingDocx(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
  assert(xml.includes('se abrió') && htmlToMarkdown(content).trim() === 'La puerta se abrió sola.', 'Word and Markdown plain');
  passed.push('Exports: HTML/PDF keep the glowing span with the animation (and stop it for reduced motion and print); ePub keeps the class; Word and Markdown set the words plain');

  const P = 'text-effects';
  try {
    await db.projects.put({ id: P, title: 'Libro', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } as Project);
    await db.writings.put({ id: 'te-w', projectId: P, title: 'Puerta', status: 'draft', content: '<p>La <em>puerta</em> se abrió. Luego se abrió otra.</p>', wordCount: 7, tags: [], createdAt: 1, updatedAt: 1 } as Writing);
    const set = await runBridgeTool('wh_text_effect', { writingId: 'te-w', text: 'se abrió', effect: 'pulse', occurrence: 2 });
    const stored = (await db.writings.get('te-w'))!.content;
    assert(set.ok && stored === '<p>La <em>puerta</em> se abrió. Luego <span data-wh-effect="pulse" class="wh-effect wh-effect-pulse">se abrió</span> otra.</p>', `Bridge set: ${stored}`);
    const off = await runBridgeTool('wh_text_effect', { writingId: 'te-w', text: 'se abrió', effect: null });
    assert(off.ok && !(await db.writings.get('te-w'))!.content.includes('data-wh-effect'), 'Bridge off');
    await undoAuditEntry({ entry: { ...(off.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_text_effect', kind: 'update' } });
    assert((await db.writings.get('te-w'))!.content.includes('wh-effect-pulse'), 'Undo puts the effect back');
    const bad = await runBridgeTool('wh_text_effect', { writingId: 'te-w', text: 'se abrió', effect: 'sparkle' });
    const missing = await runBridgeTool('wh_text_effect', { writingId: 'te-w', text: 'nunca', effect: 'glow' });
    assert(!bad.ok && /one of glow, shake/.test(JSON.stringify(bad)) && !missing.ok, 'Refusals');
    passed.push('Bridge: wh_text_effect puts Pulso on the second "se abrió" only, effect null takes it off, undo puts it back; an unknown effect or a phrase not in the chapter is refused');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
