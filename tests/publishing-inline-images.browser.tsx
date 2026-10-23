// The manuscript's own pictures in DOCX and ePub, when the profile keeps
// them: stored pictures travel with their width; linked ones never do; off,
// the portable formats carry none, as before.
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import type { Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function png(): string {
  const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#3d85c6'; ctx.fillRect(0, 0, 80, 40);
  return canvas.toDataURL('image/png');
}

export async function testPublishingInlineImages(): Promise<string[]> {
  const content = `<p>El faro de noche.</p><img src="${png()}" alt="El faro" data-wh-width="50" data-wh-frame="polaroid"><p>Y la costa.</p><img src="https://example.com/remote.png" alt="lejos">`;
  const writings: Writing[] = [{ id: 'ii-1', projectId: 'ii', title: 'El faro', status: 'draft', content, wordCount: 6, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 }];
  const profile: PublishingProfile = { id: 'ii-p', projectId: 'ii', name: 'Libro', format: 'manuscript', includeTitlePage: false, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1, includeInlineImages: true };
  const on = buildPublishingArtifacts({ id: 'ii', title: 'La sal' }, profile, writings, [], { generatedAt: 1 });
  const portable = on.document.sections[0].portableHtml;
  assert((portable.match(/<img/g) ?? []).length === 1 && /data-wh-width="50"/.test(portable) && on.document.omittedPortableImageCount === 1, `Kept stored, dropped linked: ${portable.slice(0, 200)}`);
  const off = buildPublishingArtifacts({ id: 'ii', title: 'La sal' }, { ...profile, includeInlineImages: false }, writings, [], { generatedAt: 1 });
  assert(!/<img/.test(off.document.sections[0].portableHtml) && off.document.omittedPortableImageCount === 2, 'Off: none, as before');
  const { default: JSZip } = await import('jszip');
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(on.document)).arrayBuffer());
  const section = await epub.file('EPUB/section-1.xhtml')!.async('string');
  const opf = await epub.file('EPUB/package.opf')!.async('string');
  assert(epub.file('EPUB/images/inline-1-1.png') && /<img class="wh-inline-image wh-frame-polaroid" src="images\/inline-1-1\.png" alt="El faro" style="width:50%" \/>/.test(section) && /media-type="image\/png"/.test(opf) && !/example\.com/.test(section), `EPUB: ${section.slice(0, 500)}`);
  const offEpub = await JSZip.loadAsync(await (await buildPublishingEpub(off.document)).arrayBuffer());
  assert(!/<img/.test(await offEpub.file('EPUB/section-1.xhtml')!.async('string')), 'Off ePub has no image');
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(on.document)).arrayBuffer());
  const media = Object.keys(docx.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'));
  const xml = await docx.file('word/document.xml')!.async('string');
  // 50 % of the 520 px text block, 2:1 → 260 × 130 px (EMU = px × 9525).
  assert(media.length === 1 && xml.includes(`cx="${260 * 9525}" cy="${130 * 9525}"`), `DOCX: ${media.join()} ${(/<wp:extent[^>]*>/.exec(xml) ?? [''])[0]}`);
  return ['Pictures in DOCX and ePub: with the option on, the stored picture of "El faro" travels (ePub file images/inline-1-1.png with its polaroid frame at 50%; Word embeds it 260 × 130 px, half the text block) and the linked web picture is still left out and counted; off, both formats carry none, as before'];
}
