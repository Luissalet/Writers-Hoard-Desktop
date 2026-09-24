// ============================================
// Manuscript import — .docx (Office Open XML) reader
// ============================================
//
// A .docx is a zip; the text lives in `word/document.xml`. JSZip is already a
// dependency (the backup path uses it), so reading one needs no new package —
// it is loaded dynamically here so neither JSZip nor this reader is in the
// Writings chunk until someone actually imports a manuscript.
//
// What survives, and why it is a hand-written scan rather than DOMParser:
// the scan below walks the xml paragraph by paragraph and can stop between any
// two of them to yield to the UI and move the progress bar. `DOMParser` builds
// the whole tree in one uninterruptible call, which on a 120 000-word document
// is the single longest block of main-thread work in the whole import — the
// one thing this feature exists to avoid.
//
// SURVIVES
//   • paragraphs, in order, including those inside tables and text boxes
//     (once each: a text box's VML fallback copy is dropped);
//   • headings, from the paragraph style (`Heading1`, `Heading 1`, `Título 1`,
//     and the other localisations Word writes) or from `w:outlineLvl`;
//   • bold and italic runs, as <strong>/<em>;
//   • line breaks (<w:br/>, <w:cr/>) as <br>, tabs as spaces;
//   • Quote / Cita paragraph styles, as <blockquote>;
//   • tracked-change insertions (they are ordinary runs);
//   • footnotes and endnotes (`word/footnotes.xml`, `word/endnotes.xml`), as
//     the app's own footnote references at the place of each `w:footnoteReference`
//     — the note's paragraphs as plain text, in the reference's attribute.
//
// DROPPED — deliberately, each one noted at its branch below
//   • images, shapes, charts, equations, fields (page numbers, TOC);
//   • comments, headers and footers (separate zip parts);
//   • list numbering and bullets (a numbered paragraph imports as a paragraph);
//   • fonts, colours, sizes, alignment, indentation, spacing;
//   • underline, strike-through, sub/superscript, small caps;
//   • emphasis that a STYLE applies rather than the run itself (an all-italic
//     paragraph style imports upright);
//   • tracked-change deletions (`w:delText` is not `w:t`, so deleted text
//     never enters — which is what "accept all changes" would have done).
//
// Nothing from the file is used as markup: every scrap of text is decoded from
// xml entities and re-escaped before it becomes html, and the result is passed
// through the app's `sanitizeRichHtml` in `manuscriptPersist.ts`.

import type JSZip from 'jszip';
import { countWords } from '@/utils/text';
import { generateId } from '@/utils/idGenerator';
import { footnoteRefHtml } from '@/components/editor/footnotes/footnoteModel';
import { ManuscriptImportError, yieldToUi, type ManuscriptBlock } from './manuscriptImport';

/** Paragraphs between two yields. Big enough to be cheap, small enough to be smooth. */
const PARAGRAPHS_PER_SLICE = 200;

/** Reading and inflating the zip is the first third of the file's progress. */
const UNZIP_SHARE = 0.35;

// ---------------------------------------------------------------------------
// XML text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;

/** Xml entities → characters. An entity we don't know stays as written. */
function decodeXml(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(ENTITY_RE, (whole, decimal: string, hex: string, name: string) => {
    const code = decimal ? Number(decimal) : hex ? parseInt(hex, 16) : NaN;
    if (Number.isFinite(code)) {
      if (code < 1 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[(name ?? '').toLowerCase()] ?? whole;
  });
}

/** Text → html. The only place foreign text becomes markup. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Word derives a style id from the localised style name by dropping everything
 * that is not ASCII — which is why Spanish "Título 1" arrives as `Ttulo1` and
 * German "Überschrift 1" as `berschrift1`. Stripping accents here catches both
 * the id and the (sometimes localised, sometimes not) `w:name`.
 */
function normalizeStyleKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Built-in heading families across the Word localisations a writer is likely
 * to hand over, with or without their accents. A trailing digit is the depth;
 * without one ("Title", "Título") it is the document title — depth 1.
 */
const HEADING_STYLE_RE =
  /^(?:heading|title|titulo|ttulo|titre|titolo|uberschrift|berschrift|kop|rubrik|overskrift|otsikko|naglowek|nagwek|nadpis|cabecalho|cabealho|zaglavlje|fejezet|zagolovok)([1-9])?$/;

/** Paragraph styles that mean "this is a quotation". */
const QUOTE_STYLE_RE = /^(?:quote|intensequote|blocktext|blockquote|cita|citadestacada|citation)$/;

/** styleId → style name, from `word/styles.xml`. Absent part ⇒ empty map. */
async function readStyleNames(zip: JSZip): Promise<Map<string, string>> {
  const entry = zip.file('word/styles.xml');
  const names = new Map<string, string>();
  if (!entry) return names;
  let xml: string;
  try {
    xml = await entry.async('string');
  } catch {
    // A damaged styles part is survivable: heading detection falls back to the
    // style id and `w:outlineLvl`.
    return names;
  }
  const styleRe = /<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let match = styleRe.exec(xml);
  while (match !== null) {
    const name = /<w:name\b[^>]*w:val="([^"]*)"/.exec(match[2]);
    if (name) names.set(match[1], decodeXml(name[1]));
    match = styleRe.exec(xml);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Paragraph scanning
// ---------------------------------------------------------------------------

/**
 * Index of the next `<w:p` START TAG at or after `from`.
 *
 * The character-class test is load-bearing: `<w:pPr>`, `<w:pStyle>` and
 * `<w:pict>` all begin with `<w:p`, and a scanner that took them for
 * paragraphs would cut the document into confetti.
 */
function nextParagraphOpen(xml: string, from: number): number {
  let at = xml.indexOf('<w:p', from);
  while (at !== -1) {
    const next = xml.charAt(at + 4);
    if (next === '>' || next === '/' || next === ' ' || next === '\t' || next === '\n' || next === '\r') {
      return at;
    }
    at = xml.indexOf('<w:p', at + 4);
  }
  return -1;
}

interface ParagraphSpan {
  inner: string;
  /** Index just past `</w:p>` — where the next scan starts. */
  end: number;
}

/**
 * The paragraph that starts at `open`, with its nesting honoured: a text box
 * carries whole `<w:p>` elements INSIDE a paragraph, and a non-greedy match
 * would end the outer paragraph at the inner one's close tag and then re-read
 * the remainder as fragments. Depth counting keeps the text box's words where
 * the writer put them — inside their paragraph — instead of scattering them.
 */
function paragraphAt(xml: string, open: number): ParagraphSpan | null {
  const tagEnd = xml.indexOf('>', open);
  if (tagEnd === -1) return null;
  if (xml.charAt(tagEnd - 1) === '/') return { inner: '', end: tagEnd + 1 };

  let depth = 1;
  let cursor = tagEnd + 1;
  while (true) {
    const close = xml.indexOf('</w:p>', cursor);
    if (close === -1) return null; // truncated document
    const nested = nextParagraphOpen(xml, cursor);
    if (nested !== -1 && nested < close) {
      const nestedTagEnd = xml.indexOf('>', nested);
      if (nestedTagEnd === -1) return null;
      if (xml.charAt(nestedTagEnd - 1) !== '/') depth += 1;
      cursor = nestedTagEnd + 1;
      continue;
    }
    depth -= 1;
    cursor = close + 6;
    if (depth === 0) return { inner: xml.slice(tagEnd + 1, close), end: cursor };
  }
}

const PPR_RE = /^\s*<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/;
const PSTYLE_RE = /<w:pStyle\b[^>]*w:val="([^"]*)"/;
const OUTLINE_RE = /<w:outlineLvl\b[^>]*w:val="([^"]*)"/;

/** `<w:bCs/>` and `<w:iCs/>` fail the lookahead — they are complex-script twins. */
const BOLD_RE = /<w:b(?=[\s/>])([^>]*)>/;
const ITALIC_RE = /<w:i(?=[\s/>])([^>]*)>/;
const OFF_RE = /w:val="(?:0|false|off)"/i;

/**
 * Everything inside one paragraph that changes the text or the emphasis, in
 * document order:
 *
 *   1  `<w:r>` / `<w:r/>`   a run opens (group 1 holds the self-closing slash)
 *   2  `</w:r>`             a run closes
 *   3  `<w:rPr>…</w:rPr>`   the open run's formatting (group 2)
 *   4  `<w:t …/>`           an empty text element
 *   5  `<w:t …>text</w:t>`  text (group 3)
 *   6  `<w:tab/>` `<w:br/>` `<w:cr/>` `<w:noBreakHyphen/>`
 *   7  `<w:footnoteReference w:id="n"/>`, `<w:endnoteReference …/>` — a note
 *      (group 4 is `footnote` or `endnote`, group 5 the id). `w:footnoteRef`,
 *      the marker inside a note's own body, is a different element and is
 *      not matched.
 *   8  `<w:p …>` / `</w:p>` — a paragraph NESTED in this one (a text box's;
 *      the scanned paragraph's own tags are not part of `inner`). Each edge
 *      is a line break, or the box's first and last words run into the text
 *      around it.
 *
 * Read as a token stream with a stack rather than run-by-run because runs
 * NEST: a text box lives inside a run, carrying whole paragraphs with runs of
 * their own. A per-run regex ends the outer run at the inner one's close tag
 * and silently loses whatever the writer typed after the box.
 *
 * `<w:delText>` is deliberately absent — that is how the text of a tracked
 * deletion never enters, which is what accepting all changes would do.
 *
 * Alternative 4 precedes 5, and matches attributes: read the other way round,
 * `<w:t xml:space="preserve"/>` would open a capture that runs on to the next
 * `</w:t>` and swallow everything between.
 */
const PARAGRAPH_TOKEN_RE =
  /<w:r(?=[\s/>])[^>]*?(\/?)>|<\/w:r>|<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>|<w:t(?:\s[^>]*?)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/?>|<w:noBreakHyphen\s*\/>|<w:(footnote|endnote)Reference\b[^>]*?w:id="([^"]*)"[^>]*\/>|<w:p(?=[\s>])[^>]*>|<\/w:p>/g;

/** A toggle property is on unless it says otherwise (`w:val="0"`). */
function toggleOn(runProps: string, pattern: RegExp): boolean {
  const match = pattern.exec(runProps);
  if (!match) return false;
  return !OFF_RE.test(match[1]);
}

interface Inline {
  text: string;
  html: string;
}

/** The notes of the file, by Word's id, as plain text: one line per paragraph. */
interface DocxNotes {
  footnotes: Map<string, string>;
  endnotes: Map<string, string>;
}

const NO_NOTES: DocxNotes = { footnotes: new Map(), endnotes: new Map() };

interface RunState {
  bold: boolean;
  italic: boolean;
}

const PLAIN: RunState = { bold: false, italic: false };

/**
 * One paragraph, flattened into its text and the html that mirrors it.
 *
 * Emphasis is coalesced across run boundaries: Word splits a sentence into a
 * new run at every spell-check and revision boundary, so a bold clause can
 * arrive as five runs and must not leave as five `<strong>` elements.
 */
function readParagraphText(inner: string, notes: DocxNotes = NO_NOTES): Inline {
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const stack: RunState[] = [];

  let openBold = false;
  let openItalic = false;
  let group: string[] = [];

  const flushGroup = (): void => {
    if (group.length === 0) return;
    let html = group.join('');
    if (openItalic) html = `<em>${html}</em>`;
    if (openBold) html = `<strong>${html}</strong>`;
    htmlParts.push(html);
    group = [];
  };

  // A nested paragraph began or ended (token 8). The line break is placed
  // before the next thing written, so a box at either end of the paragraph
  // adds no blank line of its own.
  let nestedBreak = false;

  const emit = (text: string, html: string, state: RunState): void => {
    if (state.bold !== openBold || state.italic !== openItalic) {
      flushGroup();
      openBold = state.bold;
      openItalic = state.italic;
    }
    if (nestedBreak) {
      nestedBreak = false;
      if (textParts.length > 0) {
        textParts.push('\n');
        group.push('<br>');
      }
    }
    textParts.push(text);
    group.push(html);
  };

  PARAGRAPH_TOKEN_RE.lastIndex = 0;
  let token = PARAGRAPH_TOKEN_RE.exec(inner);
  while (token !== null) {
    const raw = token[0];
    const state = stack.length > 0 ? stack[stack.length - 1] : PLAIN;

    if (token[1] !== undefined) {
      // A run opens; `<w:r/>` opens and closes at once and holds nothing.
      if (token[1] !== '/') stack.push({ bold: false, italic: false });
    } else if (raw === '</w:r>') {
      stack.pop();
    } else if (token[2] !== undefined) {
      // Formatting belongs to the run it is declared in, never to its parent.
      if (stack.length > 0) {
        state.bold = toggleOn(token[2], BOLD_RE);
        state.italic = toggleOn(token[2], ITALIC_RE);
      }
    } else if (token[3] !== undefined) {
      const decoded = decodeXml(token[3]);
      if (decoded.length > 0) emit(decoded, escapeHtml(decoded), state);
    } else if (raw.startsWith('<w:tab')) {
      emit(' ', ' ', state);
    } else if (raw.startsWith('<w:p') || raw === '</w:p>') {
      nestedBreak = true;
    } else if (raw.startsWith('<w:br') || raw.startsWith('<w:cr')) {
      emit('\n', '<br>', state);
    } else if (raw.startsWith('<w:noBreakHyphen')) {
      emit('-', '-', state);
    } else if (token[4] !== undefined) {
      // A note's body is not the paragraph's text (it is not counted, not a
      // chapter title), so the text side gets nothing. A reference to a note
      // the file does not hold is dropped, as Word itself would show nothing.
      const body = (token[4] === 'endnote' ? notes.endnotes : notes.footnotes).get(token[5]);
      if (body !== undefined) emit('', footnoteRefHtml(generateId(), body), state);
    }

    token = PARAGRAPH_TOKEN_RE.exec(inner);
  }

  flushGroup();
  return { text: textParts.join(''), html: htmlParts.join('') };
}

/** Heading depth for a paragraph, or 0 for body text. */
function headingLevel(styleId: string, styleName: string, outline: string): number {
  for (const candidate of [styleId, styleName]) {
    if (!candidate) continue;
    const match = HEADING_STYLE_RE.exec(normalizeStyleKey(candidate));
    if (match) return match[1] ? Math.min(6, Number(match[1])) : 1;
  }
  // `w:outlineLvl` is the fallback: a writer who built their own chapter style
  // on top of "Normal" and set its outline level still gets chapters.
  if (outline) {
    const value = Number(outline);
    if (Number.isFinite(value) && value >= 0 && value <= 8) return Math.min(6, value + 1);
  }
  return 0;
}

function isQuote(styleId: string, styleName: string): boolean {
  for (const candidate of [styleId, styleName]) {
    if (candidate && QUOTE_STYLE_RE.test(normalizeStyleKey(candidate))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Alternate content
// ---------------------------------------------------------------------------

const SELF_CLOSING_FALLBACK_RE = /<mc:Fallback\b[^>]*\/>/g;
/** A fallback with no other fallback inside it. */
const INNERMOST_FALLBACK_RE = /<mc:Fallback\b[^>]*>(?:(?!<mc:Fallback\b)[\s\S])*?<\/mc:Fallback>/g;

/**
 * `mc:AlternateContent` carries one object twice — `mc:Choice` for readers
 * that know DrawingML, `mc:Fallback` (VML) for older ones — and Word writes
 * every text box that way, so the box's paragraphs are in the part twice and
 * a scan of both imports the writer's letter, epigraph or sidebar twice over.
 * The choice is kept and the fallback dropped. Innermost first, until none is
 * left: a text box can hold another, fallback and all.
 */
function dropAlternateFallbacks(xml: string): string {
  if (!xml.includes('<mc:Fallback')) return xml;
  let result = xml.replace(SELF_CLOSING_FALLBACK_RE, '');
  let previous: string;
  do {
    previous = result;
    result = result.replace(INNERMOST_FALLBACK_RE, '');
  } while (result !== previous);
  return result;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * The notes of one part (`word/footnotes.xml` or `word/endnotes.xml`) by
 * Word's id. Word keeps two typed notes of its own in every file — the
 * separator rules, `w:type="separator"` and `"continuationSeparator"` — and
 * those are not the writer's; a note with a type is skipped. The body is the
 * note's paragraphs as text, one per line, read with the same scanner as the
 * document so a note's nesting and entities are handled once.
 */
async function readNotes(zip: JSZip, part: string, tag: 'footnote' | 'endnote'): Promise<Map<string, string>> {
  const notes = new Map<string, string>();
  const entry = zip.file(part);
  if (!entry) return notes;
  let xml: string;
  try {
    xml = dropAlternateFallbacks(await entry.async('string'));
  } catch {
    // A damaged notes part costs the notes, not the manuscript.
    return notes;
  }
  const noteRe = new RegExp(`<w:${tag}\\b([^>]*)>([\\s\\S]*?)</w:${tag}>`, 'g');
  let match = noteRe.exec(xml);
  while (match !== null) {
    const id = /w:id="([^"]*)"/.exec(match[1])?.[1];
    if (id !== undefined && !/w:type="/.test(match[1])) {
      const body = match[2];
      const lines: string[] = [];
      let cursor = 0;
      while (cursor < body.length) {
        const open = nextParagraphOpen(body, cursor);
        if (open === -1) break;
        const span = paragraphAt(body, open);
        if (!span) break;
        cursor = span.end;
        const text = readParagraphText(span.inner).text.replace(/[\t\u00a0 ]+/g, ' ').trim();
        if (text) lines.push(text);
      }
      notes.set(id, lines.join('\n'));
    }
    match = noteRe.exec(xml);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function openDocx(data: ArrayBuffer): Promise<JSZip> {
  const { default: JSZipCtor } = await import('jszip');
  try {
    return await JSZipCtor.loadAsync(data);
  } catch {
    // Renamed .doc, a truncated download, an encrypted document: not a zip.
    throw new ManuscriptImportError('not-zip');
  }
}

/**
 * Read a .docx into blocks. `onProgress` is called with 0–1 for this file and
 * the loop yields between slices, so the window keeps painting through a
 * 120 000-word manuscript.
 */
export async function parseDocxBlocks(
  data: ArrayBuffer,
  onProgress?: (ratio: number) => void,
): Promise<ManuscriptBlock[]> {
  const zip = await openDocx(data);
  const entry = zip.file('word/document.xml');
  // A zip without the main document part is not a Word file — a .pages, an
  // .epub or a plain archive someone renamed.
  if (!entry) throw new ManuscriptImportError('invalid-docx');

  const styleNames = await readStyleNames(zip);
  const notes: DocxNotes = {
    footnotes: await readNotes(zip, 'word/footnotes.xml', 'footnote'),
    endnotes: await readNotes(zip, 'word/endnotes.xml', 'endnote'),
  };

  let xml: string;
  try {
    // JSZip's async pipeline inflates in chunks and hands back the event loop
    // between them; `percent` drives the first third of the bar.
    xml = await entry.async('string', (metadata) => {
      onProgress?.((UNZIP_SHARE * metadata.percent) / 100);
    });
  } catch {
    throw new ManuscriptImportError('invalid-docx');
  }
  if (!xml.includes('<w:')) throw new ManuscriptImportError('invalid-docx');
  xml = dropAlternateFallbacks(xml);

  const blocks: ManuscriptBlock[] = [];
  const length = Math.max(1, xml.length);
  let cursor = 0;
  let seen = 0;

  while (cursor < xml.length) {
    const open = nextParagraphOpen(xml, cursor);
    if (open === -1) break;
    const span = paragraphAt(xml, open);
    if (!span) break; // truncated tail: keep everything read so far
    cursor = span.end;

    seen += 1;
    if (seen % PARAGRAPHS_PER_SLICE === 0) {
      onProgress?.(UNZIP_SHARE + (1 - UNZIP_SHARE) * (cursor / length));
      await yieldToUi();
    }

    const inner = span.inner;
    if (!inner) continue;

    const propsMatch = PPR_RE.exec(inner);
    const props = propsMatch ? propsMatch[1] : '';
    const styleId = PSTYLE_RE.exec(props)?.[1] ?? '';
    const outline = OUTLINE_RE.exec(props)?.[1] ?? '';
    const styleName = styleId ? styleNames.get(styleId) ?? '' : '';

    const inline = readParagraphText(inner, notes);
    const text = inline.text.replace(/[\t\u00a0 ]+/g, ' ').trim();
    // Empty paragraphs are Word's spacing, not the author's words: a blank
    // line between scenes is not content, and importing it would open every
    // chapter with a run of empty paragraphs.
    if (!text) continue;

    const level = headingLevel(styleId, styleName, outline);
    const html =
      level > 0
        ? `<h${level}>${inline.html}</h${level}>`
        : isQuote(styleId, styleName)
          ? `<blockquote><p>${inline.html}</p></blockquote>`
          : `<p>${inline.html}</p>`;

    blocks.push({ level, text, html, words: countWords(text) });
  }

  // Parsed fine and said nothing: a document of images, or a stub.
  if (blocks.length === 0) throw new ManuscriptImportError('no-text');
  onProgress?.(1);
  return blocks;
}
