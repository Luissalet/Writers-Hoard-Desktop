import type { Project, Writing } from '@/types';
import { db } from '@/db';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { encodeLocalMedia } from '@/engines/media/portability';
import { mediaKind } from '@/engines/media/types';
import { codexBlockPreview } from '@/components/editor/codexBlocks/model';
import { readerColor, readerInk, readerRaster, safeReaderPresentation } from './readerPresentation';
import type { ReaderPresentation } from './readerPresentationTypes';
import { READER_PRESENTATION_CSS } from './readerPresentationStyle';
import { installReaderSoundtrack, readerSoundChapter } from './readerSoundtrack';
import { prepareToolDocumentBlocksForExport } from '@/components/editor/toolBlocks/preview';
import { codexTextLinkTarget } from '@/components/editor/codexBlocks/inlineLinks';
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const chapterKey = (id: string) => `chapter-${[...new TextEncoder().encode(id)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
function coverMarkup(project: Project, cover: ReaderPresentation['cover'], locale: 'es' | 'en') {
  const depth = cover.style === 'hardcover' ? 24 : cover.style === 'paperback' ? 12 : 3;
  return `<div class="wh-reader-cover" style="--book-color:${cover.color};--book-ink:${readerInk(cover.color)};--book-depth:${depth}px;--book-half:${depth / 2}px"><div class="wh-reader-cover-stage"><div class="wh-reader-book" role="img" aria-label="${esc(project.title)}" style="transform:rotateX(8deg) rotateY(-25deg)"><div class="wh-reader-book-back"></div><div class="wh-reader-book-pages"></div><div class="wh-reader-book-spine"><span>${esc(project.title)}</span></div><div class="wh-reader-book-front" data-texture="${cover.texture}">${cover.artwork && readerRaster(project.coverImage) ? `<img src="${esc(project.coverImage)}" alt="">` : `<span>${esc(project.title)}</span>`}</div></div></div><label class="angle">${locale === 'es' ? 'Girar portada' : 'Rotate cover'} <input data-cover-angle type="range" min="-65" max="65" value="-25"></label></div>`;
}
/** Standalone reader: only explicitly linked, same-project local assets are embedded. */
export async function buildReaderHtml(project: Project, writings: Writing[], presentation: ReaderPresentation, locale: 'es' | 'en') {
  const safe = safeReaderPresentation(presentation); const pieces = writings.filter(writing => writing.projectId === project.id);
  const mediaIds = new Set<string>(), entryIds = new Set<string>(), linkedEntries = new Set<string>();
  const soundChapters = pieces.map(piece => readerSoundChapter(piece.id, safe.chapters[piece.id]));
  for (const chapter of soundChapters) for (const track of [chapter.audio, ...chapter.cues.map(cue => cue.track)]) if (track) mediaIds.add(track.assetId);
  const contents = await Promise.all(pieces.map(async piece => {
    const template = document.createElement('template'); template.innerHTML = await prepareToolDocumentBlocksForExport(sanitizeRichHtml(piece.content), project.id, locale);
    for (const block of template.content.querySelectorAll('[data-wh-media-block="true"], [data-wh-codex-block="true"]')) {
      if (block.getAttribute('data-project-id') !== project.id) { block.remove(); continue; }
      const media = block.hasAttribute('data-wh-media-block'); const id = block.getAttribute(media ? 'data-asset-id' : 'data-entry-id');
      if (id) (media ? mediaIds : entryIds).add(id);
    }
    for (const image of template.content.querySelectorAll('img')) if (!readerRaster(image.getAttribute('src') ?? undefined)) image.remove();
    for (const anchor of template.content.querySelectorAll('a[href]')) { const id = codexTextLinkTarget(anchor.getAttribute('href')!, project.id); if (id) { entryIds.add(id); linkedEntries.add(id); } }
    return template;
  }));
  const [media, entries] = await Promise.all([db.localMediaAssets.bulkGet([...mediaIds]), db.codexEntries.bulkGet([...entryIds])]);
  const encoded = new Map((await Promise.all(media.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset && asset.projectId === project.id)).map(encodeLocalMedia))).map(asset => [asset.id, asset]));
  for (const template of contents) {
    for (const block of template.content.querySelectorAll('[data-wh-media-block="true"]')) {
      const asset = encoded.get(block.getAttribute('data-asset-id') ?? ''); if (!asset) { block.remove(); continue; }
      const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = asset.title;
      const player = document.createElement(mediaKind(asset.mime) === 'video' ? 'video' : 'audio'); player.controls = true; player.preload = 'metadata'; player.src = asset.dataUrl; figure.append(caption, player); block.replaceWith(figure);
    }
    for (const block of template.content.querySelectorAll('[data-wh-codex-block="true"]')) {
      const entry = entries.find(entry => entry && entry.id === block.getAttribute('data-entry-id') && entry.projectId === project.id); if (!entry) { block.remove(); continue; }
      const preview = codexBlockPreview(entry), aside = document.createElement('aside'), heading = document.createElement('h3'), body = document.createElement('p'); aside.className = 'wh-reader-codex-reference'; heading.textContent = preview.title; body.textContent = preview.text; aside.append(heading, body); block.replaceWith(aside);
    }
    for (const anchor of template.content.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')!, id = codexTextLinkTarget(href, project.id); if (!id) { if (!(href.startsWith('#') && [...template.content.querySelectorAll('[id]')].some(element => element.id === href.slice(1)))) anchor.removeAttribute('href'); continue; }
      if (entries.some(entry => entry && entry.id === id && entry.projectId === project.id)) anchor.setAttribute('href', `#codex-${chapterKey(id)}`); else anchor.removeAttribute('href');
    }
  }
  const referenceAppendix = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.projectId === project.id && linkedEntries.has(entry.id))).map(entry => { const preview = codexBlockPreview(entry); return `<aside id="codex-${chapterKey(entry.id)}" class="reader-section"><h2>${esc(preview.title)}</h2><p>${esc(preview.text)}${preview.truncated ? '…' : ''}</p><a href="#top">${locale === 'es' ? 'Índice' : 'Contents'}</a></aside>`; }).join('');
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map(value => value.toString(16).padStart(2, '0')).join('');
  const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const sounds = Object.fromEntries([...encoded].filter(([, asset]) => mediaKind(asset.mime) === 'audio').map(([id, asset]) => [id, asset.dataUrl]));
  const hasSound = soundChapters.some(chapter => chapter.audio || chapter.cues.length);
  const soundScript = hasSound ? `(${installReaderSoundtrack.toString()})(document.body,document.querySelector('[data-reader-sound-toggle]'),document.querySelector('[data-reader-sound-status]'),${scriptJson(soundChapters)},${scriptJson(sounds)},${scriptJson(locale === 'es' ? { enable: 'Activar ambientación', disable: 'Silenciar ambientación', blocked: 'No se pudo reproducir. Desactiva y vuelve a activar la ambientación.', unavailable: 'Una pista local no está disponible.' } : { enable: 'Enable ambience', disable: 'Mute ambience', blocked: 'Playback failed. Toggle ambience off and on to retry.', unavailable: 'A local track is unavailable.' })});` : '';
  const previous = locale === 'es' ? 'Página anterior' : 'Previous page', next = locale === 'es' ? 'Página siguiente' : 'Next page';
  const sections = pieces.map((piece, index) => {
    const chapter = safe.chapters[piece.id], background = readerColor(chapter?.background), ink = readerInk(background) || '#272820';
    const font = chapter?.font === 'sans' ? 'system-ui,sans-serif' : chapter?.font === 'mono' ? 'monospace' : 'Georgia,serif';
    const image = chapter?.imageLayout !== 'none' && readerRaster(chapter?.image) ? `<img class="wh-reader-chapter-image ${chapter.imageLayout === 'beside' ? 'wh-reader-image-beside' : ''}" src="${esc(chapter.image)}" alt="">` : '';
    return `<section id="${chapterKey(piece.id)}" data-piece-id="${esc(piece.id)}" class="reader-section wh-reader-themed ${chapter?.mode === 'pages' ? 'wh-reader-pages' : ''}" style="background:${background || '#faf7ef'};color:${ink};--reader-ink:${ink};--reader-font:${font}">${image}<h2>${esc(piece.title)}</h2><div class="ProseMirror" tabindex="0">${contents[index].innerHTML}</div>${chapter?.mode === 'pages' ? `<div class="pager"><button data-reader-turn="-1">${previous}</button><button data-reader-turn="1">${next}</button></div>` : ''}<a href="#top">${locale === 'es' ? 'Índice' : 'Contents'}</a></section>`;
  }).join('');
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(project.title)}</title><style>${READER_PRESENTATION_CSS}*{box-sizing:border-box}body{margin:0;background:#eee9df;color:#272820;font:18px/1.75 Georgia,serif}header,nav,.reader-section{max-width:900px;margin:auto;padding:28px}header{text-align:center}h1{font-size:2.2rem}h2{font-size:1.5rem}nav a{display:block}.reader-section{margin:24px auto;overflow:auto}.ProseMirror img{max-width:100%;height:auto}audio,video{display:block;width:100%;max-height:28rem}aside{border:1px solid currentColor;padding:16px;margin:20px 0}a{color:inherit}button{font:inherit;padding:8px 16px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer}.pager{display:flex;justify-content:space-between;gap:12px;margin:20px 0}.angle{display:block;text-align:center;font:14px system-ui}input{accent-color:${safe.cover.color}}:focus-visible{outline:3px solid #805d1a;outline-offset:3px}@media(max-width:720px){header,nav,.reader-section{padding:20px}.reader-section{margin:12px 0}}</style></head><body id="top"><header>${safe.cover.showAtStart ? coverMarkup(project, safe.cover, locale) : ''}<h1>${esc(project.title)}</h1>${hasSound ? '<p><button data-reader-sound-toggle aria-pressed="false"></button><span data-reader-sound-status role="status"></span></p>' : ''}</header><nav aria-label="${locale === 'es' ? 'Índice' : 'Contents'}">${pieces.map(piece => `<a href="#${chapterKey(piece.id)}">${esc(piece.title)}</a>`).join('')}</nav><main>${sections}${referenceAppendix}</main><script nonce="${nonce}">document.querySelectorAll('[data-cover-angle]').forEach(input=>input.addEventListener('input',()=>{input.closest('.wh-reader-cover').querySelector('.wh-reader-book').style.transform='rotateX(8deg) rotateY('+Number(input.value)+'deg)'}));document.querySelectorAll('[data-reader-turn]').forEach(button=>button.addEventListener('click',()=>{const prose=button.closest('section').querySelector('.ProseMirror');prose.scrollBy({left:Number(button.dataset.readerTurn)*prose.clientWidth,behavior:'instant'})}));${soundScript}</script></body></html>`;
  return { html, filename: `${project.title.replace(/[<>:"/\\|?*]/g, '_') || 'book'}-reader.html` };
}
