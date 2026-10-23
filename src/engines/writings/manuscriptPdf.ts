// ============================================
// Manuscript import — PDF reader (text layer only)
// ============================================
//
// Text comes from `pdfjs-dist`, page by page, with the position and size of
// every fragment. Paragraphs are rebuilt from those positions:
//
//   • fragments on the same baseline are one line;
//   • a new paragraph starts at a bigger-than-usual vertical gap, at an
//     indented line after a finished sentence, or after a line that stops
//     well short of the right margin and ends a sentence;
//   • a word cut by a hyphen at the end of a line is joined back;
//   • a paragraph that is still open at the bottom of a page continues on
//     the next one;
//   • lines repeated at the top or bottom of most pages (running titles,
//     page numbers) are dropped;
//   • a line is a HEADING only when it is obviously bigger than the body
//     text (at least 25% and 2 points), short, and not a bare number.
//
// What it does NOT do: read scanned pages (there is no text to read — a PDF
// with no text layer is refused with the `scanned-pdf` error so nothing is
// imported empty), reorder multi-column pages (columns are read as the page
// lays them out, line by line), or recover tables, footnotes or images.
//
// Nothing from the file is used as markup: every line is escaped.

import { countWords } from '@/utils/text';
import { ManuscriptImportError, yieldToUi, type ManuscriptBlock, type SourceNote } from './manuscriptImport';

/** Pages read from one PDF; a longer file is cut here and the cut is reported. */
export const MAX_PDF_PAGES = 2000;

export interface PdfReadResult { blocks: ManuscriptBlock[]; notes: SourceNote[]; pages: number }

interface Fragment { str: string; x: number; y: number; width: number; size: number }
interface Line { y: number; x: number; right: number; size: number; text: string; chars: number }

const LIGATURES: Record<string, string> = { '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st', '\u00ad': '' };
const clean = (value: string): string => value.replace(/[\ufb00-\ufb06\u00ad]/g, char => LIGATURES[char] ?? char).replace(/[\s\u00a0]+/g, ' ').trim();
const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SENTENCE_END = /[.!?:;…»”"')\]]$/;
const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };

function buildLines(fragments: Fragment[]): Line[] {
  const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Fragment[][] = [];
  for (const fragment of sorted) {
    const row = rows.at(-1);
    const anchor = row?.[0];
    if (row && anchor && Math.abs(anchor.y - fragment.y) <= 0.5 * Math.min(anchor.size, fragment.size)) row.push(fragment);
    else rows.push([fragment]);
  }
  return rows.map(row => {
    row.sort((a, b) => a.x - b.x);
    let text = '', previousEnd = row[0].x;
    for (const [index, fragment] of row.entries()) {
      const gap = fragment.x - previousEnd;
      if (index && gap > 0.12 * fragment.size && !text.endsWith(' ') && !fragment.str.startsWith(' ')) text += ' ';
      text += fragment.str;
      previousEnd = Math.max(previousEnd, fragment.x + fragment.width);
    }
    const dominant = row.reduce((best, fragment) => (fragment.str.length > best.str.length ? fragment : best), row[0]);
    const cleaned = clean(text);
    return { y: row[0].y, x: row[0].x, right: previousEnd, size: dominant.size, text: cleaned, chars: cleaned.length };
  }).filter(line => line.chars > 0);
}

const roundSize = (size: number): number => Math.round(size * 2) / 2;
const shape = (text: string): string => text.replace(/\d+/g, '#').toLowerCase();

/** Read a PDF's text layer into heading/paragraph blocks. */
export async function parsePdfBlocks(source: ArrayBuffer | Uint8Array, report?: (ratio: number) => void): Promise<PdfReadResult> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  // Bundled apps give a URL; a plain bundle (the test harness) has already put the worker on `globalThis`, which pdf.js uses on the main thread.
  if (typeof workerModule.default === 'string') GlobalWorkerOptions.workerSrc = workerModule.default;
  // pdf.js takes ownership of the buffer it is given; hand it a copy.
  const data = new Uint8Array(source instanceof Uint8Array ? source : new Uint8Array(source)).slice();
  const task = getDocument({ data });
  let pdf: Awaited<typeof task.promise>;
  try { pdf = await task.promise; } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') throw new ManuscriptImportError('protected');
    throw new ManuscriptImportError('invalid-pdf');
  }
  try {
    const pages: Line[][] = [];
    let chars = 0, emptyPages = 0;
    const weights = new Map<number, number>();
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let number = 1; number <= pageCount; number += 1) {
      report?.(0.05 + 0.6 * (number / pageCount));
      if (number % 4 === 0) await yieldToUi();
      const page = await pdf.getPage(number), content = await page.getTextContent();
      const fragments: Fragment[] = [];
      for (const item of content.items) {
        const entry = item as { str?: unknown; transform?: number[]; width?: number; height?: number };
        if (typeof entry.str !== 'string' || !entry.str.trim() || !Array.isArray(entry.transform)) continue;
        const size = Math.hypot(entry.transform[0], entry.transform[1]) || entry.height || 10;
        fragments.push({ str: entry.str, x: entry.transform[4], y: entry.transform[5], width: entry.width ?? 0, size });
      }
      page.cleanup();
      const lines = buildLines(fragments);
      if (!lines.length) emptyPages += 1;
      for (const line of lines) { chars += line.chars; weights.set(roundSize(line.size), (weights.get(roundSize(line.size)) ?? 0) + line.chars); }
      pages.push(lines);
    }
    if (chars < 20) throw new ManuscriptImportError('scanned-pdf');

    // Running headers / footers: the first and last line of a page that repeat
    // (digits aside) on at least half of the pages.
    if (pages.length >= 3) {
      const seen = new Map<string, number>();
      for (const lines of pages) for (const line of new Set([lines[0], lines.at(-1)])) if (line) seen.set(shape(line.text), (seen.get(shape(line.text)) ?? 0) + 1);
      const threshold = Math.max(3, Math.ceil(pages.length / 2));
      for (const lines of pages) {
        for (const edge of [lines[0], lines.at(-1)]) if (edge && (seen.get(shape(edge.text)) ?? 0) >= threshold) lines.splice(lines.indexOf(edge), 1);
      }
    }
    for (const lines of pages) while (lines.length && /^\d{1,4}$/.test(lines[0].text)) lines.shift();
    for (const lines of pages) while (lines.length && /^\d{1,4}$/.test(lines.at(-1)!.text)) lines.pop();

    const body = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
    const isHeading = (line: Line): boolean => line.size >= body * 1.25 && line.size >= body + 2 && line.chars <= 140 && !/^\d+$/.test(line.text);
    const headingSizes = [...new Set(pages.flat().filter(isHeading).map(line => roundSize(line.size)))].sort((a, b) => b - a);
    const levelOf = (line: Line): number => Math.min(3, headingSizes.indexOf(roundSize(line.size)) + 1);

    const blocks: ManuscriptBlock[] = [];
    let open: string[] = [];
    const closeParagraph = (): void => {
      if (!open.length) return;
      let text = '';
      for (const line of open) {
        if (!text) text = line;
        else if (/[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(line)) text = text.slice(0, -1) + line;
        else text = `${text} ${line}`;
      }
      open = [];
      const html = `<p>${escapeHtml(text)}</p>`;
      blocks.push({ level: 0, text, html, words: countWords(text) });
    };
    let pendingHeading = null as { level: number; size: number; text: string; y: number } | null;
    const closeHeading = (): void => {
      if (!pendingHeading) return;
      const { level, text } = pendingHeading;
      pendingHeading = null;
      blocks.push({ level, text, html: `<h${level}>${escapeHtml(text)}</h${level}>`, words: countWords(text) });
    };

    for (const [pageIndex, lines] of pages.entries()) {
      report?.(0.65 + 0.3 * (pageIndex / pages.length));
      const flow = lines.filter(line => !isHeading(line));
      const gaps: number[] = [];
      for (let i = 1; i < flow.length; i += 1) { const gap = flow[i - 1].y - flow[i].y; if (gap > 0 && gap < body * 2.4) gaps.push(gap); }
      const leading = median(gaps) || body * 1.2;
      const left = flow.length ? Math.min(...flow.map(line => line.x)) : 0;
      const right = flow.length ? Math.max(...flow.map(line => line.right)) : 0;
      let previous: Line | undefined;
      for (const [lineIndex, line] of lines.entries()) {
        if (isHeading(line)) {
          closeParagraph();
          const level = levelOf(line);
          if (pendingHeading && pendingHeading.size === roundSize(line.size) && previous && previous.y - line.y <= line.size * 1.8) pendingHeading.text = clean(`${pendingHeading.text} ${line.text}`);
          else { closeHeading(); pendingHeading = { level, size: roundSize(line.size), text: line.text, y: line.y }; }
          previous = line;
          continue;
        }
        closeHeading();
        const gapBreak = !!previous && previous.y - line.y > leading * 1.45;
        const indentBreak = !!previous && line.x - left > body * 0.8 && SENTENCE_END.test(previous.text);
        const shortBreak = !!previous && previous.right < right - body * 3 && SENTENCE_END.test(previous.text);
        const atPageStart = lineIndex === 0 && open.length > 0;
        const continuesFromPreviousPage = atPageStart && /^[a-zà-ÿ]/.test(line.text);
        if (atPageStart && !continuesFromPreviousPage) closeParagraph();
        else if (!atPageStart && (gapBreak || indentBreak || shortBreak)) closeParagraph();
        open.push(line.text);
        previous = line;
      }
      // An open paragraph survives a page break only when it is unfinished.
      if (open.length && SENTENCE_END.test(open.at(-1)!)) closeParagraph();
      closeHeading();
    }
    closeParagraph(); closeHeading();

    const notes: SourceNote[] = [];
    if (emptyPages > 0) notes.push({ code: 'pdf-pages-without-text', count: emptyPages });
    if (pdf.numPages > pageCount) notes.push({ code: 'pdf-pages-capped', count: pdf.numPages - pageCount, detail: String(pageCount) });
    notes.push({ code: 'pdf-layout-guess', count: pdf.numPages });
    report?.(1);
    return { blocks, notes, pages: pdf.numPages };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

const escapeMarkdown = (text: string): string => text.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^([#>+-]|\d+[.)])(\s|$)/, '\\$1$2');

/** The same blocks as Markdown, for the world import (which reads Markdown). */
export function pdfBlocksToMarkdown(blocks: readonly ManuscriptBlock[], title?: string): string {
  const lines = blocks.map(block => (block.level ? `${'#'.repeat(block.level)} ${escapeMarkdown(block.text)}` : escapeMarkdown(block.text)));
  const leading = blocks[0]?.level === 1;
  const front = !leading && title ? `---\ntitle: ${JSON.stringify(title)}\n---\n` : '';
  return `${front}${lines.join('\n\n')}\n`;
}
