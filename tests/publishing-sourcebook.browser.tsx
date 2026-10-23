// A game sourcebook: read-aloud and sidebar boxes, a column break, page-wide
// images, and a "Manual de juego" book style that sets the chapters in two
// columns on Letter with striped tables — in the editor's blocks, the bridge's
// Markdown, HTML/PDF, Word and ePub, the style panel and the bridge.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import BookStylePanel from '@/components/project/BookStylePanel';
import { slashMatches } from '@/components/editor/blocks/slashCommands';
import { CALLOUT_KINDS, IMAGE_WIDTHS } from '@/components/editor/blocks/extensions';
import { bookPreset, bookStyleCss, normalizeBookStyle, type BookStyle } from '@/engines/writings/bookStyle';
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { markdownToTiptapHtml, tiptapHtmlToMarkdown } from '@/services/aiBridge/markdown';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function testPublishingSourcebook(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];

  assert(CALLOUT_KINDS.includes('readaloud') && CALLOUT_KINDS.includes('sidebar') && IMAGE_WIDTHS.includes('page'), 'Kinds');
  const ids = slashMatches('', 'es').map(item => item.id);
  assert(['readaloud', 'sidebar', 'columnbreak'].every(id => ids.includes(id)), `Slash: ${ids.join()}`);
  assert(slashMatches('voz', 'es').some(item => item.id === 'readaloud') && slashMatches('recuadro', 'es').some(item => item.id === 'sidebar') && slashMatches('columna', 'es').some(item => item.id === 'columnbreak'), 'Slash search');
  const html = markdownToTiptapHtml('> [!READALOUD]\n> La puerta cruje al abrirse.\n\n> [!SIDEBAR] Reglas opcionales\n> Tira 1d6.');
  assert(/<aside data-wh-callout="readaloud"><p>La puerta cruje al abrirse\.<\/p><\/aside>/.test(html) && /data-wh-callout="sidebar"/.test(html), `Markdown in: ${html}`);
  const back = tiptapHtmlToMarkdown(html);
  assert(/> \[!READALOUD\]\n> La puerta cruje/.test(back) && /> \[!SIDEBAR\]/.test(back), `Markdown out: ${back}`);
  passed.push('Blocks: "/Leer en voz alta", "/Recuadro" and "/Salto de columna" in the slash menu (found by "voz", "recuadro", "columna"); the bridge reads and writes > [!READALOUD] and > [!SIDEBAR] boxes; images can be page-wide');

  const style = bookPreset('sourcebook');
  assert(style.columns === 2 && style.stripedTables && style.trim === 'letter', 'Preset');
  assert(normalizeBookStyle({ preset: 'classic' })!.columns === 1 && normalizeBookStyle({ ...style, columns: 3 })!.columns === 2, 'Normalized');
  const css = bookStyleCss(style, '.content', '.chapter-title');
  assert(css.includes('.content{column-count:2') && css.includes('[data-wh-column-break]{break-before:column') && css.includes('img[data-wh-width="page"],.content h2{column-span:all') && css.includes('tr:nth-child(even) td{background'), `CSS: ${css}`);
  assert(!bookStyleCss(bookPreset('classic'), '.content', '.chapter-title').includes('column-count'), 'One column has no columns');

  const body = '<h2>Taberna del Ancla</h2><aside data-wh-callout="readaloud"><p>La puerta cruje al abrirse.</p></aside><p>El tabernero oculta un mapa.</p><div data-wh-column-break="true"></div><aside data-wh-callout="sidebar"><p>Tira 1d6 por ronda.</p></aside>'
    + '<table><tbody><tr><th>Tirada</th><th>Encuentro</th></tr><tr><td>1</td><td>Contrabandistas</td></tr><tr><td>2</td><td>Gaviotas</td></tr><tr><td>3</td><td>Nada</td></tr></tbody></table>'
    + `<img src="${PNG}" data-wh-width="page" alt="Mapa">`;
  const writings: Writing[] = [{ id: 'sb-1', projectId: 'sb', title: 'Aventura', status: 'draft', content: body, wordCount: 30, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 }];
  const profile: PublishingProfile = { id: 'sb-p', projectId: 'sb', name: 'Manual', format: 'manuscript', includeTitlePage: true, includeSynopsis: false, includeBibliography: false, includeInlineImages: true, citationStyle: 'apa', selectedWritingIds: [], bookStyle: style, createdAt: 1, updatedAt: 1 };
  const artifacts = buildPublishingArtifacts({ id: 'sb', title: 'Puerto Sal' }, profile, writings, [], { generatedAt: 1 });
  const out = artifacts.html;
  assert(out.includes('.content{column-count:2') && out.includes('@page{size:215.9mm 279.4mm') && /data-wh-callout="readaloud"/.test(out) && /data-wh-column-break/.test(out) && /data-wh-width="page"/.test(out), 'HTML/PDF in two columns on Letter');
  assert(out.includes('.content .wh-column-break { border: 0;'), 'The break mark does not print');
  passed.push('HTML and PDF: "Manual de juego" sets the chapters in two columns on US Letter; the column break starts the next column without printing its mark; titles, h2 and page-wide images span both; tables are striped');

  const { default: JSZip } = await import('jszip');
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(artifacts.document)).arrayBuffer());
  const xml = await docx.file('word/document.xml')!.async('string');
  const sections = [...xml.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(match => match[0]);
  assert(sections.length === 2 && !/w:num="2"/.test(sections[0]) && /<w:cols[^>]*w:num="2"/.test(sections[1]) && /w:type w:val="continuous"/.test(sections[1]), `DOCX sections: ${sections.join(' | ').slice(0, 600)}`);
  assert(/<w:br w:type="column"\/>/.test(xml), 'DOCX column break');
  assert(xml.includes('❝ Leer en voz alta') && xml.includes('w:fill="F3EAD7"') && xml.includes('▣ Recuadro') && xml.includes('La puerta cruje al abrirse.'), 'DOCX boxes');
  assert(xml.includes('w:fill="D9D9D9"') && xml.includes('w:fill="EFEFEF"'), 'DOCX striped table');
  assert(/<wp:extent cx="(\d+)"/.test(xml) && Number(/<wp:extent cx="(\d+)"/.exec(xml)![1]) > 4_000_000, 'DOCX page-wide image');
  passed.push('Word: the title page in one column, the chapters in a two-column section after it; a real column break; the read-aloud and sidebar boxes as shaded, bordered boxes with their labels; header row and alternate rows shaded; the page-wide map at full text width');

  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(artifacts.document)).arrayBuffer());
  const section = await epub.file('EPUB/section-1.xhtml')!.async('string');
  assert(section.includes('<aside class="wh-callout wh-callout-readaloud">') && section.includes('<aside class="wh-callout wh-callout-sidebar">') && !section.includes('data-wh-column-break') && /<img class="wh-inline-image"[^>]*style="width:100%"/.test(section), `ePub: ${section.slice(0, 900)}`);
  assert((await epub.file('EPUB/styles.css')!.async('string')).includes('aside.wh-callout-readaloud::before'), 'ePub box styles');
  passed.push('ePub: the boxes keep their look and label, the column break is left out of a reflowing book, the page-wide map fills the width');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let latest: BookStyle | undefined;
  function Harness() {
    const [value, setValue] = useState<BookStyle | undefined>(style);
    latest = value;
    return <BookStylePanel value={value} onChange={setValue} />;
  }
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(200); });
    const preset = document.querySelector('[data-testid="publishing-book-preset"]') as HTMLSelectElement;
    assert([...preset.options].some(option => option.value === 'sourcebook' && /Manual de juego/.test(option.textContent ?? '')), 'Preset offered');
    const columns = document.querySelector('[data-testid="publishing-book-columns"]') as HTMLSelectElement;
    assert(columns.value === '2' && (document.querySelector('[data-testid="publishing-book-striped-tables"]') as HTMLInputElement).checked, 'Controls show the preset');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(columns, '1'); columns.dispatchEvent(new Event('change', { bubbles: true })); await pause(80); });
    await act(async () => { (document.querySelector('[data-testid="publishing-book-striped-tables"]') as HTMLInputElement).click(); await pause(80); });
    assert(latest?.columns === 1 && latest.stripedTables === false && latest.preset === 'custom', `Changed: ${JSON.stringify(latest)}`);
    passed.push('Style panel: "Manual de juego (dos columnas)" in the presets; Columnas and "Tablas con filas alternas sombreadas" show it and change it (the style becomes custom)');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'sb-bridge';
  try {
    await db.projects.put({ id: P, title: 'Puerto Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } as Project);
    const created = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Manual', bookStyle: 'sourcebook' });
    assert(created.ok, JSON.stringify(created));
    const profileId = (created.result as { profile: { id: string } }).profile.id;
    assert((await db.publishingProfiles.get(profileId))?.bookStyle?.columns === 2, 'Bridge preset');
    const tuned = await runBridgeTool('wh_publishing_profile_set', { projectId: P, profileId, bookStyle: { columns: 1, stripedTables: false } });
    const stored = (await db.publishingProfiles.get(profileId))?.bookStyle;
    assert(tuned.ok && stored?.columns === 1 && stored.stripedTables === false && stored.trim === 'letter', `Bridge tuned: ${JSON.stringify(stored)}`);
    passed.push('Bridge: wh_publishing_profile_set bookStyle "sourcebook" stores two columns; {columns: 1, stripedTables: false} changes just those');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
