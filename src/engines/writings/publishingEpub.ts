import {
  FOOTNOTE_ID_ATTR,
  FOOTNOTE_REF_SELECTOR,
  FOOTNOTE_TEXT_ATTR,
  formatFootnoteMarker,
  type ExtractedFootnote,
} from '@/components/editor/footnotes/footnoteModel';
import type { FootnoteMarkerStyle } from '@/types';
import { xmlSafeText, type PublishingDocument } from './publishingDocument';

const XHTML_TAGS = new Set([
  'a', 'aside', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);

/**
 * Written onto each footnote reference before the chapter is serialised, so
 * the reference can print its number without the walk carrying a counter.
 * Per chapter, each chapter is its own XHTML file with its own notes, and a
 * reader shows "3" beside the third note of the chapter, as the editor does;
 * at the end of the book the numbers count on and every reference points
 * into one shared notes file instead.
 */
const FOOTNOTE_NUMBER_ATTR = 'data-footnote-number';
/** The file the reference's `href` points into; empty for the chapter's own. */
const FOOTNOTE_FILE_ATTR = 'data-footnote-file';
/** The one file that holds every note when they go at the end of the book. */
const NOTES_HREF = 'notes.xhtml';

// The characters XML cannot carry at all — C0 controls, non-characters, lone
// surrogates — are dropped by `xmlSafeText`, which lives beside the IR because
// the DOCX writer needs exactly the same guard and used to lack it. Any one of
// them makes the whole .epub unparseable. This function adds the part that is
// only ePub's: turning the five markup characters into entities.
function escapeXml(value: string): string {
  return xmlSafeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeXhtmlNode(node: Node): string {
  if (node.nodeType === 3) return escapeXml(node.textContent ?? '');
  if (!(node instanceof Element)) return '';
  const sourceTag = node.tagName.toLowerCase();
  if (sourceTag === 'img') return '';
  if (sourceTag === 'sup' && node.hasAttribute(FOOTNOTE_NUMBER_ATTR)) {
    // EPUB 3's own footnote vocabulary: a reader that knows `noteref` shows
    // the note in a pop-up and keeps the `aside` out of the flow.
    const id = escapeXml(node.getAttribute(FOOTNOTE_ID_ATTR) ?? '');
    const number = escapeXml(node.getAttribute(FOOTNOTE_NUMBER_ATTR) ?? '');
    const file = escapeXml(node.getAttribute(FOOTNOTE_FILE_ATTR) ?? '');
    return `<a epub:type="noteref" class="wh-noteref" href="${file}#fn-${id}" id="fnref-${id}"><sup>${number}</sup></a>`;
  }
  if (!XHTML_TAGS.has(sourceTag)) {
    return [...node.childNodes].map(serializeXhtmlNode).join('');
  }
  const tag = sourceTag === 'b' ? 'strong' : sourceTag === 'i' ? 'em' : sourceTag;
  const attributes: string[] = [];
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href) attributes.push(` href="${escapeXml(href)}"`);
  }
  const title = node.getAttribute('title');
  if (title) attributes.push(` title="${escapeXml(title)}"`);
  if (tag === 'br' || tag === 'hr') return `<${tag}${attributes.join('')} />`;
  return `<${tag}${attributes.join('')}>${[...node.childNodes].map(serializeXhtmlNode).join('')}</${tag}>`;
}

function numberFootnotes(
  root: ParentNode,
  style: FootnoteMarkerStyle,
  start: number,
  file: string,
): ExtractedFootnote[] {
  const notes: ExtractedFootnote[] = [];
  for (const element of root.querySelectorAll(FOOTNOTE_REF_SELECTOR)) {
    const index = start + notes.length;
    element.setAttribute(FOOTNOTE_NUMBER_ATTR, formatFootnoteMarker(index, style));
    if (file) element.setAttribute(FOOTNOTE_FILE_ATTR, file);
    notes.push({
      id: element.getAttribute(FOOTNOTE_ID_ATTR) ?? '',
      text: element.getAttribute(FOOTNOTE_TEXT_ATTR) ?? '',
      index,
    });
  }
  return notes;
}

/**
 * One note as EPUB 3 marks it. `backFile` is the chapter file the reference
 * lives in — empty when the aside sits in that same file, after the prose.
 * An aside in the shared notes file is an `endnote`, not a `footnote`: the
 * readers that pop notes up (Apple Books among them) hide a `footnote` aside
 * from the flow altogether, which in a file made of nothing else would leave
 * the reader a blank page titled "Notes". Both types pop up from a `noteref`.
 */
function footnoteAside(note: ExtractedFootnote, style: FootnoteMarkerStyle, backFile = ''): string {
  const id = escapeXml(note.id);
  const text = note.text.split(/\r?\n/).map(escapeXml).join('<br />');
  const marker = escapeXml(formatFootnoteMarker(note.index, style));
  const separator = style === 'numbers' ? '.' : '';
  const type = backFile ? 'endnote' : 'footnote';
  return `<aside epub:type="${type}" class="wh-footnote" id="fn-${id}"><p>${marker}${separator} ${text} <a href="${escapeXml(backFile)}#fnref-${id}">↩</a></p></aside>`;
}

/**
 * The chapter's prose as XHTML with its notes numbered from `start`. With no
 * `notesFile` the notes follow the prose as `aside`s in the same file; with
 * one, they are handed back for that file and the references point into it
 * (a cross-file `noteref` is valid EPUB 3, and the readers that pop notes up
 * follow it just the same).
 */
function toXhtmlFragment(
  html: string,
  style: FootnoteMarkerStyle,
  start = 1,
  notesFile = '',
): { xhtml: string; notes: ExtractedFootnote[] } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const notes = numberFootnotes(parsed.body, style, start, notesFile);
  const body = [...parsed.body.childNodes].map(serializeXhtmlNode).join('');
  if (notesFile) return { xhtml: body, notes };
  return { xhtml: body + notes.map((note) => footnoteAside(note, style)).join(''), notes };
}

function xhtmlPage(document: PublishingDocument, title: string, body: string): string {
  const locale = escapeXml(document.locale);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${locale}" lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>${body}</body>
</html>`;
}

/** Build a self-contained EPUB 3 Blob with deterministic reading order. */
export async function buildPublishingEpub(document: PublishingDocument): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // EPUB requires this to be the first ZIP member and stored without compression.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`);

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
    '<item id="styles" href="styles.css" media-type="text/css" />',
  ];
  const spine: string[] = [];
  const navigation: Array<{ href: string; title: string }> = [];

  if (document.includeTitlePage) {
    const href = 'title.xhtml';
    const body = `<section class="title-page"><h1>${escapeXml(document.title)}</h1><p>${document.wordCount.toLocaleString(document.locale)} ${escapeXml(document.wordLabel)} · ${escapeXml(new Date(document.generatedAt).toLocaleDateString(document.locale))}</p></section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, document.title, body));
    manifest.push(`<item id="title" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push('<itemref idref="title" />');
    navigation.push({ href, title: document.title });
  }

  const bookNotes = document.footnotePlacement === 'book';
  // Each chapter's notes, for the one notes file after the last chapter.
  const notesBody: string[] = [];
  let nextNumber = 1;
  document.sections.forEach((section, index) => {
    const id = `section-${index + 1}`;
    const href = `${id}.xhtml`;
    const synopsis = section.synopsis ? `<p class="synopsis">${escapeXml(section.synopsis)}</p>` : '';
    const fragment = toXhtmlFragment(
      section.portableHtml,
      document.footnoteStyle,
      bookNotes ? nextNumber : 1,
      bookNotes ? NOTES_HREF : '',
    );
    if (bookNotes && fragment.notes.length > 0) {
      nextNumber += fragment.notes.length;
      notesBody.push(
        `<h2>${escapeXml(section.title)}</h2>`
        + fragment.notes.map((note) => footnoteAside(note, document.footnoteStyle, href)).join(''),
      );
    }
    const body = `<section><h1>${escapeXml(section.title)}</h1>${synopsis}${fragment.xhtml}</section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, section.title, body));
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push(`<itemref idref="${id}" />`);
    navigation.push({ href, title: section.title });
  });

  if (notesBody.length > 0) {
    const body = `<section epub:type="endnotes" class="wh-endnotes"><h1>${escapeXml(document.notesLabel)}</h1>${notesBody.join('')}</section>`;
    zip.file(`EPUB/${NOTES_HREF}`, xhtmlPage(document, document.notesLabel, body));
    manifest.push(`<item id="notes" href="${NOTES_HREF}" media-type="application/xhtml+xml" />`);
    spine.push('<itemref idref="notes" />');
    navigation.push({ href: NOTES_HREF, title: document.notesLabel });
  }

  if (document.bibliography.length > 0 && document.bibliographyTitle) {
    const href = 'bibliography.xhtml';
    const body = `<section><h1>${escapeXml(document.bibliographyTitle)}</h1>${document.bibliography.map(citation => `<p>${escapeXml(citation)}</p>`).join('')}</section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, document.bibliographyTitle, body));
    manifest.push(`<item id="bibliography" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push('<itemref idref="bibliography" />');
    navigation.push({ href, title: document.bibliographyTitle });
  }

  const navBody = `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc"><h1>${escapeXml(document.title)}</h1><ol>${navigation.map(item => `<li><a href="${item.href}">${escapeXml(item.title)}</a></li>`).join('')}</ol></nav>`;
  zip.file('EPUB/nav.xhtml', xhtmlPage(document, document.title, navBody));
  zip.file('EPUB/styles.css', `body { font-family: serif; line-height: 1.55; margin: 5%; }
h1 { text-align: center; margin: 1.5em 0 1em; }
p { margin: 0 0 0.5em; }
.title-page { text-align: center; margin-top: 30%; }
.synopsis { font-style: italic; text-align: center; margin-bottom: 2em; }
blockquote { margin: 1em 2em; font-style: italic; }
pre, code { font-family: monospace; }
.wh-noteref { text-decoration: none; }
.wh-footnote { margin-top: 1.5em; padding-top: 0.5em; border-top: 1px solid #999; font-size: 0.85em; }
.wh-footnote + .wh-footnote { margin-top: 0; padding-top: 0; border-top: 0; }
.wh-endnotes h2 { text-align: left; font-size: 1em; margin: 1.5em 0 0.5em; }
.wh-endnotes .wh-footnote { margin-top: 0; padding-top: 0; border-top: 0; font-size: 1em; }
table { border-collapse: collapse; }
td, th { border: 1px solid #777; padding: 0.25em; }`);

  const modified = new Date(document.generatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id" xml:lang="${escapeXml(document.locale)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="publication-id">${escapeXml(document.identifier)}</dc:identifier>
    <dc:title>${escapeXml(document.title)}</dc:title>
    <dc:language>${escapeXml(document.locale)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
