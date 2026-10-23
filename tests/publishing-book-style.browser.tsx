// Book style: one feel sets every chapter at compile time — alignment, line
// height, indents, a drop cap, small capitals on the opening line, scene-break
// and title ornaments, title size — in HTML, ePub and DOCX, in the preview and
// through the bridge; a paragraph formatted by hand keeps its own settings.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import BookStylePanel from '@/components/project/BookStylePanel';
import PublishingPreviewPane from '@/components/project/PublishingPreviewPane';
import { applyBookStyle, bookPreset, normalizeBookStyle, type BookStyle } from '@/engines/writings/bookStyle';
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testPublishingBookStyle(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const chapter = '<p>Llegó al puerto de noche.</p><p>Nadie la esperaba.</p><hr><p>Al alba subió al faro.</p><p data-wh-align="center">FIN DE LA PRIMERA PARTE</p>';

  const classic = bookPreset('classic');
  const doc = new DOMParser().parseFromString(applyBookStyle(chapter, classic), 'text/html');
  const ps = [...doc.querySelectorAll('p')];
  assert(ps[0].dataset.whDropCap === 'true' && ps[0].classList.contains('wh-book-opening') && ps[0].dataset.whFirstLineIndent === '0', 'Opening paragraph: drop cap, small capitals, flush');
  assert(ps[1].dataset.whFirstLineIndent === '1.5' && ps[1].dataset.whAlign === 'justify' && ps[1].dataset.whLineHeight === '1.5' && /text-align:\s*justify/.test(ps[1].getAttribute('style') ?? ''), `Body paragraph: ${ps[1].outerHTML}`);
  assert(doc.querySelector('hr')?.getAttribute('data-wh-ornament') === 'asterism' && ps[2].dataset.whFirstLineIndent === '0', 'Scene break takes the ornament; the paragraph after it starts flush');
  assert(ps[3].dataset.whAlign === 'center', 'A paragraph centred by hand stays centred');
  const modern = new DOMParser().parseFromString(applyBookStyle(chapter, bookPreset('modern')), 'text/html');
  assert([...modern.querySelectorAll('p')].every(p => p.dataset.whFirstLineIndent === '0') && !modern.querySelector('[data-wh-drop-cap]'), 'Modern: spaced, no indents, no drop cap');
  assert(normalizeBookStyle({ preset: 'epic', titleSize: 99, align: 'centre' })?.titleSize === 36 && normalizeBookStyle({ preset: 'epic', align: 'centre' })?.align === 'justify' && normalizeBookStyle('x') === undefined, 'Stored values are clamped and checked');
  passed.push('Compile: "Novela clásica" gives the opening paragraph a drop cap and small capitals, indents the rest 1.5 em justified at 1.5, puts ⁂ on bare scene breaks and starts the paragraph after one flush; "Moderno" spaces paragraphs with no indents; a paragraph centred by hand stays centred');

  const writings: Writing[] = [
    { id: 'bs-1', projectId: 'bs', title: 'El puerto', status: 'draft', content: chapter, wordCount: 20, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'bs-2', projectId: 'bs', title: 'El faro', status: 'draft', content: '<p>Otra noche.</p><p>Otro día.</p>', wordCount: 4, chapter: 2, tags: [], createdAt: 1, updatedAt: 1 },
  ];
  const profile: PublishingProfile = { id: 'bs-p', projectId: 'bs', name: 'Libro', format: 'manuscript', includeTitlePage: false, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1, bookStyle: bookPreset('epic') };
  const artifacts = buildPublishingArtifacts({ id: 'bs', title: 'La sal' }, profile, writings, [], { generatedAt: 1 });
  assert(/@page\{size:152\.4mm 228\.6mm;margin:19mm\}/.test(artifacts.html) && /html,body\{background:#eedfbf;color:#3a2a16\}/.test(artifacts.html), 'HTML/PDF: 6×9 page on parchment');
  assert(/\.chapter-title\{font-size:26pt\}/.test(artifacts.html) && /class="wh-title-ornament"[^>]*>—</.test(artifacts.html) && /data-wh-drop-cap="true"/.test(artifacts.html), 'HTML: title size, ornament, drop cap');
  const plain = buildPublishingArtifacts({ id: 'bs', title: 'La sal' }, { ...profile, bookStyle: undefined }, writings, [], { generatedAt: 1 });
  assert(!plain.html.includes('class="wh-title-ornament"') && !/<p[^>]*data-wh-drop-cap="true"/.test(plain.html) && !plain.html.includes('@page{size'), 'No style: as written');

  const { default: JSZip } = await import('jszip');
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(artifacts.document)).arrayBuffer());
  const xml = await docx.file('word/document.xml')!.async('string');
  assert(/<w:pgSz w:w="8640" w:h="12960"/.test(xml) && /<w:background w:color="eedfbf"/.test(xml), `DOCX page: ${(/<w:pgSz[^>]*>/.exec(xml) ?? [''])[0]}`);
  assert(/<w:jc w:val="both"\/>/.test(xml) && /w:line="341"/.test(xml) && /<w:sz w:val="52"\/>/.test(xml) && xml.includes('w:dropCap'), `DOCX: justified, 1.42 lines, 26 pt titles, drop cap`);
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(artifacts.document)).arrayBuffer());
  const css = await epub.file('EPUB/styles.css')!.async('string');
  const section = await epub.file('EPUB/section-1.xhtml')!.async('string');
  assert(css.includes('section.chapter > h1{font-size:26pt}') && /class="wh-book-opening"/.test(section) && /data-wh-drop-cap="true"/.test(section) && section.includes('wh-title-ornament'), `EPUB: ${section.slice(0, 600)}`);
  passed.push('Exports: "Tomo épico" prints on a 6 × 9 in page (PDF @page and the Word page size) on parchment, 26 pt chapter titles with a dash under them and a drop cap in HTML/PDF, justified 1.42 lines with a Word drop cap and 26 pt titles in DOCX, and the same classes and stylesheet in the ePub');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let latest: BookStyle | undefined;
  function Harness() {
    const [style, setStyle] = useState<BookStyle | undefined>(undefined);
    latest = style;
    return (
      <div>
        <BookStylePanel value={style} onChange={setStyle} />
        <PublishingPreviewPane project={{ id: 'bs', title: 'La sal' }} profile={{ ...profile, bookStyle: style }} writings={writings} />
      </div>
    );
  }
  const select = async (testid: string, value: string) => {
    const element = document.querySelector(`[data-testid="${testid}"]`) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })); await pause(500); });
  };
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(400); });
    assert(!document.querySelector('[data-testid="publishing-preview-book-css"]') && /Tal como está escrito/.test(document.querySelector('[data-testid="publishing-book-preset"]')?.textContent ?? ''), 'Starts as written');
    await select('publishing-book-preset', 'classic');
    assert(latest?.preset === 'classic' && document.querySelector('[data-testid="publishing-preview-ornament"]')?.textContent === '◇', 'Classic: ◇ under titles in the preview');
    const first = document.querySelector('.wh-preview-prose p') as HTMLElement;
    assert(getComputedStyle(first).textAlign === 'justify', `Preview justified: ${getComputedStyle(first).textAlign}`);
    await select('publishing-book-align', 'left');
    assert(latest?.preset === 'custom' && latest.align === 'left' && getComputedStyle(document.querySelector('.wh-preview-prose p') as HTMLElement).textAlign === 'left', 'Changing a setting makes it custom');
    await select('publishing-book-trim', 'a4');
    assert(latest?.trim === 'a4' && /a 400 palabras por página/.test(document.body.textContent ?? ''), 'A4 holds 400 words a page in the estimate');
    await select('publishing-book-title-ornament', 'none');
    assert(!document.querySelector('[data-testid="publishing-preview-ornament"]'), 'No ornament');
    await select('publishing-book-preset', 'none');
    assert(latest === undefined && !document.querySelector('[data-testid="publishing-preview-book-css"]'), 'Back to as written');
    passed.push('Profile dialog: "Estilo del libro" starts "Tal como está escrito"; "Novela clásica" justifies the preview and puts ◇ under each title; changing the alignment to "En bandera" turns it "Personalizado"; "A4" re-counts the pages at 400 words a page; back to "Tal como está escrito" removes it');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'bs-project';
  try {
    await db.projects.put({ id: P, title: 'La sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } as Project);
    await db.writings.bulkPut(writings.map(w => ({ ...w, projectId: P })));
    const created = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Libro', bookStyle: 'epic' });
    const profileId = (created.result as { profile: { id: string } }).profile.id;
    assert(created.ok && (await db.publishingProfiles.get(profileId))?.bookStyle?.titleSize === 26, JSON.stringify(created).slice(0, 300));
    const tuned = await runBridgeTool('wh_publishing_profile_set', { projectId: P, profileId, bookStyle: { titleSize: 30, sceneBreak: 'diamond' } });
    const stored = (await db.publishingProfiles.get(profileId))?.bookStyle;
    assert(tuned.ok && stored?.preset === 'custom' && stored.titleSize === 30 && stored.sceneBreak === 'diamond' && stored.titleOrnament === 'line', `Tuned: ${JSON.stringify(stored)}`);
    const compiled = await runBridgeTool('wh_publishing_compile', { projectId: P, profileId, output: 'html' });
    assert(compiled.ok && (compiled.result as { text: string; bookStyle: string }).text.includes('font-size:30pt') && (compiled.result as { bookStyle: string }).bookStyle === 'custom', 'Compiled with the style');
    const bad = await runBridgeTool('wh_publishing_profile_set', { projectId: P, profileId, bookStyle: 'gothic' });
    assert(!bad.ok, 'Unknown preset refused');
    const cleared = await runBridgeTool('wh_publishing_profile_set', { projectId: P, profileId, bookStyle: null });
    assert(cleared.ok && !(await db.publishingProfiles.get(profileId))?.bookStyle, 'null prints as written');
    passed.push('Bridge: wh_publishing_profile_set takes a preset ("epic"), then settings on top of it (30 pt titles, ◇ breaks: "custom"), refuses an unknown preset and null goes back to as written; wh_publishing_compile prints it');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
