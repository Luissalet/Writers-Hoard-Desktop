// ============================================
// Manuscript import — Markdown / plain-text reader
// ============================================
//
// One reader for `.md`, `.txt` and the pasted box, because the difference
// between them is a file extension and a habit: a plain-text novel that says
// "# Chapter One" means a heading, and one that says nothing special is
// paragraphs either way. Markdown syntax a writer never used costs them
// nothing.
//
// The Markdown → html conversion is `markdownToTiptapHtml` from the AI bridge
// (`src/services/aiBridge/markdown.ts`) — the app's existing converter into
// exactly the html TipTap round-trips, with zero dependencies and its input
// escaped. It is the mirror of `manuscriptExport.ts`'s `htmlToMarkdown`, which
// that module already calls the other way round; using anything else here
// would mean two Markdown dialects in one app.
//
// This file's own job is the part a converter cannot do: cutting the text into
// BLOCKS whose boundaries the chapter splitter can reason about, keeping each
// block's html equal to what the whole document would have produced.
//
//   • A heading line is its own block, carrying its depth.
//   • Everything else is a maximal run of non-blank lines. Fenced code blocks
//     survive their blank lines; so do lists, which is what keeps a "loose"
//     list one list instead of six.
//   • Hard-wrapped prose is unwrapped (see `joinSoftWrapped`) — the one place
//     this reader is deliberately not literal.

import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { countWords, stripHtml } from '@/utils/text';
import { yieldToUi, type ManuscriptBlock } from './manuscriptImport';

/** Lines between two yields. A 120 000-word file is ~10 000 lines. */
const LINES_PER_SLICE = 1024;

const LIST_ITEM_RE = /^(?:\s*)(?:[-*+]|\d+[.)])\s+/;
const FENCE_RE = /^\s{0,3}(```+|~~~+)/;
const ATX_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
/** Setext underline: `=====` under a line is an h1, `-----` an h2. */
const SETEXT_RE = /^\s{0,3}(=+|-+)\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const INDENTED_RE = /^\s{4,}\S/;

/**
 * Below this many characters a line ends because the writer ended it — verse,
 * an address, a list of names. Above it, the line ended because the page did.
 *
 * A .txt manuscript wrapped at 72 columns would otherwise import with a forced
 * break at the end of every single line: the converter renders a newline
 * inside a paragraph as `<br>`, which is right for the AI bridge (models mean
 * their line breaks) and wrong for a novel typed into a fixed-width window.
 * CommonMark itself would join every one of those lines; the width test keeps
 * the poem in chapter nine from being flattened along with them.
 */
const WRAPPED_LINE_MIN = 45;

/**
 * Rejoin lines that a text editor wrapped, leaving deliberate breaks alone.
 * Structured blocks — lists, quotes, indented code, tables — keep every line.
 */
function joinSoftWrapped(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  for (const line of lines) {
    if (LIST_ITEM_RE.test(line) || QUOTE_RE.test(line) || INDENTED_RE.test(line) || line.includes('|')) {
      return lines;
    }
  }
  const joined: string[] = [lines[0]];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = joined[joined.length - 1];
    const wrapped =
      previous.trim().length >= WRAPPED_LINE_MIN &&
      // Markdown's two explicit hard breaks: two trailing spaces, or a
      // backslash. Both mean the writer asked for the break.
      !/(?: {2,}|\\)$/.test(previous);
    if (wrapped) joined[joined.length - 1] = `${previous.trimEnd()} ${lines[index].trim()}`;
    else joined.push(lines[index]);
  }
  return joined;
}

/** Does the blank line at `from` sit inside a list rather than after it? */
function listContinues(lines: string[], from: number): boolean {
  for (let index = from + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    // Another item, or the indented continuation of the current one.
    return LIST_ITEM_RE.test(line) || /^\s{2,}\S/.test(line);
  }
  return false;
}

/**
 * Read Markdown or plain text into blocks. `onProgress` is called with 0–1 and
 * the loop yields between slices, so a very long paste cannot lock the window.
 */
export async function parseTextBlocks(
  raw: string,
  onProgress?: (ratio: number) => void,
): Promise<ManuscriptBlock[]> {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: ManuscriptBlock[] = [];

  let pending: string[] = [];
  /** The fence marker that opened the current code block, or null. */
  let fence: string | null = null;

  const flush = (): void => {
    const source = pending.join('\n');
    pending = [];
    if (!source.trim()) return;
    const html = markdownToTiptapHtml(joinSoftWrapped(source.split('\n')).join('\n'));
    // `text` stays the RAW source: the separator rule compares against what the
    // writer typed (`***`), not against the `<hr>` it renders as.
    blocks.push({ level: 0, text: source, html, words: countWords(html) });
  };

  const pushHeading = (level: number, title: string): void => {
    if (!title) return;
    // Back through the same converter so inline emphasis and escaping in a
    // heading behave exactly as they do in a paragraph.
    const html = markdownToTiptapHtml(`${'#'.repeat(level)} ${title}`);
    const plain = stripHtml(html);
    if (!plain) return;
    blocks.push({ level, text: plain, html, words: countWords(plain) });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (index > 0 && index % LINES_PER_SLICE === 0) {
      onProgress?.(index / lines.length);
      await yieldToUi();
    }

    if (fence !== null) {
      pending.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      pending.push(line);
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      flush();
      pushHeading(atx[1].length, atx[2].replace(/\s+#+\s*$/, '').trim());
      continue;
    }

    const setext = SETEXT_RE.exec(line);
    if (
      setext &&
      pending.length === 1 &&
      pending[0].trim() &&
      !LIST_ITEM_RE.test(pending[0]) &&
      !QUOTE_RE.test(pending[0])
    ) {
      const title = pending[0].trim();
      pending = [];
      pushHeading(setext[1].startsWith('=') ? 1 : 2, title);
      continue;
    }

    if (!line.trim()) {
      // A blank line ends the block — unless a list is open and goes on after
      // it, which is how a loose list stays one list.
      if (pending.length > 0 && LIST_ITEM_RE.test(pending[0]) && listContinues(lines, index)) {
        pending.push(line);
        continue;
      }
      flush();
      continue;
    }

    pending.push(line);
  }

  // An unterminated fence keeps its text rather than throwing it away.
  flush();
  onProgress?.(1);
  return blocks;
}
