// Chapter header images: the Reader presentation's image of each chapter,
// above its title, beside it or as a banner with the chapter label, printed in
// HTML, ePub (as a file in the book) and DOCX when the profile asks, in the
// preview, and in the Reader with the new banner layout.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PublishingPreviewPane from '@/components/project/PublishingPreviewPane';
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { safeReaderPresentation } from '@/engines/writings/readerPresentation';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

/** A 2×1 PNG drawn here, so the test needs no file. */
function png(color: string): string {
  const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 40, 20);
  return canvas.toDataURL('image/png');
}

export async function testPublishingChapterImages(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const writings: Writing[] = [
    { id: 'ci-1', projectId: 'ci', title: 'El puerto', status: 'draft', content: '<p>Uno.</p>', wordCount: 1, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'ci-2', projectId: 'ci', title: 'El faro', status: 'draft', content: '<p>Dos.</p>', wordCount: 1, chapter: 2, tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'ci-3', projectId: 'ci', title: 'La isla', status: 'draft', content: '<p>Tres.</p>', wordCount: 1, chapter: 3, kicker: 'Interludio', tags: [], createdAt: 1, updatedAt: 1 },
  ];
  const base = safeReaderPresentation(undefined);
  const readerPresentation = { ...base, chapters: {
    'ci-1': { font: 'inherit', background: '', image: png('#3d85c6'), imageLayout: 'above', mode: 'flow' },
    'ci-2': { font: 'inherit', background: '', image: png('#c0504d'), imageLayout: 'beside', mode: 'flow' },
    'ci-3': { font: 'inherit', background: '', image: png('#6aa84f'), imageLayout: 'banner', mode: 'flow' },
  } } as Project['readerPresentation'];
  const project = { id: 'ci', title: 'La sal', readerPresentation };
  const profile: PublishingProfile = { id: 'ci-p', projectId: 'ci', name: 'Libro', format: 'manuscript', includeTitlePage: false, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1, includeChapterImages: true };
  const artifacts = buildPublishingArtifacts(project, profile, writings, [], { generatedAt: 1 });
  const html = artifacts.html;
  const at = (text: string) => html.indexOf(text);
  assert(at('class="wh-chapter-image wh-chapter-image--above"') < at('El puerto</h1>'), 'Above: the image opens the chapter');
  assert(at('El faro</h1>') < at('class="wh-chapter-image wh-chapter-image--beside"'), 'Beside: after the title, floated');
  assert(at('<p class="wh-chapter-label">Interludio</p>') < at('class="wh-chapter-image wh-chapter-image--banner"') && at('class="wh-chapter-image wh-chapter-image--banner"') < at('Interludio — La isla</h1>'), 'Banner: label, image, title');
  const off = buildPublishingArtifacts(project, { ...profile, includeChapterImages: false }, writings, [], { generatedAt: 1 });
  assert(!off.html.includes('class="wh-chapter-image'), 'Off by default');
  passed.push('HTML/PDF: "El puerto" opens with its image above the title, "El faro" floats it beside the title, and the banner chapter prints "Interludio", the image across the page, then its title; off unless the profile asks');

  const { default: JSZip } = await import('jszip');
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(artifacts.document)).arrayBuffer());
  const opf = await epub.file('EPUB/package.opf')!.async('string');
  const section3 = await epub.file('EPUB/section-3.xhtml')!.async('string');
  assert(epub.file('EPUB/images/section-1.png') && /href="images\/section-1\.png" media-type="image\/png"/.test(opf) && /<p class="wh-chapter-label">Interludio<\/p><img class="wh-chapter-image wh-chapter-image--banner" src="images\/section-3\.png"/.test(section3), `EPUB: ${section3.slice(0, 400)}`);
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(artifacts.document)).arrayBuffer());
  const media = Object.keys(docx.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'));
  const xml = await docx.file('word/document.xml')!.async('string');
  assert(media.length === 3 && xml.includes('INTERLUDIO') && /<wp:extent cx="\d+" cy="\d+"\/>/.test(xml), `DOCX: ${media.join(',')}`);
  passed.push(`ePub: each image travels as a file of the book (images/section-1.png…) with its manifest item and the banner keeps label → image → title; DOCX: the three images are embedded (${media.length} in word/media) with the label "INTERLUDIO" over the banner`);

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<PublishingPreviewPane project={project} profile={profile} writings={writings} />); await pause(400); });
    const images = [...document.querySelectorAll('[data-testid="publishing-preview-chapter-image"]')].map(image => (image as HTMLElement).dataset.layout);
    assert(images.join() === 'above,beside,banner', `Preview: ${images.join()}`);
    passed.push('Preview: the three chapters show their image above, beside and as a banner, as the files print them');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const reader = await buildReaderHtml({ id: 'ci', title: 'La sal', readerPresentation } as Project, writings, safeReaderPresentation(readerPresentation), 'es');
  assert(/<p class="wh-reader-chapter-label">Interludio<\/p><img class="wh-reader-chapter-image wh-reader-image-banner"/.test(reader.html), 'Reader edition banner');
  passed.push('Reader: the new "Etiqueta, imagen y título" layout prints the label, the image across the page and the title in the offline Reader edition');
  return passed;
}
