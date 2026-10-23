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

import { prepMarkdownFromHtml } from '@/engines/prepBlocks/markdown';
import { bookPageCss, bookStyleCss, titleOrnamentHtml } from './bookStyle';
import type { Writing } from '@/types';
import { isDesktop } from '@/utils/platform';
import { projectWritingHtml } from './revisionProjection';
import {EDITORIAL_PROSE_CSS,prepareStaticEditorialHtml} from '@/components/editor/advanced/proseStyle';
import {
  footnoteAnchors,
  footnoteRefsOutOfCode,
  renderBookEndnotesHtml,
  renderEndnotesHtml,
  renderFootnoteRefs,
  formatFootnoteMarker,
  type EndnoteGroup,
  type ExtractedFootnote,
} from '@/components/editor/footnotes/footnoteModel';
import {
  composePublishingDocument,
  type PublishingDocument,
} from './publishingDocument';

export interface CompileOptions {
  projectTitle: string;
  includeTitlePage: boolean;
  includeSynopsis: boolean;
  /** Heading label for numbered chapters, e.g. "Capítulo" / "Chapter". */
  chapterLabel: string;
  /** Stands in for a writing whose title is blank, e.g. "Sin título". */
  untitledLabel?: string;
  /** Localized label rendered beside the title-page word count. */
  wordLabel?: string;
  /** Heading over a chapter's footnotes, e.g. "Notas" / "Notes". */
  notesLabel?: string;
  /** BCP 47 locale used for dates and numbers in the exported document. */
  locale?: string;
  /** Injectable timestamp keeps artifact tests deterministic. */
  generatedAt?: number;
}

// ---------------------------------------------------------------------------
// HTML → Markdown (minimal, tuned to Tiptap StarterKit output)
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  // `&amp;` last: decoded first, a typed "&lt;" (stored `&amp;lt;`) would be
  // decoded twice and come out as "<".
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
}

/**
 * A code block lifted out of the html while the rest is converted, restored
 * as a fence once the whitespace is normalized: the rules below read its
 * lines as prose — `<br>`-less newlines, runs of blank lines, trailing
 * spaces — and would reflow the code. Bracketed by SOH, like the lists' STX/ETX.
 */
// eslint-disable-next-line no-control-regex -- the control characters are the brackets
const LIFTED_CODE_RE = /(^> )?\u0001(\d+)\u0001/gm;

/** A list with no list inside it: `ul`/`ol` (1), its attributes (2), its items (3). */
const INNERMOST_LIST_RE = /<(ul|ol)\b([^>]*)>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
/**
 * A list already written as Markdown, waiting for its parent item or the top
 * level to place it. Bracketed by STX/ETX, which no chapter's text contains.
 */
// eslint-disable-next-line no-control-regex -- the control characters are the brackets
const CONVERTED_LIST_RE = /\u0002([\s\S]*?)\u0003/g;

/**
 * One list as Markdown lines. The items hold no list html any more — their
 * sub-lists were converted first and come in marked by `CONVERTED_LIST_RE` —
 * so each is indented under its item by the width of the item's marker, which
 * is how `markdownToTiptapHtml` reads nesting back. An item's paragraphs are
 * joined with a space: a list item is one line there, and glued they would
 * run the last word of one into the first word of the next.
 */
function listToMarkdown(tag: string, attributes: string, inner: string): string {
  const ordered = tag.toLowerCase() === 'ol';
  const checks = /\bdata-wh-checklist=/i.test(attributes);
  const start = ordered ? Number(/\bstart="(\d+)"/i.exec(attributes)?.[1] ?? 1) : 1;
  const lines: string[] = [];
  let index = 0;
  for (const [, itemAttributes, item] of inner.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    // A checklist item keeps its box: "- [ ]" or "- [x]".
    const marker = ordered ? `${start + index}.` : checks ? `- [${/\bdata-checked="true"/i.test(itemAttributes) ? 'x' : ' '}]` : '-';
    index += 1;
    const nested: string[] = [];
    const text = item
      .replace(CONVERTED_LIST_RE, (_m, markdown: string) => {
        nested.push(markdown);
        return ' ';
      })
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>\s*<p\b[^>]*>/gi, ' ')
      .replace(/<\/?p\b[^>]*>/gi, '')
      .trim();
    lines.push(`${marker} ${text}`);
    const indent = ' '.repeat(marker.length + 1);
    for (const markdown of nested) {
      for (const line of markdown.split('\n')) lines.push(`${indent}${line}`);
    }
  }
  return `\u0002${lines.join('\n')}\u0003`;
}

/** A note's body as the text after `[^n]: ` — later lines indented as Markdown continues a footnote. */
function markdownNoteText(text: string): string {
  return text.split(/\r?\n/).join('\n    ');
}

/** The `[^n]: …` definitions of some notes, one per line. */
function markdownFootnoteDefinitions(notes: readonly ExtractedFootnote[]): string {
  return notes.map((note) => `[^${note.index}]: ${markdownNoteText(note.text)}`).join('\n');
}

/**
 * One chapter's prose as Markdown, with its footnote references as `[^n]`
 * and the notes handed back separately so the caller decides where the
 * definitions go: after the chapter, or — numbered on from `start` — in one
 * list at the end of the book.
 */
export function htmlToMarkdownParts(
  html: string,
  start = 1,
): { prose: string; notes: ExtractedFootnote[] } {
  html = projectWritingHtml(html);
  // Footnotes first, while the references are still elements: the generic
  // tag strip at the end would leave nothing of an empty <sup>. A reference
  // inside a code span is moved out of it first: `` `x[^1]` `` is code to a
  // Markdown reader, and the note would be lost.
  const footnotes = renderFootnoteRefs(footnoteRefsOutOfCode(html), (note) => `[^${note.index}]`, start);
  let s = footnotes.html.replace(/\r/g, '');

  // Code blocks before anything reads them as inline code or prose: a fence
  // keeps their lines, and `class="language-x"` becomes its info string.
  const codeBlocks: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const language = /<code\b[^>]*\bclass="[^"]*\blanguage-([\w+#-]+)/i.exec(inner)?.[1] ?? '';
    const code = decodeEntities(inner.replace(/<[^>]+>/g, ''));
    codeBlocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
    return `\n\n\u0001${codeBlocks.length - 1}\u0001\n\n`;
  });

  // Prep blocks (check, encounter, player handout): an alert whose last line carries the data, kept whole as a stashed block.
  s = s.replace(/<(div|figure)\b[^>]*\bdata-wh-prep="(?:check|encounter|handout)"[^>]*>[\s\S]*?<\/\1>/gi, block => {
    const markdown = prepMarkdownFromHtml(block);
    if (!markdown) return '\n\n';
    codeBlocks.push(markdown);
    return `\n\n\u0001${codeBlocks.length - 1}\u0001\n\n`;
  });

  // A story email's header and a message's sender are attributes in the editor; written out here.
  const attr = (tag: string, name: string) => (new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '');
  s = s.replace(/<div\b[^>]*\bdata-wh-email="true"[^>]*>/gi, tag => {
    if (/data-wh-email-rendered/.test(tag)) return '\n\n';
    const from = attr(tag, 'data-wh-from'), to = attr(tag, 'data-wh-to'), subject = attr(tag, 'data-wh-subject'), date = attr(tag, 'data-wh-date');
    const lines = [from || to ? `✉ ${from}${to ? ` → ${to}` : ''}` : '', subject || date ? `**${subject}**${date ? ` · ${date}` : ''}` : ''].filter(Boolean);
    return lines.length ? `\n\n${lines.join('  \n')}\n\n` : '\n\n';
  });
  s = s.replace(/<div\b[^>]*\bdata-wh-sender="([^"]*)"[^>]*>/gi, (tag, sender: string) => /data-wh-sender-rendered/.test(tag) ? '\n\n' : `\n\n**${sender}:** `);

  // Inline marks first (so block regexes see clean text)
  s = s.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gis, '**$2**');
  s = s.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gis, '*$2*');
  s = s.replace(/<(s|del|strike)\b[^>]*>(.*?)<\/\1>/gis, '~~$2~~');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)');
  s = s.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Headings
  s = s.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n\n# $1\n\n');
  s = s.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n\n## $1\n\n');
  s = s.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n\n### $1\n\n');
  s = s.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gis, '\n\n#### $1\n\n');

  // Callouts read as "> [!NOTE]" alerts; a toggle as its title in bold over its content.
  s = s.replace(/<aside\b[^>]*\bdata-wh-callout="(note|info|question|tip|warning|readaloud|sidebar)"[^>]*>([\s\S]*?)<\/aside>/gi, (_m, kind: string, inner: string) => {
    const text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n').replace(/<[^>]+>/g, '');
    return `\n\n> [!${kind.toUpperCase()}]\n${text.split('\n').filter((line: string) => line.trim()).map((line: string) => `> ${line.trim()}`).join('\n')}\n\n`;
  });
  s = s.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, '\n\n**$1**\n\n').replace(/<\/?details\b[^>]*>/gi, '\n\n');

  // Blockquotes (Tiptap: <blockquote><p>…</p></blockquote>). A line break
  // is a line of its own here, so every line after it is quoted too.
  s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_m, inner: string) => {
    const text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n');
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

  // Lists, innermost first, so each item's sub-list is already Markdown when
  // its parent item is written and can be indented under it. A single pass
  // over the html ended the outer list at the inner one's `</ul>`: the parent
  // item ran into its first child ("ParentChild one") and every item after
  // the sub-list lost its bullet.
  let unconverted: string;
  do {
    unconverted = s;
    s = s.replace(INNERMOST_LIST_RE, (_m, tag: string, attributes: string, inner: string) =>
      listToMarkdown(tag, attributes, inner),
    );
  } while (s !== unconverted);
  s = s.replace(CONVERTED_LIST_RE, '\n\n$1\n\n');

  // Scene / POV breaks — the editor's `---` input rule persists an <hr>.
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');

  // Paragraphs & line breaks
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<p[^>]*>(.*?)<\/p>/gis, '\n\n$1\n\n');

  // Anything left
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // A block inside a quote keeps the quote on every line.
  s = s.replace(LIFTED_CODE_RE, (_m, quote: string | undefined, index: string) =>
    codeBlocks[Number(index)].split('\n').map((line) => (quote ?? '') + line).join('\n'));
  return { prose: s, notes: footnotes.notes };
}

/**
 * One chapter as Markdown. The numbers restart with the call, and the notes
 * are listed after the prose the way Markdown footnotes are.
 */
export function htmlToMarkdown(html: string): string {
  const { prose, notes } = htmlToMarkdownParts(html);
  return notes.length > 0 ? `${prose}\n\n${markdownFootnoteDefinitions(notes)}` : prose;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildManuscriptMarkdown(writings: Writing[], opts: CompileOptions): string {
  return renderPublishingMarkdown(composePublishingDocument(writings, opts));
}

/**
 * The anchor a Markdown renderer gives a heading, GitHub's way: lower case,
 * punctuation dropped, spaces to hyphens, a numeric suffix on a repeat. Most
 * renderers (GitHub, GitLab, pandoc near enough) agree on it, and it needs
 * no inline HTML in the file, which some of them strip.
 */
function markdownHeadingSlug(title: string, taken: Map<string, number>): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/ /g, '-');
  const seen = taken.get(base) ?? 0;
  taken.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

export function renderPublishingMarkdown(document: PublishingDocument): string {
  const parts: string[] = [];
  if (document.includeTitlePage) {
    const date = new Date(document.generatedAt).toLocaleDateString(document.locale);
    parts.push(`# ${escapeHtml(document.title)}\n\n${document.author ? `**${escapeHtml(document.author)}**\n\n` : ''}*${document.wordCount.toLocaleString(document.locale)} ${escapeHtml(document.wordLabel)} · ${escapeHtml(date)}*\n\n---`);
  }
  if (document.copyright) parts.push(`\n\n*${escapeHtml(document.copyright)}*\n\n---`);
  if (document.includeToc && document.sections.length > 0) {
    const slugs = new Map<string, number>();
    const entries = document.sections.map(
      (section) => `- [${escapeHtml(section.title)}](#${markdownHeadingSlug(section.title, slugs)})`,
    );
    parts.push(`\n\n## ${escapeHtml(document.tocTitle)}\n\n${entries.join('\n')}\n\n---`);
  }
  // The labels count on through the whole file whatever the placement:
  // Markdown footnote labels are per file, so two chapters both defining
  // `[^1]` would be one definition lost — and a chapter's `[^1]` would point
  // at the first chapter's note. Per chapter the definitions still follow
  // their chapter; at the end of the book they gather under one heading.
  const bookNotes = document.footnotePlacement === 'book';
  const endnotes: EndnoteGroup[] = [];
  let nextNumber = 1;
  for (const section of document.sections) {
    parts.push(`\n\n## ${escapeHtml(section.title)}\n`);
    if (section.synopsis) parts.push(`*${escapeHtml(section.synopsis)}*\n`);
    const { prose, notes } = htmlToMarkdownParts(section.html, nextNumber);
    nextNumber += notes.length;
    if (bookNotes) {
      endnotes.push({ title: section.title, notes });
      parts.push(prose);
    } else {
      parts.push(notes.length > 0 ? `${prose}\n\n${markdownFootnoteDefinitions(notes)}` : prose);
    }
    parts.push('\n\n---');
  }
  if (bookNotes && endnotes.some((group) => group.notes.length > 0)) {
    parts.push(`\n\n# ${escapeHtml(document.notesLabel)}\n`);
    for (const group of endnotes) {
      if (group.notes.length === 0) continue;
      parts.push(`\n## ${escapeHtml(group.title)}\n\n${markdownFootnoteDefinitions(group.notes)}\n`);
    }
  }
  if (document.bibliography.length > 0 && document.bibliographyTitle) {
    parts.push(`\n\n# ${escapeHtml(document.bibliographyTitle)}\n`);
    for (const citation of document.bibliography) parts.push(`\n${escapeHtml(citation)}\n`);
  }
  if (document.blurb) parts.push(`\n\n# ${escapeHtml(document.blurb.title)}\n\n${document.blurb.text.split(/\n+/).map(escapeHtml).join('\n\n')}\n`);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function buildManuscriptHtml(writings: Writing[], opts: CompileOptions): string {
  return renderPublishingHtml(composePublishingDocument(writings, opts));
}

/** The fragment id of the n-th chapter's heading (1-based), for the contents list. */
export function chapterAnchorId(n: number): string {
  return `ch-${n}`;
}

export function renderPublishingHtml(document: PublishingDocument): string {
  const date = new Date(document.generatedAt).toLocaleDateString(document.locale);
  // Numbers written into the file rather than left to a CSS counter: a mail
  // client or a PDF viewer's text layer has no counters. Per chapter they
  // restart and the notes follow the chapter they belong to; at the end of
  // the book they count on, and every chapter's notes wait for the section
  // after the last one. The ids and links are the same either way, and each
  // carries the chapter's number: two chapters can hold a note with one id.
  const bookNotes = document.footnotePlacement === 'book';
  const bookGroups: EndnoteGroup[] = [];
  let nextNumber = 1;
  const chapters = document.sections
    .map((section, at) => {
      const scope = at + 1;
      const footnotes = renderFootnoteRefs(section.html, (note) => {
        const anchors = footnoteAnchors(note.id, scope);
        const marker = escapeHtml(formatFootnoteMarker(note.index, document.footnoteStyle));
        return `<sup class="wh-footnote-ref" id="${escapeHtml(anchors.ref)}"><a href="#${escapeHtml(anchors.note)}">${marker}</a></sup>`;
      }, bookNotes ? nextNumber : 1);
      let endnotes = '';
      if (bookNotes) {
        nextNumber += footnotes.notes.length;
        bookGroups.push({ title: section.title, notes: footnotes.notes, scope });
      } else {
        endnotes = renderEndnotesHtml(footnotes.notes, {
          heading: document.notesLabel,
          style: document.footnoteStyle,
          scope,
        });
      }
      return `
    <section class="chapter">
      ${section.headerImage?.layout === 'banner' && section.headerImage.label ? `<p class="wh-chapter-label">${escapeHtml(section.headerImage.label)}</p>` : ''}
      ${section.headerImage && section.headerImage.layout !== 'beside' ? `<img class="wh-chapter-image wh-chapter-image--${section.headerImage.layout}" src="${escapeHtml(section.headerImage.src)}" alt="">` : ''}
      <h1 class="chapter-title" id="${chapterAnchorId(scope)}">${escapeHtml(section.title)}</h1>
      ${titleOrnamentHtml(document.bookStyle)}
      ${section.headerImage?.layout === 'beside' ? `<img class="wh-chapter-image wh-chapter-image--beside" src="${escapeHtml(section.headerImage.src)}" alt="">` : ''}
      ${section.synopsis ? `<p class="synopsis">${escapeHtml(section.synopsis)}</p>` : ''}
      <div class="content">${prepareStaticEditorialHtml(footnotes.html)}</div>
      ${endnotes}
    </section>`;
    })
    .join('\n');
  const toc = document.includeToc && document.sections.length > 0
    ? `<nav class="wh-toc"><h2>${escapeHtml(document.tocTitle)}</h2><ol>${document.sections
      .map((section, at) => `<li><a href="#${chapterAnchorId(at + 1)}">${escapeHtml(section.title)}</a></li>`)
      .join('')}</ol></nav>`
    : '';
  const bookEndnotes = bookNotes
    ? renderBookEndnotesHtml(bookGroups, { heading: document.notesLabel, style: document.footnoteStyle })
    : '';
  const bibliography = document.bibliography.length > 0 && document.bibliographyTitle
    ? `<section class="chapter bibliography"><h1 class="chapter-title">${escapeHtml(document.bibliographyTitle)}</h1>${document.bibliography.map(citation => `<p>${escapeHtml(citation)}</p>`).join('')}</section>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title)}</title>
<style>
${EDITORIAL_PROSE_CSS}
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
  .wh-toc { page-break-after: always; }
  .wh-toc h2 { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; }
  .wh-toc ol { padding-left: 1.6em; }
  .wh-toc li { margin: 0 0 0.4em; }
  .wh-toc a { color: #1a1a1a; text-decoration: none; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  .chapter-title { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; }
  .synopsis { font-style: italic; color: #555; text-align: center; margin-bottom: 2em; }
  .content p { margin: 0 0 0.15em; text-indent: 1.6em; }
  .content p:first-of-type { text-indent: 0; }
  .content h2 { font-size: 14pt; margin: 1.4em 0 0.6em; }
  .content blockquote { margin: 1em 2em; font-style: italic; color: #444; }
  .content img { max-width: 100%; }
  .content .wh-column-break { border: 0; margin: 0; height: 0; }
  .content .wh-column-break::after { content: none; display: none; }
  .content a { color: #1a1a1a; }
  .wh-footnote-ref { font-size: 0.7em; line-height: 1; vertical-align: super; }
  .wh-footnote-ref a { color: #1a1a1a; text-decoration: none; }
  .wh-endnotes ol.wh-endnotes-marked { list-style: none; padding-left: 0; }
  .wh-endnote-marker { display: inline-block; min-width: 1.4em; font-weight: 600; }
  .wh-endnotes { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid #bbb; font-size: 10pt; color: #333; }
  .wh-endnotes h2 { font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin: 0 0 0.6em; }
  .wh-endnotes ol { padding-left: 1.6em; margin: 0; }
  .wh-endnotes--book { page-break-before: always; border-top: 0; margin-top: 0; padding-top: 0; font-size: 11pt; }
  .wh-endnotes--book h1 { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; color: #1a1a1a; }
  .wh-endnotes--book h2 { font-size: 11pt; letter-spacing: 0; text-transform: none; color: #1a1a1a; margin: 1.4em 0 0.5em; }
  .wh-endnotes--book ol { margin-bottom: 0.6em; }
  .wh-endnotes li { margin: 0 0 0.3em; }
  .wh-endnote-back { color: #666; text-decoration: none; margin-left: 0.3em; }
  .wh-chapter-image { display: block; max-width: 100%; max-height: 22em; object-fit: contain; margin: 0 auto 1.2em; }
  .wh-chapter-image--banner { width: 100%; max-height: 14em; object-fit: cover; }
  .wh-chapter-image--beside { float: left; max-width: 38%; margin: 0.3em 1.2em 0.8em 0; }
  .wh-chapter-label { text-align: center; font-size: 9pt; letter-spacing: 0.24em; text-transform: uppercase; color: #777; margin: 0 0 0.8em; }
  .copyright-page { display: flex; align-items: flex-end; justify-content: center; min-height: 80vh; page-break-after: always; text-align: center; font-size: 10pt; color: #444; }
  @media print { body { padding: 0; max-width: none; } }
  ${document.bookStyle ? `${bookStyleCss(document.bookStyle, '.content', '.chapter-title')}\n${bookPageCss(document.bookStyle)}` : ''}
</style>
</head>
<body>
  ${
    document.includeTitlePage
      ? `<div class="title-page">
    <h1>${escapeHtml(document.title)}</h1>
    ${document.author ? `<p class="byline">${escapeHtml(document.author)}</p>` : ''}
    <p class="meta">${document.wordCount.toLocaleString(document.locale)} ${escapeHtml(document.wordLabel)} · ${escapeHtml(date)}</p>
  </div>`
      : ''
  }
  ${document.copyright ? `<div class="copyright-page"><p>${escapeHtml(document.copyright)}</p></div>` : ''}
  ${toc}
  ${chapters}
  ${bookEndnotes}
  ${bibliography}
  ${document.blurb ? `<section class="chapter blurb"><h1 class="chapter-title">${escapeHtml(document.blurb.title)}</h1>${document.blurb.text.split(/\n+/).map(line => `<p>${escapeHtml(line)}</p>`).join('')}</section>` : ''}
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
  downloadBlobFile(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadBlobFile(blob: Blob, filename: string): void {
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
  return exportHtmlPdf(html, `${sanitizeFilename(opts.projectTitle)}.pdf`);
}

/** Send an already-composed HTML artifact to the native PDF pipeline. */
export async function exportHtmlPdf(
  html: string,
  filename: string,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  if (!canExportPdf()) return { ok: false, error: 'PDF export requires the desktop app' };
  return window.electronAPI!.exporter.scriptToPdf(html, filename);
}
