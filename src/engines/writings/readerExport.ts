import {voiceReadingMarkup,installVoiceReading,VOICE_READING_CSS} from '@/engines/media/voiceReading';
import {mediaFilename} from '@/engines/media/types';
import type { CodexEntry, Project, Writing } from '@/types';
import { listEraRows } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import { db } from '@/db';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { encodeLocalMedia } from '@/engines/media/portability';
import { mediaKind } from '@/engines/media/types';
import type { LocalMediaAsset } from '@/engines/media/types';
import { codexBlockPreview } from '@/components/editor/codexBlocks/model';
import { readerColor, readerInk, readerRaster, safeReaderPresentation } from './readerPresentation';
import type { ReaderPresentation } from './readerPresentationTypes';
import { READER_PRESENTATION_CSS } from './readerPresentationStyle';
import { installReaderSoundtrack, readerSoundChapter } from './readerSoundtrack';
import { installReaderPlayback, readerPlaybackCopy } from './readerPlayback';
import { prepareToolDocumentBlocksForExport } from '@/components/editor/toolBlocks/preview';
import { modelReaderExportScript } from '@/engines/model-viewer/offlineExport';
import type {ReaderSource} from './readerSource';
import {prepareSourceBlocksForExport} from '@/services/sourceBlockReading';
import {LOCAL_TOOL_PREVIEW_CSS} from '@/engines/local/previewTypes';
import {renderCoverSvg} from './coverDesign/render';
import { codexTextLinkTarget } from '@/components/editor/codexBlocks/inlineLinks';
import { footnoteAnchors, formatFootnoteMarker, normalizeFootnotePlacement, normalizeFootnoteStyle, renderBookEndnotesHtml, renderEndnotesHtml, renderFootnoteRefs, type EndnoteGroup } from '@/components/editor/footnotes/footnoteModel';
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const chapterKey = (id: string) => `chapter-${[...new TextEncoder().encode(id)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
function coverMarkup(project: Project, cover: ReaderPresentation['cover'], locale: 'es' | 'en') {
  const depth = cover.style === 'hardcover' ? 24 : cover.style === 'paperback' ? 12 : 3;
  const face=(name:'front'|'back'|'spine')=>`<div class="wh-reader-jacket-face">${renderCoverSvg(project.title,project.coverImage,cover,name)}</div>`;
  return `<div class="wh-reader-cover" style="--book-color:${cover.color};--book-ink:${readerInk(cover.color)};--book-depth:${depth}px;--book-half:${depth / 2}px"><div class="wh-reader-cover-stage"><div class="wh-reader-book" role="img" aria-label="${esc(project.title)}" style="transform:rotateX(8deg) rotateY(-25deg)"><div class="wh-reader-book-back">${cover.jacket?face('back'):''}</div><div class="wh-reader-book-pages"></div><div class="wh-reader-book-spine">${cover.jacket?face('spine'):`<span>${esc(project.title)}</span>`}</div><div class="wh-reader-book-front" data-texture="${cover.jacket?'none':cover.texture}">${cover.jacket?face('front'):cover.artwork && readerRaster(project.coverImage) ? `<img src="${esc(project.coverImage)}" alt="">` : `<span>${esc(project.title)}</span>`}</div></div></div><label class="angle">${locale === 'es' ? 'Girar portada' : 'Rotate cover'} <input data-cover-angle type="range" min="${cover.jacket?-180:-65}" max="${cover.jacket?180:65}" value="-25"></label></div>`;
}
/** Standalone reader: only explicitly linked, same-project local assets are embedded. */
export async function buildReaderHtml(project: Project, writings: Writing[], presentation: ReaderPresentation, locale: 'es' | 'en', scope: WorldEraScope = { projectId: project.id },source?:ReaderSource) {
  if (scope.projectId !== project.id) throw new Error('reader_project_mismatch');
  if(source&&source.project.id!==project.id)throw Error('reader_source_project_mismatch');
  const safe = safeReaderPresentation(presentation); const pieces = writings.filter(writing => writing.projectId === project.id);
  const mediaIds = new Set<string>(), entryIds = new Set<string>(), linkedEntries = new Set<string>();
  const soundChapters = pieces.map(piece => readerSoundChapter(piece.id, safe.chapters[piece.id]));
  for (const chapter of soundChapters) for (const track of [chapter.audio, ...chapter.cues.map(cue => cue.track)]) if (track) mediaIds.add(track.assetId);
  const contents = await Promise.all(pieces.map(async piece => {
    const policy={eraId:scope.eraId,source};
    const template = document.createElement('template'); template.innerHTML = await prepareSourceBlocksForExport(await prepareToolDocumentBlocksForExport(sanitizeRichHtml(piece.content),project.id,locale,policy), project.id, locale, policy);
    for (const block of template.content.querySelectorAll('[data-wh-media-block="true"], [data-wh-codex-block="true"]')) {
      if (block.getAttribute('data-project-id') !== project.id) { block.remove(); continue; }
      const media = block.hasAttribute('data-wh-media-block'); const id = block.getAttribute(media ? 'data-asset-id' : 'data-entry-id');
      if (id) (media ? mediaIds : entryIds).add(id);
    }
    for (const image of template.content.querySelectorAll('img')) if (!readerRaster(image.getAttribute('src') ?? undefined)) image.remove();
    for (const anchor of template.content.querySelectorAll('a[href]')) { const id = codexTextLinkTarget(anchor.getAttribute('href')!, project.id); if (id) { entryIds.add(id); linkedEntries.add(id); } }
    return template;
  }));
  const [rawMedia, rawEntries] = await Promise.all([source?source.rows('localMediaAssets').filter(row=>mediaIds.has(row.id)):scope.eraId ? listEraRows<LocalMediaAsset>(scope, 'localMediaAssets').then(rows => rows.filter(row => mediaIds.has(row.id))) : db.localMediaAssets.bulkGet([...mediaIds]),source?source.rows('codexEntries').filter(row=>entryIds.has(row.id)):scope.eraId ? listEraRows<CodexEntry>(scope, 'codexEntries').then(rows => rows.filter(row => entryIds.has(row.id))) : db.codexEntries.bulkGet([...entryIds])]);
  const media: (LocalMediaAsset | undefined)[] = rawMedia;
  const entries: (CodexEntry | undefined)[] = rawEntries;
  const encoded = new Map((await Promise.all(media.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset && asset.projectId === project.id)).map(encodeLocalMedia))).map(asset => [asset.id, asset]));
  for (const template of contents) {
    const voiceFigures:Array<{figure:HTMLElement;asset:Awaited<ReturnType<typeof encodeLocalMedia>>}>=[];
    for (const block of template.content.querySelectorAll('[data-wh-media-block="true"]')) {
      const asset = encoded.get(block.getAttribute('data-asset-id') ?? ''); if (!asset) { block.remove(); continue; }
      const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = asset.title;
      const player = document.createElement(mediaKind(asset.mime) === 'video' ? 'video' : 'audio'); player.controls = true; player.preload = 'metadata'; player.src = asset.dataUrl; figure.append(caption, player);voiceFigures.push({figure,asset}); block.replaceWith(figure);
    }
    for (const block of template.content.querySelectorAll('[data-wh-codex-block="true"]')) {
      const entry = entries.find(entry => entry && entry.id === block.getAttribute('data-entry-id') && entry.projectId === project.id); if (!entry) { block.remove(); continue; }
      const preview = codexBlockPreview(entry, project.codexTemplates), aside = document.createElement('aside'), heading = document.createElement('h3'), body = document.createElement('p'); aside.className = 'wh-reader-codex-reference'; heading.textContent = preview.title; body.textContent = preview.text; aside.append(heading, body); if (preview.fields.length) { const fields = document.createElement('dl'); for (const [label, value] of preview.fields) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; if (preview.fieldHtml[label]) detail.innerHTML = preview.fieldHtml[label]; else detail.textContent = value; fields.append(term, detail); } aside.append(fields); } block.replaceWith(aside);
    }
    for (const anchor of template.content.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')!, id = codexTextLinkTarget(href, project.id); if (!id) { if (!(href.startsWith('#') && [...template.content.querySelectorAll('[id]')].some(element => element.id === href.slice(1)))) anchor.removeAttribute('href'); continue; }
      if (entries.some(entry => entry && entry.id === id && entry.projectId === project.id)) anchor.setAttribute('href', `#codex-${chapterKey(id)}`); else anchor.removeAttribute('href');
    }
    for(const {figure,asset}of voiceFigures)if(template.content.contains(figure))figure.insertAdjacentHTML('beforeend',voiceReadingMarkup(asset,locale,{url:asset.dataUrl,filename:mediaFilename(asset)}));
  }
  const referenceAppendix = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.projectId === project.id && linkedEntries.has(entry.id))).map(entry => { const preview = codexBlockPreview(entry, project.codexTemplates); return `<aside id="codex-${chapterKey(entry.id)}" class="reader-section"><h2>${esc(preview.title)}</h2><p>${esc(preview.text)}${preview.truncated ? '…' : ''}</p>${preview.fields.length ? `<dl>${preview.fields.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${preview.fieldHtml[label] ?? esc(value)}</dd>`).join('')}</dl>` : ''}<a href="#top">${locale === 'es' ? 'Índice' : 'Contents'}</a></aside>`; }).join('');
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map(value => value.toString(16).padStart(2, '0')).join('');
  const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const sounds = Object.fromEntries([...encoded].filter(([, asset]) => mediaKind(asset.mime) === 'audio').map(([id, asset]) => [id, asset.dataUrl]));
  const hasSound = soundChapters.some(chapter => chapter.audio || chapter.cues.length);
  const soundScript = hasSound ? `(${installReaderSoundtrack.toString()})(document.body,document.querySelector('[data-reader-sound-toggle]'),document.querySelector('[data-reader-sound-status]'),${scriptJson(soundChapters)},${scriptJson(sounds)},${scriptJson(locale === 'es' ? { enable: 'Activar ambientación', disable: 'Silenciar ambientación', blocked: 'No se pudo reproducir. Desactiva y vuelve a activar la ambientación.', unavailable: 'Una pista local no está disponible.' } : { enable: 'Enable ambience', disable: 'Mute ambience', blocked: 'Playback failed. Toggle ambience off and on to retry.', unavailable: 'A local track is unavailable.' })});` : '';
  const previous = locale === 'es' ? 'Página anterior' : 'Previous page', next = locale === 'es' ? 'Página siguiente' : 'Next page';
  const playbackScript = `document.querySelectorAll('[data-piece-id]').forEach(article=>{const prose=article.querySelector('.ProseMirror'),controls=article.querySelector('[data-reader-playback-controls]');if(prose&&controls)(${installReaderPlayback.toString()})(prose,controls,${scriptJson(safe.playback)},${scriptJson(readerPlaybackCopy(locale))})});`;
  const bookNotes = normalizeFootnotePlacement(project.footnotePlacement) === 'book';
  const noteStyle = normalizeFootnoteStyle(project.footnoteStyle), notesLabel = locale === 'es' ? 'Notas' : 'Notes';
  const noteGroups: EndnoteGroup[] = []; let nextNote = 1;
  const sections = pieces.map((piece, index) => {
    const noteScope = index + 1;
    const footnotes = renderFootnoteRefs(contents[index].innerHTML, note => {
      const anchors = footnoteAnchors(note.id, noteScope);
      return `<sup class="wh-footnote-ref" id="${esc(anchors.ref)}"><a href="#${esc(anchors.note)}">${esc(formatFootnoteMarker(note.index, noteStyle))}</a></sup>`;
    }, bookNotes ? nextNote : 1);
    let endnotes = '';
    if (bookNotes) { nextNote += footnotes.notes.length; noteGroups.push({ title: piece.title, notes: footnotes.notes, scope: noteScope }); }
    else endnotes = renderEndnotesHtml(footnotes.notes, { heading: notesLabel, style: noteStyle, scope: noteScope });
    const chapter = safe.chapters[piece.id], background = readerColor(chapter?.background), ink = readerInk(background) || '#272820';
    const font = chapter?.font === 'sans' ? 'system-ui,sans-serif' : chapter?.font === 'mono' ? 'monospace' : 'Georgia,serif';
    const bannerLabel = piece.kicker?.trim() || (piece.chapter !== undefined ? `${locale === 'es' ? 'Capítulo' : 'Chapter'} ${piece.chapter}` : '');
    const image = chapter?.imageLayout !== 'none' && readerRaster(chapter?.image) ? `${chapter.imageLayout === 'banner' && bannerLabel ? `<p class="wh-reader-chapter-label">${esc(bannerLabel)}</p>` : ''}<img class="wh-reader-chapter-image ${chapter.imageLayout === 'beside' ? 'wh-reader-image-beside' : chapter.imageLayout === 'banner' ? 'wh-reader-image-banner' : ''}" src="${esc(chapter.image)}" alt="">` : '';
    return `<section id="${chapterKey(piece.id)}" data-piece-id="${esc(piece.id)}" class="reader-section wh-reader-themed ${chapter?.mode === 'pages' ? 'wh-reader-pages' : ''}" style="background:${background || '#faf7ef'};color:${ink};--reader-ink:${ink};--reader-font:${font}">${image}<h2>${esc(piece.title)}</h2><div data-reader-playback-controls class="wh-reader-playback" role="group" aria-label="${locale === 'es' ? 'Lectura por bloques' : 'Block reading'}"></div><div class="ProseMirror" tabindex="0">${footnotes.html}</div>${endnotes}${chapter?.mode === 'pages' ? `<div class="pager"><button data-reader-turn="-1">${previous}</button><button data-reader-turn="1">${next}</button></div>` : ''}<a href="#top">${locale === 'es' ? 'Índice' : 'Contents'}</a></section>`;
  }).join('');
  const bookEndnotes = bookNotes ? renderBookEndnotesHtml(noteGroups, { heading: notesLabel, style: noteStyle }) : '';
  const hasModels = sections.includes('data-wh-model-reader="true"');
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:${hasModels?' blob:':''}; media-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${hasModels?"data: blob:":"'none'"}; base-uri 'none'; form-action 'none'"><title>${esc(project.title)}</title><style>${READER_PRESENTATION_CSS}${LOCAL_TOOL_PREVIEW_CSS}${VOICE_READING_CSS}*{box-sizing:border-box}body{margin:0;background:#eee9df;color:#272820;font:18px/1.75 Georgia,serif}header,nav,.reader-section{max-width:900px;margin:auto;padding:28px}header{text-align:center}h1{font-size:2.2rem}h2{font-size:1.5rem}nav a{display:block}.reader-section{margin:24px auto;overflow:auto}.ProseMirror img{max-width:100%;height:auto}.wh-endnotes{font-size:.85em;border-top:1px solid currentColor;margin:2em 0;padding-top:.6em}.wh-endnotes li{margin:.4em 0}.wh-endnotes-marked{list-style:none;padding-left:0}.wh-endnotes--book{max-width:900px;margin:24px auto;padding:28px}.wh-footnote-ref a{text-decoration:none}audio,video{display:block;width:100%;max-height:28rem}aside{border:1px solid currentColor;padding:16px;margin:20px 0}a{color:inherit}button{font:inherit;padding:8px 16px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer}.pager{display:flex;justify-content:space-between;gap:12px;margin:20px 0}.angle{display:block;text-align:center;font:14px system-ui}input{accent-color:${safe.cover.color}}:focus-visible{outline:3px solid #805d1a;outline-offset:3px}@media(max-width:720px){header,nav,.reader-section{padding:20px}.reader-section{margin:12px 0}}${READER_CONTROLS_CSS}</style></head><body id="top"><header>${safe.cover.showAtStart ? coverMarkup(project, safe.cover, locale) : ''}<h1>${esc(project.title)}</h1>${project.author?.trim() ? `<p class="wh-reader-byline" data-reader-byline>${esc(project.author.trim().slice(0, 120))}</p>` : ''}${readerControlsMarkup(locale)}${hasSound ? '<p><button data-reader-sound-toggle aria-pressed="false"></button><span data-reader-sound-status role="status"></span></p>' : ''}</header><nav aria-label="${locale === 'es' ? 'Índice' : 'Contents'}">${pieces.map(piece => `<a href="#${chapterKey(piece.id)}">${esc(piece.title)}</a>`).join('')}</nav><main>${sections}${bookEndnotes}${referenceAppendix}</main><script nonce="${nonce}">(${installReaderControls.toString()})(document);document.querySelectorAll('[data-cover-angle]').forEach(input=>input.addEventListener('input',()=>{input.closest('.wh-reader-cover').querySelector('.wh-reader-book').style.transform='rotateX(8deg) rotateY('+Number(input.value)+'deg)'}));document.querySelectorAll('[data-reader-turn]').forEach(button=>button.addEventListener('click',()=>{const prose=button.closest('section').querySelector('.ProseMirror');prose.scrollBy({left:Number(button.dataset.readerTurn)*prose.clientWidth,behavior:'instant'})}));${soundScript}${playbackScript};(${installVoiceReading.toString()})(document);</script>${modelReaderExportScript(sections,nonce)}</body></html>`;
  return { html, filename: `${project.title.replace(/[<>:"/\\|?*]/g, '_') || 'book'}-reader.html` };
}

/**
 * The reader's own text settings in a shared edition: size, typeface and
 * light, kept in the reader's browser (never in the file), and "the book's
 * own" to put the author's styling back.
 */
export const READER_CONTROLS_CSS = '.reader-controls{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:0 auto 12px;font:13px system-ui,sans-serif}.reader-controls button{padding:4px 10px}.reader-controls [aria-pressed="true"]{background:currentColor}.reader-controls [aria-pressed="true"] span{filter:invert(1)}'
  + 'body[data-reader-size="s"] .reader-section{font-size:15px}body[data-reader-size="l"] .reader-section{font-size:21px}body[data-reader-size="xl"] .reader-section{font-size:24px}'
  + 'body[data-reader-face="sans"] .reader-section,body[data-reader-face="sans"] .reader-section *{font-family:system-ui,-apple-system,"Segoe UI",sans-serif!important}body[data-reader-face="mono"] .reader-section,body[data-reader-face="mono"] .reader-section *{font-family:ui-monospace,Menlo,Consolas,monospace!important}'
  + 'body[data-reader-light="dark"]{background:#17171b;color:#e6e0d2}body[data-reader-light="dark"] .reader-section{background:#202027!important;color:#e6e0d2!important}body[data-reader-light="dark"] .reader-section *{color:inherit!important;background-color:transparent!important}'
  + 'body[data-reader-light="sepia"]{background:#efe3c8;color:#3b2f1e}body[data-reader-light="sepia"] .reader-section{background:#f6ecd4!important;color:#3b2f1e!important}';

const CONTROL_COPY = {
  es: { group: 'Ajustes de lectura', size: 'Tamaño', s: 'A−', m: 'A', l: 'A+', xl: 'A++', face: 'Letra', serif: 'Serifa', sans: 'Sin serifa', mono: 'Mono', light: 'Luz', day: 'Día', sepia: 'Sepia', dark: 'Noche', own: 'Como el libro' },
  en: { group: 'Reading settings', size: 'Size', s: 'A−', m: 'A', l: 'A+', xl: 'A++', face: 'Type', serif: 'Serif', sans: 'Sans', mono: 'Mono', light: 'Light', day: 'Day', sepia: 'Sepia', dark: 'Night', own: "The book's own" },
} as const;

export function readerControlsMarkup(locale: 'es' | 'en'): string {
  const c = CONTROL_COPY[locale];
  const button = (kind: string, value: string, label: string, title?: string) => `<button type="button" data-reader-set="${kind}" data-value="${value}" aria-pressed="false"${title ? ` title="${title}" aria-label="${title}"` : ''}><span>${label}</span></button>`;
  return `<div class="reader-controls" role="group" aria-label="${c.group}">`
    + button('size', 's', c.s, `${c.size} S`) + button('size', 'l', c.l, `${c.size} L`) + button('size', 'xl', c.xl, `${c.size} XL`)
    + button('face', 'serif', c.serif) + button('face', 'sans', c.sans) + button('face', 'mono', c.mono)
    + button('light', 'day', c.day) + button('light', 'sepia', c.sepia) + button('light', 'dark', c.dark)
    + `<button type="button" data-reader-own><span>${c.own}</span></button></div>`;
}

/** Runs in the exported page: applies and remembers the reader's choices. Self-contained (serialised with toString). */
export function installReaderControls(doc: Document): void {
  const KEY = 'wh-reader-settings';
  const body = doc.body;
  let saved: Record<string, string> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const apply = () => {
    for (const kind of ['size', 'face', 'light']) {
      const value = saved[kind];
      if (value && !(kind === 'light' && value === 'day')) body.setAttribute('data-reader-' + kind, value); else body.removeAttribute('data-reader-' + kind);
    }
    doc.querySelectorAll('[data-reader-set]').forEach((el) => {
      const b = el as HTMLElement;
      b.setAttribute('aria-pressed', String(saved[b.dataset.readerSet || ''] === b.dataset.value));
    });
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* the page still works without storage */ }
  };
  doc.querySelectorAll('[data-reader-set]').forEach((el) => el.addEventListener('click', () => {
    const b = el as HTMLElement, kind = b.dataset.readerSet || '', value = b.dataset.value || '';
    saved[kind] = saved[kind] === value ? '' : value;
    apply();
  }));
  doc.querySelector('[data-reader-own]')?.addEventListener('click', () => { saved = {}; apply(); });
  apply();
}
