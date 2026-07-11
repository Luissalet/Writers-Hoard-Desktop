// ============================================
// Manuscript compile & export — Markdown / HTML / PDF
// ============================================
//
// Combines selected writings into a single manuscript. The HTML output is a
// self-contained printable document (serif, chapter page-breaks, title page)
// that doubles as the input for the desktop PDF pipeline
// (`window.electronAPI.exporter.scriptToPdf`, already used by video-planner).
//
// Downloads use the browser-native blob + <a download> pattern
// (tasks/lessons: the OS save dialog is the browser's job).

import type { Writing } from '@/types';
import { countWords } from '@/utils/text';
import { isDesktop } from '@/utils/platform';

export interface CompileOptions {
  projectTitle: string;
  includeTitlePage: boolean;
  includeSynopsis: boolean;
  /** Heading label for numbered chapters, e.g. "Capítulo" / "Chapter". */
  chapterLabel: string;
}

// ---------------------------------------------------------------------------
// HTML → Markdown (minimal, tuned to Tiptap StarterKit output)
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

export function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r/g, '');

  // Inline marks first (so block regexes see clean text)
  s = s.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gis, '**$2**');
  s = s.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gis, '*$2*');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)');
  s = s.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Headings
  s = s.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n\n# $1\n\n');
  s = s.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n\n## $1\n\n');
  s = s.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n\n### $1\n\n');
  s = s.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gis, '\n\n#### $1\n\n');

  // Blockquotes (Tiptap: <blockquote><p>…</p></blockquote>)
  s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_m, inner: string) => {
    const text = inner.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n');
    return (
      '\n\n' +
      text
        .split('\n')
        .filter((l: string) => l.trim())
        .map((l: string) => `> ${l.trim()}`)
        .join('\n') +
      '\n\n'
    );
  });

  // Lists — ordered get "1." (Markdown renderers auto-increment)
  s = s.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_m, inner: string) => {
    return '\n\n' + inner.replace(/<li[^>]*>(.*?)<\/li>/gis, (_m2, item: string) => `1. ${item.replace(/<\/?p[^>]*>/gi, '').trim()}\n`) + '\n';
  });
  s = s.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_m, inner: string) => {
    return '\n\n' + inner.replace(/<li[^>]*>(.*?)<\/li>/gis, (_m2, item: string) => `- ${item.replace(/<\/?p[^>]*>/gi, '').trim()}\n`) + '\n';
  });

  // Paragraphs & line breaks
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<p[^>]*>(.*?)<\/p>/gis, '\n\n$1\n\n');

  // Anything left
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function chapterHeading(w: Writing, opts: CompileOptions): string {
  return w.chapter !== undefined ? `${opts.chapterLabel} ${w.chapter} — ${w.title}` : w.title;
}

export function buildManuscriptMarkdown(writings: Writing[], opts: CompileOptions): string {
  const parts: string[] = [];
  if (opts.includeTitlePage) {
    const total = writings.reduce((sum, w) => sum + (w.wordCount || countWords(w.content)), 0);
    parts.push(`# ${opts.projectTitle}\n\n*${total.toLocaleString()} palabras · ${new Date().toLocaleDateString()}*\n\n---`);
  }
  for (const w of writings) {
    parts.push(`\n\n## ${chapterHeading(w, opts)}\n`);
    if (opts.includeSynopsis && w.synopsis) parts.push(`*${w.synopsis}*\n`);
    parts.push(htmlToMarkdown(w.content));
    parts.push('\n\n---');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function buildManuscriptHtml(writings: Writing[], opts: CompileOptions): string {
  const total = writings.reduce((sum, w) => sum + (w.wordCount || countWords(w.content)), 0);
  const chapters = writings
    .map(
      (w) => `
    <section class="chapter">
      <h1 class="chapter-title">${escapeHtml(chapterHeading(w, opts))}</h1>
      ${opts.includeSynopsis && w.synopsis ? `<p class="synopsis">${escapeHtml(w.synopsis)}</p>` : ''}
      <div class="content">${w.content}</div>
    </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.projectTitle)}</title>
<style>
  @page { margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.65;
    color: #1a1a1a;
    max-width: 42em;
    margin: 0 auto;
    padding: 1em;
  }
  .title-page {
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    min-height: 80vh; text-align: center; page-break-after: always;
  }
  .title-page h1 { font-size: 26pt; letter-spacing: 0.04em; margin-bottom: 0.4em; }
  .title-page .meta { color: #666; font-style: italic; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  .chapter-title { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; }
  .synopsis { font-style: italic; color: #555; text-align: center; margin-bottom: 2em; }
  .content p { margin: 0 0 0.15em; text-indent: 1.6em; }
  .content p:first-of-type { text-indent: 0; }
  .content h2 { font-size: 14pt; margin: 1.4em 0 0.6em; }
  .content blockquote { margin: 1em 2em; font-style: italic; color: #444; }
  .content img { max-width: 100%; }
  .content a { color: #1a1a1a; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
  ${
    opts.includeTitlePage
      ? `<div class="title-page">
    <h1>${escapeHtml(opts.projectTitle)}</h1>
    <p class="meta">${total.toLocaleString()} palabras · ${new Date().toLocaleDateString()}</p>
  </div>`
      : ''
  }
  ${chapters}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Download / export entry points
// ---------------------------------------------------------------------------

export function downloadTextFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\wÀ-ɏ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'manuscrito';
}

/** True when the native PDF pipeline is available (desktop shell). */
export function canExportPdf(): boolean {
  return isDesktop() && !!window.electronAPI?.exporter?.scriptToPdf;
}

/** Render the manuscript HTML to a real PDF via the Electron main process. */
export async function exportManuscriptPdf(
  writings: Writing[],
  opts: CompileOptions,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  if (!canExportPdf()) return { ok: false, error: 'PDF export requires the desktop app' };
  const html = buildManuscriptHtml(writings, opts);
  return window.electronAPI!.exporter.scriptToPdf(html, `${sanitizeFilename(opts.projectTitle)}.pdf`);
}
