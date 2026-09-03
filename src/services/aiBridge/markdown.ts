// ============================================================================
// AI bridge — Markdown ⇄ TipTap HTML
// ============================================================================
//
// The app stores rich text as the HTML TipTap StarterKit produces. External
// models are far better at Markdown than at HTML, so the bridge speaks
// Markdown in both directions:
//
//   reading   tiptapHtmlToMarkdown()    (here, over htmlToMarkdown() from
//                                        engines/writings/manuscriptExport.ts)
//   writing   markdownToTiptapHtml()    (here)
//
// Zero dependencies on purpose: `marked`, `turndown` and friends would pull a
// full CommonMark engine into the renderer bundle to serve a node set TipTap
// deliberately keeps small. Everything produced here stays inside StarterKit's
// schema plus the Link and Image extensions the app already loads — and, when
// asked, the manuscript's footnote node.
//
// Whatever comes out of this MUST still pass through sanitizeRichHtml before
// it touches the database — this converter escapes its input, but the
// sanitizer is the app's single admitted gate for foreign HTML.
//
// FOOTNOTES are opt-in (`options.footnotes`), because only the manuscript
// editor loads the footnote node. A codex or diary body has nowhere to keep a
// `<sup data-footnote>`, so there a `[^1]` stays what it always was: text. The
// copilot's chat bubbles render through this converter too, and a note the
// model writes in conversation must stay readable rather than become an empty
// superscript.
//
// In the manuscript the syntax is Markdown's own: `[^label]` in the prose and
// `[^label]: text` anywhere on its own line, later lines of one note indented
// four spaces. Reading a chapter emits the note's real id as the label, so a
// model that edits the chapter and sends it back leaves every note with the
// id it had; a label that is not one of ours (`[^1]`, the way models write
// them) is used as the id when it is safe to, and replaced by a fresh id when
// it is not or it is already taken.

import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import {
  FOOTNOTE_ID_ATTR,
  footnoteRefHtml,
  footnoteRefsOutOfCode,
  isFootnoteLabel,
  renderFootnoteRefs,
} from '@/components/editor/footnotes/footnoteModel';
import { generateId } from '@/utils/idGenerator';

export interface MarkdownOptions {
  /** Read and write `[^label]` footnotes as the manuscript's footnote node. */
  footnotes?: boolean;
  /**
   * Ids already in use in the body this Markdown is about to join, so a label
   * that would repeat one of them gets a fresh id instead. `wh_append_writing`
   * converts only the addition and cannot otherwise know what the chapter holds.
   */
  reservedFootnoteIds?: readonly string[];
}

/** Characters that would otherwise smuggle markup through. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

/** `[^label]: text` — a label has no whitespace and no `]`, as in GFM. */
const FOOTNOTE_DEFINITION_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
/** A line that continues the note above: four spaces (a tab counts as four). */
const FOOTNOTE_CONTINUATION_RE = /^ {4}(.*)$/;
const FOOTNOTE_REF_RE = /\[\^([^\]\s]+)\]/g;
/** Mirrors the fence test of the block loop, so a definition inside code stays code. */
const FENCE_RE = /^\s*```(\w*)\s*$/;

interface FootnoteState {
  /** label → body, first definition wins as in GFM. */
  definitions: Map<string, string>;
  /** Ids handed out so far in this conversion, plus the reserved ones. */
  used: Set<string>;
}

function footnoteState(options: MarkdownOptions): FootnoteState | null {
  if (!options.footnotes) return null;
  return { definitions: new Map(), used: new Set(options.reservedFootnoteIds ?? []) };
}

/**
 * Pull every `[^label]: text` block out of the line stream, so the block
 * parser never sees it as a paragraph, and keep its text for the references.
 * A note's later lines are the indented ones that follow, blank lines
 * included when an indented line comes after them.
 */
function liftFootnoteDefinitions(lines: string[], state: FootnoteState): string[] {
  const kept: string[] = [];
  let inFence = false;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at].replace(/\t/g, '    ');
    if (FENCE_RE.test(line)) inFence = !inFence;
    const definition = inFence ? null : FOOTNOTE_DEFINITION_RE.exec(line);
    if (!definition) {
      kept.push(lines[at]);
      continue;
    }
    const body = [definition[2]];
    while (at + 1 < lines.length) {
      const next = lines[at + 1].replace(/\t/g, '    ');
      const continued = FOOTNOTE_CONTINUATION_RE.exec(next);
      if (continued) {
        body.push(continued[1]);
        at += 1;
        continue;
      }
      if (next.trim()) break;
      // Blank lines belong to the note only when an indented line follows.
      let after = at + 2;
      while (after < lines.length && !lines[after].trim()) after += 1;
      if (after >= lines.length || !FOOTNOTE_CONTINUATION_RE.test(lines[after].replace(/\t/g, '    '))) break;
      for (let blank = at + 1; blank < after; blank += 1) body.push('');
      at = after - 1;
    }
    if (!state.definitions.has(definition[1])) {
      state.definitions.set(definition[1], body.join('\n').replace(/\s+$/, ''));
    }
  }
  return kept;
}

/**
 * The id a reference gets. The label itself when it is a safe one nobody
 * holds yet — which is how a chapter read through the bridge keeps its ids
 * on the way back — and a fresh one otherwise. Two references to one label
 * become two notes with the same text: the node has no notion of a shared
 * note, and two nodes with one id would answer to only one of them.
 */
function footnoteIdFor(label: string, state: FootnoteState): string {
  const id = isFootnoteLabel(label) && !state.used.has(label) ? label : generateId();
  state.used.add(id);
  return id;
}

/** Sentinel brackets for lifted spans: U+E000/U+E001, which no keyboard and no model produces, and which the input is stripped of. */
const LIFT_OPEN = '';
const LIFT_CLOSE = '';
const LIFT_CHARS_RE = /[]/g;
const LIFT_RE = /(\d+)/g;

/**
 * Inline formatting. Code spans are lifted out first so their contents are
 * never re-read as bold, italic or a link; footnote references right after,
 * because what stands in for them is markup that must not be escaped or
 * emphasised. A reference to a label nobody defined is still a note — an
 * empty one — rather than a lost marker.
 */
function inlineMarkdown(text: string, footnotes: FootnoteState | null): string {
  const lifted: string[] = [];
  const lift = (html: string): string => {
    lifted.push(html);
    return LIFT_OPEN + String(lifted.length - 1) + LIFT_CLOSE;
  };
  // The sentinel's brackets are private-use characters, and any the input
  // holds are dropped first: a sentinel typed into the prose would otherwise
  // be replaced by whatever had been lifted under that number — a note, say,
  // duplicated under an id the panel can only answer for once.
  let work = text.replace(LIFT_CHARS_RE, '');
  work = work.replace(/`([^`]+)`/g, (_match, code: string) => lift('<code>' + escapeHtml(code) + '</code>'));
  if (footnotes) {
    // `\[^` is the bridge's own escape for a bracket-caret that is prose, not
    // a reference (see tiptapHtmlToMarkdown); it comes back as the two
    // characters, lifted so the reference pattern below cannot see them.
    work = work.replace(/\\\[\^/g, () => lift('[^'));
    work = work.replace(FOOTNOTE_REF_RE, (_match, label: string) =>
      lift(footnoteRefHtml(footnoteIdFor(label, footnotes), footnotes.definitions.get(label) ?? '')));
  }

  work = escapeHtml(work);

  // Images before links: ![alt](src) is the link pattern with a leading bang.
  work = work.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, alt: string, src: string) => {
      const url = safeUrl(src);
      return url ? `<img src="${url}" alt="${alt}">` : match;
    },
  );
  work = work.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, label: string, href: string) => {
      const url = safeUrl(href);
      return url ? `<a href="${url}">${label}</a>` : match;
    },
  );

  work = work
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');

  return work.replace(LIFT_RE, (_match, index: string) => lifted[Number(index)] ?? '');
}

/** Only http(s), mailto, in-document and data-image URLs survive. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  if (/^(\/|\.\/|\.\.\/|#)/.test(url)) return url;
  return null;
}

interface ListFrame {
  ordered: boolean;
  indent: number;
  /** An <li> is open: a deeper list nests inside it, a sibling item closes it. */
  open: boolean;
}

/**
 * Convert Markdown to the HTML subset TipTap round-trips cleanly.
 * Unknown syntax degrades to paragraphs rather than being dropped.
 */
export function markdownToTiptapHtml(markdown: string, options: MarkdownOptions = {}): string {
  const footnotes = footnoteState(options);
  const rawLines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const lines = footnotes ? liftFootnoteDefinitions(rawLines, footnotes) : rawLines;
  const inline = (text: string): string => inlineMarkdown(text, footnotes);

  const out: string[] = [];
  const listStack: ListFrame[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let codeFence: string[] | null = null;

  const closeLists = (toIndent = -1): void => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      const frame = listStack.pop();
      if (frame?.open) out.push('</li>');
      out.push(frame?.ordered ? '</ol>' : '</ul>');
    }
  };

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };

  const flushQuote = (): void => {
    if (!quote.length) return;
    out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`);
    quote = [];
  };

  const flushAll = (): void => {
    flushParagraph();
    flushQuote();
    closeLists();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');
    const fence = /^\s*```(\w*)\s*$/.exec(line);

    // A fenced block swallows every line until its closing fence.
    if (codeFence) {
      if (fence) {
        out.push(`<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`);
        codeFence = null;
      } else {
        codeFence.push(rawLine);
      }
      continue;
    }
    if (fence) {
      flushAll();
      codeFence = [];
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const blockquote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (blockquote) {
      flushParagraph();
      closeLists();
      quote.push(blockquote[1]);
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      flushParagraph();
      flushQuote();
      let indent = item[1].length;
      const isOrdered = Boolean(ordered);
      const text = (ordered ? ordered[3] : item[2]).trim();
      // Models write "1. Marta" then "- age: 34" flush left, meaning the bullet
      // belongs to the item above. CommonMark would start a new list and the
      // numbering would restart at 1 for every entry; read it as nesting.
      const sibling = listStack.find((frame) => frame.indent === indent);
      if (bullet && sibling?.ordered && sibling.open) indent = sibling.indent + 2;
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        const start = ordered ? Number(ordered[2]) : 1;
        listStack.push({ ordered: isOrdered, indent, open: false });
        out.push(isOrdered ? (start > 1 ? `<ol start="${start}">` : '<ol>') : '<ul>');
      } else if (top.ordered !== isOrdered) {
        // A different marker at the same depth starts a different list.
        listStack.pop();
        if (top.open) out.push('</li>');
        out.push(top.ordered ? '</ol>' : '</ul>');
        listStack.push({ ordered: isOrdered, indent, open: false });
        out.push(isOrdered ? '<ol>' : '<ul>');
      }
      const frame = listStack[listStack.length - 1];
      if (frame.open) out.push('</li>');
      out.push(`<li><p>${inline(text)}</p>`);
      frame.open = true;
      continue;
    }

    // Anything else is prose; consecutive lines join as soft breaks.
    flushQuote();
    closeLists();
    paragraph.push(line.trim());
  }

  if (codeFence) out.push(`<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`);
  flushAll();

  return out.join('') || '<p></p>';
}

/**
 * The label a note travels under. Its id, when the id can be a label; the
 * document number otherwise (an id the body lost, a pasted one with a space).
 * Never one already handed out in this body: a duplicated id — two references
 * pasted from one — would otherwise fold into one definition on the way back.
 */
function footnoteLabelFor(id: string, index: number, used: Set<string>): string {
  let label = isFootnoteLabel(id) ? id : String(index);
  while (used.has(label)) label = `${label}-${index}`;
  used.add(label);
  return label;
}

/** The text after `[^label]: ` — later lines indented, the way `manuscriptExport` writes them. */
function footnoteDefinition(label: string, text: string): string {
  return `[^${label}]: ${text.split(/\r?\n/).join('\n    ')}`;
}

/**
 * The body made safe to write with `[^label]` references in it. Two things
 * in the prose would otherwise be read back as notes they are not:
 *
 *   • a literal `[^…]` in the text — a bracket-caret the writer typed, or a
 *     line that happens to look like `[^id]: text` — is escaped as `\[^`,
 *     which `inlineMarkdown` turns back into the two characters (a code span
 *     or block is left alone: the parser never reads references there);
 *   • a reference inside `<code>` would come out as `` `c[^id]` `` and be
 *     code on the way back, the note gone. A note does not live inside code,
 *     so the reference is moved to just after the `</code>`
 *     (`footnoteRefsOutOfCode`, which the manuscript exporter shares).
 *
 * On the DOM rather than the string: an attribute value (the note's own text)
 * may hold `[^` too, and must not be touched.
 */
function prepareProseForFootnotes(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = footnoteRefsOutOfCode(html);
  const root = template.content;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.includes('[^') || text.parentElement?.closest('code, pre')) continue;
    text.data = text.data.replace(/\[\^/g, '\\[^');
  }
  const holder = document.createElement('div');
  holder.append(root);
  return holder.innerHTML;
}

/**
 * Convert stored TipTap HTML to Markdown — the reading half of the bridge.
 *
 * Without `footnotes` this is `htmlToMarkdown` from the manuscript exporter,
 * which numbers notes 1, 2, 3 per chapter the way a printed file should. With
 * it, each reference is written as `[^id]` and the definitions follow the
 * prose, so the ids survive the trip through a model and back and
 * `markdownToTiptapHtml` puts every note back where it was, with the id the
 * panel and the popover were already holding. A body without notes takes the
 * exporter's path untouched.
 */
export function tiptapHtmlToMarkdown(html: string, options: MarkdownOptions = {}): string {
  if (!options.footnotes || !html.includes(FOOTNOTE_ID_ATTR)) return htmlToMarkdown(html);
  const used = new Set<string>();
  const labels: string[] = [];
  const refs = renderFootnoteRefs(prepareProseForFootnotes(html), (note) => {
    const label = footnoteLabelFor(note.id, note.index, used);
    labels.push(label);
    return `[^${label}]`;
  });
  const markdown = htmlToMarkdown(refs.html);
  if (refs.notes.length === 0) return markdown;
  const definitions = refs.notes.map((note, at) => footnoteDefinition(labels[at], note.text));
  return `${markdown}\n\n${definitions.join('\n')}`;
}

/** Word count from Markdown, matching what the app shows for the stored HTML. */
export function countMarkdownWords(markdown: string): number {
  const text = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]/g, ' ')
    .trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
