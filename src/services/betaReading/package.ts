// ============================================================================
// Beta reading — building the package file (pure)
// ============================================================================
//
// One HTML file, nothing else: the chapters, the reader's tools and the
// manifest travel together, with inline CSS and JS, no external asset and a
// CSP that forbids any. It opens by double click in any browser.

import { READER_SCRIPT } from './readerScript';
import {
  blocksToSnapshot, chapterHash, normalizeText, prepareBlockHtml, splitBlocks,
} from './text';
import {
  FORMAT_VERSION, PACKAGE_FORMAT, REACTIONS,
  type PackageManifest, type PackageManifestChapter,
} from './types';

export interface PackageChapterInput {
  writingId: string;
  title: string;
  /** Already sanitised HTML (the service runs the app's sanitiser before it gets here). */
  html: string;
}

export interface BuildPackageInput {
  packageId: string;
  version: number;
  projectId: string;
  projectTitle: string;
  createdAt: number;
  locale: 'es' | 'en';
  chapters: readonly PackageChapterInput[];
}

export interface BuiltPackage {
  manifest: PackageManifest;
  /** The same chapters with the HTML of their blocks, for the stored row. */
  chapters: Array<PackageManifestChapter & { html: string }>;
  html: string;
}

const LABELS = {
  es: {
    title: 'Lectura beta', by: 'Versión', intro: 'Selecciona un fragmento y pulsa «Comentar la selección». Al terminar, escribe tu nombre y descarga tus comentarios para devolverlos a quien te envió este archivo. Nada sale de tu navegador.',
    readerName: 'Tu nombre', addComment: 'Comentar la selección', whole: 'Comentar el capítulo', export: 'Descargar mis comentarios',
    comments: 'Mis comentarios', noComments: 'Aún no hay comentarios.', remove: 'Quitar', save: 'Guardar comentario', cancel: 'Cancelar',
    yourComment: 'Tu comentario', selectFirst: 'Selecciona primero un fragmento del texto.', writeSomething: 'Escribe tu comentario.',
    saved: 'Comentario guardado.', removed: 'Comentario quitado.', exported: 'Archivo descargado: envíalo a quien te pasó este texto.',
    needName: 'Escribe tu nombre antes de descargar.', wholeChapter: 'Capítulo completo', reactions: 'Cómo te ha parecido',
    chapters: 'Capítulos',
    love: 'Me encanta', laugh: 'Me hace reír', tense: 'Tensión', sad: 'Me entristece', confused: 'Me pierdo', bored: 'Se me hace lento',
  },
  en: {
    title: 'Beta reading', by: 'Version', intro: 'Select a passage and press "Comment on selection". When you are done, type your name and download your comments to send back to whoever gave you this file. Nothing leaves your browser.',
    readerName: 'Your name', addComment: 'Comment on selection', whole: 'Comment on the chapter', export: 'Download my comments',
    comments: 'My comments', noComments: 'No comments yet.', remove: 'Remove', save: 'Save comment', cancel: 'Cancel',
    yourComment: 'Your comment', selectFirst: 'Select a passage of the text first.', writeSomething: 'Write your comment.',
    saved: 'Comment saved.', removed: 'Comment removed.', exported: 'File downloaded: send it to whoever gave you this text.',
    needName: 'Type your name before downloading.', wholeChapter: 'Whole chapter', reactions: 'How it read',
    chapters: 'Chapters',
    love: 'Loved it', laugh: 'Made me laugh', tense: 'Tense', sad: 'Made me sad', confused: 'Lost me', bored: 'Felt slow',
  },
} as const;

const EMOJI: Record<(typeof REACTIONS)[number], string> = {
  love: '\u2665', laugh: '\u263A', tense: '\u26A1', sad: '\u2602', confused: '?', bored: '\u231B',
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON that is safe inside a <script> element. */
const scriptJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Defence in depth on top of the app's sanitiser: nothing executable and
 * nothing that would fetch from the network may reach a file that is sent to
 * a stranger. A picture survives only when it is carried inline.
 */
export function scrubChapterHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form|svg|math)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>/gi, '')
    .replace(/\s(on\w+|formaction|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|xlink:href)\s*=\s*("\s*(javascript|vbscript|data:text)[^"]*"|'\s*(javascript|vbscript|data:text)[^']*')/gi, '')
    .replace(/<img\b[^>]*>/gi, tag => (/\ssrc\s*=\s*["']data:image\/(png|jpe?g|gif|webp);/i.test(tag) ? tag : ''))
    .replace(/<a\b([^>]*?)\shref\s*=\s*("[^"]*"|'[^']*')([^>]*)>/gi, '<a$1$3>');
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fbf8f1;--fg:#25211b;--muted:#6f675a;--line:#d9d0bf;--accent:#8a5a14;--mark:#ffe08a;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#171512;--fg:#ece5d8;--muted:#a49b8a;--line:#3a352c;--accent:#e8c577;--mark:#6b5314;--card:#201d19}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.7 Georgia,'Times New Roman',serif}
header.top{padding:20px 24px;border-bottom:1px solid var(--line)}
header.top h1{margin:0;font-size:1.3rem}
header.top p{margin:.4rem 0 0;color:var(--muted);font:15px/1.5 system-ui,sans-serif;max-width:60ch}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;max-width:1180px;margin:0 auto;padding:16px 24px 120px}
main{min-width:0}
article{margin:0 0 56px}
article h2{font-size:1.5rem;margin:1.2em 0 .4em}
.b{margin:0 0 .2em}
.b p,.b h1,.b h2,.b h3,.b h4,.b ul,.b ol,.b blockquote{margin:.6em 0}
.b blockquote{border-left:3px solid var(--line);padding-left:1em;color:var(--muted)}
.b img{max-width:100%;height:auto}
mark{background:var(--mark);color:inherit;border-radius:2px;padding:0 1px}
aside{font:15px/1.5 system-ui,sans-serif;position:sticky;top:12px;align-self:start;max-height:calc(100vh - 24px);overflow:auto}
aside section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
aside h3{margin:0 0 8px;font-size:1rem}
label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:4px}
input[type=text],textarea{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button{font:14px system-ui,sans-serif;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg)}
button:disabled{opacity:.5;cursor:default}
button[aria-pressed=true]{border-color:var(--accent);background:var(--mark)}
.reactions{display:flex;flex-wrap:wrap;gap:6px;margin:.5rem 0;font-family:system-ui,sans-serif}
.tools{font-family:system-ui,sans-serif;margin:.3rem 0 1rem}
.comment{border-top:1px solid var(--line);padding:8px 0}
.comment blockquote{margin:4px 0;color:var(--muted);font-style:italic}
.comment .where{font-size:.8rem;color:var(--muted)}
.comment p{margin:4px 0}
.muted{color:var(--muted)}
button.link{border:0;background:none;padding:0;color:var(--accent);text-decoration:underline}
#wh-composer{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:2px solid var(--accent);padding:12px 16px;font-family:system-ui,sans-serif;z-index:5}
#wh-composer[hidden]{display:none}
#wh-composer-quote{font-style:italic;color:var(--muted);margin:0 0 6px;max-height:4.5em;overflow:auto}
#wh-status{min-height:1.4em;color:var(--accent);font:14px system-ui,sans-serif}
.toc a{display:block;color:var(--fg);padding:2px 0}
@media(max-width:860px){.layout{grid-template-columns:1fr;padding:12px}aside{position:static;max-height:none}}
`;

/** The page the reader opens, the manifest it carries and the rows the app stores. */
export function buildBetaPackage(input: BuildPackageInput): BuiltPackage {
  const labels = LABELS[input.locale];
  const built = input.chapters.map((chapter, index) => {
    const blocks = splitBlocks(scrubChapterHtml(chapter.html));
    const text = blocksToSnapshot(blocks);
    return {
      writingId: chapter.writingId,
      title: normalizeText(chapter.title) || `${index + 1}`,
      blocks,
      text,
      wordCount: normalizeText(text.replace(/\n/g, ' ')) ? normalizeText(text.replace(/\n/g, ' ')).split(' ').length : 0,
    };
  });

  const chapters = built.map((chapter, index): PackageManifestChapter & { html: string } => ({
    chapterId: chapter.writingId,
    title: chapter.title,
    order: index + 1,
    contentHash: chapterHash(chapter.text),
    wordCount: chapter.wordCount,
    text: chapter.text,
    html: chapter.blocks.map(block => block.html).join('\n'),
  }));

  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    formatVersion: FORMAT_VERSION,
    packageId: input.packageId,
    version: input.version,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    createdAt: new Date(input.createdAt).toISOString(),
    locale: input.locale,
    chapters: chapters.map(chapter => ({
      chapterId: chapter.chapterId, title: chapter.title, order: chapter.order,
      contentHash: chapter.contentHash, wordCount: chapter.wordCount, text: chapter.text,
    })),
  };

  const reactionList = REACTIONS.map(key => ({ key, label: labels[key], emoji: EMOJI[key] }));
  const toc = built.map(chapter => `<a href="#ch-${escapeHtml(chapter.writingId)}">${escapeHtml(chapter.title)}</a>`).join('');
  const articles = built.map(chapter => `
<article data-chapter="${escapeHtml(chapter.writingId)}" id="ch-${escapeHtml(chapter.writingId)}">
  <h2>${escapeHtml(chapter.title)}</h2>
  <div class="tools"><button type="button" class="whole">${escapeHtml(labels.whole)}</button></div>
${chapter.blocks.map((block, i) => `  <div class="b" data-p="${i}">${prepareBlockHtml(block.html)}</div>`).join('\n')}
  <div class="reactions" role="group" aria-label="${escapeHtml(labels.reactions)}"></div>
</article>`).join('\n');

  const script = READER_SCRIPT
    .replace('__LABELS__', () => scriptJson(labels))
    .replace('__REACTIONS__', () => scriptJson(reactionList));

  const html = `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Writers Hoard beta reading package v${FORMAT_VERSION}">
<title>${escapeHtml(input.projectTitle)} — ${escapeHtml(labels.title)} v${input.version}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <h1>${escapeHtml(input.projectTitle)} <span class="muted">· ${escapeHtml(labels.title)} · ${escapeHtml(labels.by)} ${input.version}</span></h1>
  <p>${escapeHtml(labels.intro)}</p>
</header>
<div class="layout">
<main>${articles}
</main>
<aside>
  <section>
    <label for="wh-reader-name">${escapeHtml(labels.readerName)}</label>
    <input type="text" id="wh-reader-name" maxlength="80" autocomplete="name">
  </section>
  <section>
    <button type="button" id="wh-add-comment" class="primary">${escapeHtml(labels.addComment)}</button>
    <div id="wh-status" role="status" aria-live="polite"></div>
  </section>
  <section class="toc"><h3>${escapeHtml(labels.chapters)}</h3>${toc}</section>
  <section>
    <h3>${escapeHtml(labels.comments)} (<span id="wh-count">0</span>)</h3>
    <div id="wh-list"></div>
    <p><button type="button" id="wh-export" class="primary">${escapeHtml(labels.export)}</button></p>
  </section>
</aside>
</div>
<div id="wh-composer" hidden role="dialog" aria-label="${escapeHtml(labels.yourComment)}">
  <p id="wh-composer-quote"></p>
  <label for="wh-comment-text">${escapeHtml(labels.yourComment)}</label>
  <textarea id="wh-comment-text" rows="3" maxlength="5000"></textarea>
  <p><button type="button" id="wh-comment-save" class="primary">${escapeHtml(labels.save)}</button> <button type="button" id="wh-comment-cancel">${escapeHtml(labels.cancel)}</button></p>
</div>
<script type="application/json" id="wh-manifest">${scriptJson(manifest)}</script>
<script>${script}</script>
</body>
</html>
`;
  return { manifest, chapters, html };
}
