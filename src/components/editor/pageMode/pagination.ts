/**
 * Page breaks from measured block heights. Pure: no DOM, no ProseMirror.
 *
 * The extension (`PageLayout.ts`) measures every top-level block of the
 * document and hands the numbers here; this module decides where each page
 * ends. Keeping the arithmetic apart from the measuring means it can be
 * tested with plain numbers, and that the extension has exactly one job —
 * turning DOM rectangles into `MeasuredBlock`s and page breaks into widgets.
 *
 * Coordinates are "unpaginated": the y of each block as if no page-break
 * widget existed, relative to the top of the first page's content area. A
 * block's `top` is the top of its MARGIN box and its `bottom` the bottom of
 * its BORDER box: a block's top margin travels with it to the top of a new
 * page, but a bottom margin never decides whether a line fits — the widget
 * that ends a page is drawn from the text's own bottom edge, over the
 * margin (see `PageFoot.pull` in `PageLayout.ts`). In the flex column the
 * sheet is laid out as, margin boxes tile with no collapsing, so `top` is
 * also exactly where the previous block's margin box ended.
 */

export type PageSizeId = 'a4' | 'letter';

export interface PageSize {
  /** At 96 dpi, the CSS pixel. */
  widthPx: number;
  heightPx: number;
  marginPx: number;
  /** The same sheet in millimetres, for documentation and export. */
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

/** A4 210×297 mm and US Letter 8.5×11 in, both with a 1 in (2.54 cm) margin. */
export const PAGE_SIZES: Record<PageSizeId, PageSize> = {
  a4: { widthPx: 794, heightPx: 1123, marginPx: 96, widthMm: 210, heightMm: 297, marginMm: 25.4 },
  letter: { widthPx: 816, heightPx: 1056, marginPx: 96, widthMm: 215.9, heightMm: 279.4, marginMm: 25.4 },
};

/** Height of the area the prose can occupy: the sheet minus both margins. */
export function usablePageHeight(size: PageSize): number {
  return size.heightPx - 2 * size.marginPx;
}

export interface MeasuredLine {
  /** Document position of the first character on the line. */
  pos: number;
  top: number;
  bottom: number;
}

export interface MeasuredBlock {
  /** Position of this top-level child of the document. */
  pos: number;
  /** Top of the margin box, unpaginated, relative to the first page's content top. */
  top: number;
  /** Bottom of the border box, same frame. */
  bottom: number;
  /**
   * Lines inside the block, so a paragraph can be cut between two of them.
   * Optional: a block that does not cross a page limit never needs them,
   * and `PaginationOptions.measureLines` can supply them on demand.
   */
  lines?: MeasuredLine[];
  /** The block opens a new page (CSS `break-before: page`), unless it already tops one. */
  breakBefore?: boolean;
}

export interface PageBreak {
  /** Where the widget goes: the first position on the page that follows. */
  pos: number;
  /**
   * Height to fill from the widget's top to the bottom of the usable area.
   * The widget's top is the bottom edge of the text before it: the bottom
   * of the last line that stays, or of the previous block.
   */
  fillHeight: number;
  /**
   * How far above its natural place the widget must be drawn to put its
   * top at that edge: the margin (and any space a container keeps inside
   * its box after its last line) between the text and what follows. The
   * next page's content starts `pull` below the widget's top.
   */
  pull: number;
  /** The page that ENDS here, 1-based. */
  page: number;
}

export interface PaginationOptions {
  /** Usable height of a page: sheet height minus both margins. */
  pageHeight: number;
  /**
   * Height reserved at the foot of a page for the footnotes whose references
   * fall in [fromPos, toPos). `pageIndex` is 0-based; `toPos` is `Infinity`
   * for the last page.
   */
  reserved: (pageIndex: number, fromPos: number, toPos: number) => number;
  /**
   * Lines of a block that turns out to cross a page limit and carries no
   * `lines` of its own. Called at most once per block per run.
   */
  measureLines?: (block: MeasuredBlock) => MeasuredLine[] | undefined;
  /**
   * Vertical margin that sits between the text before a cut at `pos` and
   * whatever follows it — the bottom margin of the block ending there. The
   * widget is drawn over it, so the next page's content starts that far
   * below the text's bottom edge. Zero (the default) between two lines of
   * one paragraph.
   */
  marginBefore?: (pos: number) => number;
}

export interface Pagination {
  breaks: PageBreak[];
  totalPages: number;
  /** Fill from the bottom of the last block to the end of the last page. */
  lastFill: number;
}

/** Measurements are rounded to half a pixel; anything closer than that is equal. */
const EPS = 0.25;

/** Position in the flat sequence of units (whole blocks or lines) a page starts at. */
interface Cursor {
  block: number;
  /** Meaningful only when the block is cut by lines: the first line on the page. */
  line: number;
}

interface Cut {
  pos: number;
  /** Unpaginated bottom edge of the text before the cut: where the widget's top is. */
  at: number;
  /**
   * Border-box bottom of the block the cut follows, or `at` for a cut
   * between two lines. The next page starts there plus `marginBefore(pos)`.
   */
  base: number;
  next: Cursor;
}

export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function computePageBreaks(blocks: MeasuredBlock[], opts: PaginationOptions): Pagination {
  const { pageHeight, reserved } = opts;
  const marginBefore = opts.marginBefore ?? (() => 0);
  const breaks: PageBreak[] = [];
  const lineCache = new Map<number, MeasuredLine[] | null>();

  const linesOf = (index: number): MeasuredLine[] | null => {
    const cached = lineCache.get(index);
    if (cached !== undefined) return cached;
    const block = blocks[index];
    const raw = block.lines ?? opts.measureLines?.(block);
    // Sorted by top, with strictly increasing positions: a stray fragment
    // reported out of order must not turn into a cut that walks backwards.
    let lines: MeasuredLine[] | null = null;
    if (raw && raw.length > 0) {
      const sorted = [...raw].sort((a, b) => a.top - b.top);
      lines = [];
      for (const line of sorted) {
        const previous = lines[lines.length - 1];
        if (previous && line.pos <= previous.pos) continue;
        lines.push(line);
      }
    }
    lineCache.set(index, lines);
    return lines;
  };

  let page = 1;
  let pageStart = 0;
  let fromPos = 0;
  let cursor: Cursor = { block: 0, line: 0 };

  /**
   * Where the text of a block ends: its last line's bottom when its lines
   * are known (a list keeps its last item's margin inside its own box), else
   * its border-box bottom.
   */
  const textBottom = (index: number): number => {
    const lines = lineCache.get(index);
    return lines && lines.length > 0 ? lines[lines.length - 1].bottom : blocks[index].bottom;
  };
  /** The page's cut after the block at `index`, or null when nothing follows. */
  const cutAfterBlock = (index: number): Cut | null => {
    const next = blocks[index + 1];
    if (!next) return null;
    return { pos: next.pos, at: textBottom(index), base: blocks[index].bottom, next: { block: index + 1, line: 0 } };
  };
  /** The cut before the block at `index` (never the first block: see the loop). */
  const cutBeforeBlock = (index: number): Cut => ({
    pos: blocks[index].pos,
    at: textBottom(index - 1),
    base: blocks[index - 1].bottom,
    next: { block: index, line: 0 },
  });

  /**
   * Walk the units from the page's cursor and return the first cut that keeps
   * everything before it above `pageStart + pageHeight - reserve`. Null when
   * the rest of the document fits on this page.
   */
  const findCut = (reserve: number): Cut | null => {
    const limit = pageStart + pageHeight - reserve;
    // Whether the unit being looked at is the first one on the page: a first
    // unit that does not fit is taller than the page, and cutting before it
    // would produce an empty page and then the same decision again, forever.
    // It is left to overflow, and the page ends after it.
    let first = true;
    for (let index = cursor.block; index < blocks.length; index += 1) {
      const block = blocks[index];
      const startLine = index === cursor.block ? cursor.line : 0;
      if (block.breakBefore && !first) return cutBeforeBlock(index);
      if (startLine === 0 && block.bottom <= limit + EPS) {
        first = false;
        continue;
      }
      const lines = linesOf(index);
      if (lines === null) {
        // Atomic: an image, a rule, an empty paragraph.
        if (first) return cutAfterBlock(index);
        return cutBeforeBlock(index);
      }
      let crossing = -1;
      for (let line = startLine; line < lines.length; line += 1) {
        if (lines[line].bottom > limit + EPS) {
          crossing = line;
          break;
        }
      }
      if (crossing === -1) {
        // Every line fits and only the block's own padding crossed the
        // limit: nothing a page can carry over.
        first = false;
        continue;
      }
      if (first && crossing === startLine) {
        // A line taller than the page. Overflow, and cut before what follows.
        const following = lines[crossing + 1];
        if (following) {
          const at = lines[crossing].bottom;
          return { pos: following.pos, at, base: at, next: { block: index, line: crossing + 1 } };
        }
        return cutAfterBlock(index);
      }
      if (crossing === 0) {
        // The first line goes: so does the block, with its top margin.
        return cutBeforeBlock(index);
      }
      const at = lines[crossing - 1].bottom;
      return { pos: lines[crossing].pos, at, base: at, next: { block: index, line: crossing } };
    }
    return null;
  };

  /**
   * The notes on a page take space at its foot, which moves the cut earlier,
   * which may send a note to the next page, which frees the space again.
   * Rather than chase that loop, reserve for the notes of the widest range
   * the page could hold — always enough — then try once to tighten.
   */
  const settle = (): Cut | null => {
    const endOf = (cut: Cut | null) => (cut ? cut.pos : Infinity);
    let cut = findCut(0);
    const widestNeed = reserved(page - 1, fromPos, endOf(cut));
    if (widestNeed <= EPS) return cut;
    cut = findCut(widestNeed);
    const need = reserved(page - 1, fromPos, endOf(cut));
    if (need < widestNeed - EPS) {
      const tighter = findCut(need);
      if (reserved(page - 1, fromPos, endOf(tighter)) <= need + EPS) return tighter;
    }
    return cut;
  };

  let lastPos = 0;
  while (blocks.length > 0) {
    const cut = settle();
    if (cut === null) break;
    // A cut never sits at the start of the document and never repeats a
    // position: either would be an empty page, and a measurement that asks
    // for one is wrong in a way this loop must not amplify.
    if (cut.pos <= lastPos) break;
    const nextStart = cut.base + marginBefore(cut.pos);
    breaks.push({
      pos: cut.pos,
      fillHeight: roundHalf(Math.max(0, pageStart + pageHeight - cut.at)),
      pull: roundHalf(Math.max(0, nextStart - cut.at)),
      page,
    });
    page += 1;
    pageStart = nextStart;
    fromPos = cut.pos;
    cursor = cut.next;
    lastPos = cut.pos;
  }

  const last = blocks[blocks.length - 1];
  const lastFill = last ? roundHalf(Math.max(0, pageStart + pageHeight - last.bottom)) : pageHeight;
  return { breaks, totalPages: page, lastFill };
}
