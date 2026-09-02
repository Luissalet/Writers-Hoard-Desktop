import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  PAGE_SIZES,
  computePageBreaks,
  roundHalf,
  usablePageHeight,
  type MeasuredBlock,
  type MeasuredLine,
  type PageSizeId,
  type Pagination,
} from './pagination';
import { ensurePageLayoutStyle } from './pageLayoutCss';

/**
 * Page mode: the document set on sheets of A4 or Letter, with real page
 * breaks, in the editor itself.
 *
 * Nothing here is in the document. Every page end is a widget decoration —
 * the foot of one sheet (footnotes, page number), the band of desk between
 * sheets, the head of the next — placed at the first position of the page
 * that follows. So paging never dirties a chapter, never enters the undo
 * history and never reaches the host's `onChange`; and turning it off is
 * dropping the extension.
 *
 * The plugin measures after every change to the document (one measurement
 * per animation frame, however many transactions asked for it) and whenever
 * the sheet is resized — a change of reading face or size reflows the text.
 * It measures every top-level block, and the lines of the few blocks that
 * straddle a page limit, in "unpaginated" coordinates: what the layout would
 * be with the widgets removed, which is what the layout was before any were
 * added. That is what makes the loop settle: the same text measures the
 * same with or without its breaks, so the breaks it asks for are the ones
 * already there, and nothing is dispatched.
 *
 * The geometry that arithmetic depends on is the plugin's own stylesheet
 * (`pageLayoutCss.ts`), injected on mount; the look is `src/index.css`.
 */

export interface PageNote {
  /** Position of the note's reference in the document. */
  pos: number;
  text: string;
}

export interface PageLayoutOptions {
  pageSize: PageSizeId;
  /**
   * The footnotes to print at the foot of each page, in document order.
   * Supplied by the host, which knows the footnote node; the plugin only
   * knows on which page a position falls.
   */
  collectNotes?: (doc: ProseMirrorNode) => PageNote[];
  /** Text of the page number. Default: `x / y`. */
  footerLabel?: (page: number, total: number) => string;
}

/** One rendered page end: the widget's whole content, in numbers. */
export interface PageFoot {
  page: number;
  pos: number;
  fill: number;
  /**
   * How far the widget is pulled up (`margin-top: -pull`) so that the foot
   * starts at the text's own bottom edge: the margin after the block before
   * it, which never shows at the end of a page. Zero for a cut between two
   * lines of one paragraph.
   */
  pull: number;
  notes: string[];
  /** Number of the first note on the page, for `<ol start>`. */
  noteStart: number;
  /** The foot of the last page: fill and number only, no gap, no head. */
  last: boolean;
}

interface PageLayoutMeta {
  feet: PageFoot[];
  totalPages: number;
}

export interface PageLayoutState {
  decorations: DecorationSet;
  totalPages: number;
}

export const pageLayoutKey = new PluginKey<PageLayoutState>('whPageLayout');

/** Pages in the document as last measured; 1 until the first measurement. */
export function getPageCount(editor: Editor): number {
  return pageLayoutKey.getState(editor.state)?.totalPages ?? 1;
}

export const BREAK_CLASS = 'wh-page-break';
const LAST_BREAK_CLASS = 'wh-page-break--last';

/**
 * Passes the plugin allows itself without a change to the document or a
 * resize: the first paint and three remeasurements. One or two are normal
 * (footnote heights and margins between list items are read from the
 * screen after the first paint); more means the layout is disagreeing with
 * itself, and the page is left as it is rather than made to flicker.
 */
const MAX_QUIET_DISPATCHES = 4;

// Footnote estimates, used until a note has been painted once and measured
// (a note's line at the size index.css gives it, plus the item's margin).
const NOTE_LINE_PX = 20;
const NOTE_CHAR_PX = 6;
/** Rule, padding and margin of the `<ol>` around the notes: see pageLayoutCss.ts. */
const NOTES_BLOCK_PX = 19;

function px(value: string): number {
  return parseFloat(value) || 0;
}

function hashText(parts: readonly string[]): string {
  let hash = 5381;
  const text = parts.join('');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function footKey(foot: PageFoot, total: number): string {
  return `${foot.last ? 'pl' : 'pb'}-${foot.page}-${total}-${foot.fill}-${foot.pull}-${foot.noteStart}-${hashText(foot.notes)}`;
}

function sameFoot(a: PageFoot, b: PageFoot): boolean {
  return (
    a.page === b.page &&
    a.pos === b.pos &&
    a.fill === b.fill &&
    a.pull === b.pull &&
    a.last === b.last &&
    a.noteStart === b.noteStart &&
    a.notes.length === b.notes.length &&
    a.notes.every((note, index) => note === b.notes[index])
  );
}

function buildFoot(
  foot: PageFoot,
  total: number,
  footerLabel: PageLayoutOptions['footerLabel'],
): HTMLElement {
  const root = document.createElement('div');
  root.className = foot.last ? `${BREAK_CLASS} ${LAST_BREAK_CLASS}` : BREAK_CLASS;
  root.contentEditable = 'false';
  root.style.setProperty('--fill', `${foot.fill}px`);
  root.style.setProperty('--pull', `${foot.pull}px`);
  root.dataset.page = String(foot.page);

  const footer = document.createElement('div');
  footer.className = 'wh-page-foot';
  if (foot.notes.length > 0) {
    const list = document.createElement('ol');
    list.className = 'wh-page-notes';
    list.start = foot.noteStart;
    for (const note of foot.notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.appendChild(item);
    }
    footer.appendChild(list);
  }
  const number = document.createElement('div');
  number.className = 'wh-page-number';
  number.textContent = footerLabel ? footerLabel(foot.page, total) : `${foot.page} / ${total}`;
  footer.appendChild(number);
  root.appendChild(footer);

  if (!foot.last) {
    const gap = document.createElement('div');
    gap.className = 'wh-page-gap';
    const head = document.createElement('div');
    head.className = 'wh-page-head';
    root.append(gap, head);
  }
  return root;
}

function decorate(doc: ProseMirrorNode, meta: PageLayoutMeta, options: PageLayoutOptions): DecorationSet {
  const size = doc.content.size;
  const decorations = meta.feet
    .filter((foot) => foot.pos > 0 && foot.pos <= size)
    .map((foot) =>
      Decoration.widget(foot.pos, () => buildFoot(foot, meta.totalPages, options.footerLabel), {
        // Before the cursor at its position, so the caret at the start of a
        // page sits on that page and typing there lands after the break.
        // The foot of the last page comes after everything.
        side: foot.last ? 1 : -1,
        key: footKey(foot, meta.totalPages),
        ignoreSelection: true,
        whFoot: foot,
      }),
    );
  return DecorationSet.create(doc, decorations);
}

/** The feet currently rendered, at their mapped positions, in document order. */
function currentFeet(state: EditorState): PageFoot[] {
  const pluginState = pageLayoutKey.getState(state);
  if (!pluginState) return [];
  const feet: PageFoot[] = [];
  for (const decoration of pluginState.decorations.find()) {
    const spec = decoration.spec as { whFoot?: PageFoot };
    if (spec.whFoot) feet.push({ ...spec.whFoot, pos: decoration.from });
  }
  return feet.sort((a, b) => a.pos - b.pos);
}

function planFeet(
  pagination: Pagination,
  notes: PageNote[],
  docSize: number,
  lastPull: number,
): PageFoot[] {
  const feet: PageFoot[] = [];
  const notesIn = (from: number, to: number) =>
    notes.filter((note) => note.pos >= from && note.pos < to).map((note) => note.text);
  let from = 0;
  let noteStart = 1;
  for (const cut of pagination.breaks) {
    const texts = notesIn(from, cut.pos);
    feet.push({
      page: cut.page,
      pos: cut.pos,
      fill: cut.fillHeight,
      pull: cut.pull,
      notes: texts,
      noteStart,
      last: false,
    });
    noteStart += texts.length;
    from = cut.pos;
  }
  feet.push({
    page: pagination.totalPages,
    pos: docSize,
    fill: pagination.lastFill,
    pull: lastPull,
    notes: notesIn(from, Infinity),
    noteStart,
    last: true,
  });
  return feet;
}

/* ── Measuring ─────────────────────────────────────────────────────────── */

interface PlacedWidget {
  pos: number;
  height: number;
  last: boolean;
  element: HTMLElement;
}

/** Content box of the textblock a fragment sits in, unpaginated. */
interface TextBlockBox {
  innerTop: number;
  innerBottom: number;
  /**
   * Distance from the content top to the top of the first glyph rectangle.
   * The browser hands out glyph rectangles, not line boxes, and a glyph
   * rectangle is not centred in its line (with Georgia at 17px/1.7 it sits
   * 4px below the box's top and 6px above its bottom). But the offset is the
   * same on every line of a block, so `glyph top - above` is the line box top.
   */
  above: number | null;
}

/** A rectangle of one text node or one leaf element, one per line it spans. */
interface Fragment {
  node: Node;
  /** Index among the node's client rects: 0 starts at the node's start. */
  rectIndex: number;
  /** On screen, for the search of the line's first character. */
  screenTop: number;
  /** Unpaginated. */
  top: number;
  bottom: number;
  box: TextBlockBox;
}

function acceptForLines(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue?.length ?? 0) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  }
  const element = node as Element;
  // Widgets (ours included) and ProseMirror's own layout helpers are not
  // text; a leaf element with no text — an image, a footnote reference
  // drawn by a CSS counter — is, for the purpose of where a line starts.
  if (
    element.classList.contains('ProseMirror-widget') ||
    element.classList.contains('ProseMirror-separator') ||
    element.classList.contains('ProseMirror-trailingBreak')
  ) {
    return NodeFilter.FILTER_REJECT;
  }
  return element.childNodes.length === 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
}

function isInline(element: Element): boolean {
  const display = getComputedStyle(element).display;
  return display === 'inline' || display.startsWith('inline-') || display === 'contents';
}

function domIndex(node: Node): number {
  let index = 0;
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) index += 1;
  return index;
}

function posAtDOM(view: EditorView, node: Node, offset: number): number | null {
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

/**
 * Document position where a fragment starts. For the second and later
 * rectangles of a text node that is the first character the browser wrapped
 * onto that line, found by bisection on single-character ranges: their tops
 * are non-decreasing along the node, since one text node is one style.
 */
function fragmentPos(view: EditorView, fragment: Fragment, range: Range): number | null {
  const { node } = fragment;
  if (node.nodeType !== Node.TEXT_NODE) {
    return node.parentNode ? posAtDOM(view, node.parentNode, domIndex(node)) : null;
  }
  if (fragment.rectIndex === 0) return posAtDOM(view, node, 0);
  const text = node as Text;
  const length = text.length;
  let low = 1;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    range.setStart(text, middle);
    range.setEnd(text, middle + 1);
    const rect = range.getBoundingClientRect();
    if (rect.height >= 1 && rect.top >= fragment.screenTop - 0.5) high = middle;
    else low = middle + 1;
  }
  return low < length ? posAtDOM(view, text, low) : null;
}

/**
 * A line that starts at the very start of its paragraph starts, as far as a
 * page break is concerned, before the paragraph — and before the list item
 * around it, if it opens that too. The break then lands between blocks,
 * where a bullet or a heading keeps its first line, instead of inside a
 * block ahead of its first character.
 */
function liftToBoundary(doc: ProseMirrorNode, pos: number): number {
  let $pos = doc.resolve(pos);
  while ($pos.depth > 1 && $pos.parentOffset === 0) $pos = doc.resolve($pos.before());
  return $pos.pos;
}

interface LineMeasurer {
  /** Widgets drawn above a node, in document order. */
  shiftBefore: (node: Node) => number;
  /** Widgets drawn above the END of an element: those before it and those inside it. */
  shiftBeforeEnd: (element: Element) => number;
  contentTop: number;
}

/**
 * The lines of a top-level block as LINE BOXES, unpaginated: each line's top
 * is its glyph rectangle's top less the block's `above`, the last line of a
 * textblock ends at the textblock's content bottom, and a line before
 * another textblock (the next item of a list) ends at its own textblock's
 * content bottom, never in the margin between the two. A cut at a box
 * boundary is exactly where a widget placed between the two lines lands.
 */
function collectLines(
  view: EditorView,
  container: HTMLElement,
  containerBox: TextBlockBox,
  measurer: LineMeasurer,
): MeasuredLine[] {
  const { contentTop, shiftBefore, shiftBeforeEnd } = measurer;
  const boxes = new Map<Element, TextBlockBox>([[container, containerBox]]);
  const boxOf = (node: Node): TextBlockBox => {
    let element = node.parentElement;
    while (element && element !== container && isInline(element)) element = element.parentElement;
    if (!element) return containerBox;
    const known = boxes.get(element);
    if (known) return known;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const box: TextBlockBox = {
      innerTop: rect.top + px(style.borderTopWidth) + px(style.paddingTop) - contentTop - shiftBefore(element),
      innerBottom:
        rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom) - contentTop - shiftBeforeEnd(element),
      above: null,
    };
    boxes.set(element, box);
    return box;
  };

  const fragments: Fragment[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: acceptForLines,
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const shift = shiftBefore(node);
    const box = boxOf(node);
    let rects: DOMRectList;
    if (node.nodeType === Node.TEXT_NODE) {
      range.selectNodeContents(node);
      rects = range.getClientRects();
    } else {
      rects = (node as Element).getClientRects();
    }
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (rect.height < 1) continue;
      const top = rect.top - shift;
      if (box.above === null && node.nodeType === Node.TEXT_NODE) box.above = top - box.innerTop;
      fragments.push({ node, rectIndex: index, screenTop: rect.top, top, bottom: rect.bottom - shift, box });
    }
  }

  // Fragments come in document order. One that starts above the bottom of
  // the line being built is on that line (a superscript, a smaller code
  // span); one that starts at or below it opens the next.
  const lines: { first: Fragment; top: number; bottom: number }[] = [];
  for (const fragment of fragments) {
    const line = lines[lines.length - 1];
    if (line && fragment.top < line.bottom - 1) {
      line.top = Math.min(line.top, fragment.top);
      line.bottom = Math.max(line.bottom, fragment.bottom);
    } else {
      lines.push({ first: fragment, top: fragment.top, bottom: fragment.bottom });
    }
  }

  const boxTop = (line: { first: Fragment }): number =>
    Math.max(line.first.box.innerTop, line.first.top - (line.first.box.above ?? 0));
  const measured: MeasuredLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pos = fragmentPos(view, line.first, range);
    if (pos === null) continue;
    const following = lines[index + 1];
    const top = boxTop(line);
    const bottom =
      following && following.first.box === line.first.box
        ? Math.min(boxTop(following), line.first.box.innerBottom)
        : line.first.box.innerBottom;
    measured.push({ pos: liftToBoundary(view.state.doc, pos), top, bottom });
  }
  return measured;
}

function estimateNoteHeight(text: string, charsPerLine: number): number {
  return Math.ceil(Math.max(1, text.length) / charsPerLine) * NOTE_LINE_PX;
}

class PageLayoutView {
  private readonly view: EditorView;
  private readonly options: PageLayoutOptions;
  private frame: number | null = null;
  private readonly observer: ResizeObserver | null;
  private quietDispatches = 0;
  /** Sheet height right after our own dispatch, to tell our resize from a real one. */
  private expectedHeight: number | null = null;
  /** Height of each note as painted, by its text. Better than any estimate. */
  private readonly noteHeights = new Map<string, number>();

  constructor(view: EditorView, options: PageLayoutOptions) {
    this.view = view;
    this.options = options;
    const sheet = view.dom;
    const size = PAGE_SIZES[options.pageSize];
    ensurePageLayoutStyle(sheet.ownerDocument);
    sheet.dataset.pageSize = options.pageSize;
    sheet.style.setProperty('--wh-page-width', `${size.widthPx}px`);
    sheet.style.setProperty('--wh-page-height', `${size.heightPx}px`);
    sheet.style.setProperty('--wh-page-margin', `${size.marginPx}px`);

    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            // Our own dispatch changes the sheet's height too. Only a change
            // we did not make — the writer's typing, a new reading size, the
            // editor becoming visible — earns a fresh allowance of passes.
            const height = this.view.dom.getBoundingClientRect().height;
            if (this.expectedHeight === null || Math.abs(height - this.expectedHeight) > 0.5) {
              this.quietDispatches = 0;
            }
            this.expectedHeight = null;
            this.schedule();
          });
    this.observer?.observe(sheet);
    this.schedule();
  }

  update(view: EditorView, previous: EditorState): void {
    if (view.state.doc === previous.doc) return;
    this.quietDispatches = 0;
    this.expectedHeight = null;
    this.schedule();
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.observer?.disconnect();
    const sheet = this.view.dom;
    delete sheet.dataset.pageSize;
    sheet.style.removeProperty('--wh-page-width');
    sheet.style.removeProperty('--wh-page-height');
    sheet.style.removeProperty('--wh-page-margin');
  }

  /** One measurement per frame, whatever asked for it. */
  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.measure();
    });
  }

  private measure(): void {
    const { view, options } = this;
    if (view.isDestroyed) return;
    const sheet = view.dom;
    const sheetRect = sheet.getBoundingClientRect();
    // Not laid out (detached, hidden): the observer calls back when it is.
    if (sheetRect.width === 0 || sheetRect.height === 0) return;

    const state = view.state;
    const doc = state.doc;
    const size = PAGE_SIZES[options.pageSize];
    const sheetStyle = getComputedStyle(sheet);
    const contentTop = sheetRect.top + px(sheetStyle.borderTopWidth) + px(sheetStyle.paddingTop);
    const contentLeft = sheetRect.left + px(sheetStyle.borderLeftWidth) + px(sheetStyle.paddingLeft);

    // The widgets on screen, paired with their decorations: both are in
    // document order. A count that disagrees is a render still pending.
    const current = currentFeet(state);
    const elements = Array.from(sheet.querySelectorAll<HTMLElement>(`.${BREAK_CLASS}`));
    if (elements.length !== current.length) return;
    // A widget displaces what follows by its box less the margin it is
    // pulled up over.
    const widgets: PlacedWidget[] = current.map((foot, index) => ({
      pos: foot.pos,
      last: foot.last,
      height: elements[index].getBoundingClientRect().height + px(getComputedStyle(elements[index]).marginTop),
      element: elements[index],
    }));
    const middle = widgets.filter((widget) => !widget.last);
    // Unpaginated y = on-screen y minus every break drawn above the point.
    const shiftAt = (pos: number, inclusive: boolean): number => {
      let shift = 0;
      for (const widget of middle) {
        if (widget.pos < pos || (inclusive && widget.pos === pos)) shift += widget.height;
      }
      return shift;
    };
    const shiftBefore = (node: Node): number => {
      let shift = 0;
      for (const widget of middle) {
        if (widget.element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
          shift += widget.height;
        }
      }
      return shift;
    };
    const shiftBeforeEnd = (element: Element): number => {
      let shift = 0;
      for (const widget of middle) {
        const relation = widget.element.compareDocumentPosition(element);
        if (relation & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINS)) {
          shift += widget.height;
        }
      }
      return shift;
    };
    const measurer: LineMeasurer = { shiftBefore, shiftBeforeEnd, contentTop };

    // The margin a widget between two nested blocks (two list items) is
    // drawn over is a margin collapsed through the item, which no computed
    // style names: read it off the rendered widget instead — the space left
    // between the block before it and its own top, plus what it is already
    // pulled up by. Absent the first time (nothing rendered yet), which is
    // one pass of a few pixels' slack, then exact.
    const observedMargin = new Map<number, number>();
    for (const widget of middle) {
      const previous = widget.element.previousElementSibling;
      if (!previous || previous !== widget.element.previousSibling) continue;
      const gap = widget.element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
      observedMargin.set(widget.pos, Math.max(0, gap - px(getComputedStyle(widget.element).marginTop)));
    }

    for (const widget of widgets) {
      for (const item of widget.element.querySelectorAll<HTMLElement>('.wh-page-notes li')) {
        const itemStyle = getComputedStyle(item);
        this.noteHeights.set(
          item.textContent ?? '',
          item.getBoundingClientRect().height + px(itemStyle.marginTop) + px(itemStyle.marginBottom),
        );
      }
    }

    const blocks: MeasuredBlock[] = [];
    const blockDom = new Map<MeasuredBlock, { element: HTMLElement; innerTop: number; innerBottom: number }>();
    // Bottom margin of the block ending at each position, for `PageFoot.pull`.
    const marginBelow = new Map<number, number>();
    doc.forEach((node, offset) => {
      const dom = view.nodeDOM(offset);
      if (!dom || dom.nodeType !== Node.ELEMENT_NODE) return;
      const element = dom as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const shiftTop = shiftAt(offset, true);
      const shiftBottom = shiftAt(offset + node.nodeSize, false);
      // Not rounded: the sub-pixel layout is what it is, and a page's
      // height is the sum of many of these. Only the fill, which becomes a
      // CSS length and a widget key, is snapped (in pagination.ts).
      const block: MeasuredBlock = {
        pos: offset,
        top: rect.top - px(style.marginTop) - contentTop - shiftTop,
        bottom: rect.bottom - contentTop - shiftBottom,
        // A chapter heading asks for a fresh sheet the way it would in print.
        breakBefore: style.breakBefore === 'page' || style.breakBefore === 'always',
      };
      blocks.push(block);
      blockDom.set(block, {
        element,
        innerTop: rect.top + px(style.borderTopWidth) + px(style.paddingTop) - contentTop - shiftTop,
        innerBottom: rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom) - contentTop - shiftBottom,
      });
      marginBelow.set(offset + node.nodeSize, px(style.marginBottom));
    });

    const notes = (options.collectNotes?.(doc) ?? []).slice().sort((a, b) => a.pos - b.pos);
    const charsPerLine = Math.max(20, Math.floor((size.widthPx - 2 * size.marginPx) / NOTE_CHAR_PX));
    const noteHeight = (text: string) => this.noteHeights.get(text) ?? estimateNoteHeight(text, charsPerLine);
    const reserved = (_page: number, from: number, to: number): number => {
      let total = 0;
      let any = false;
      for (const note of notes) {
        if (note.pos >= from && note.pos < to) {
          total += noteHeight(note.text);
          any = true;
        }
      }
      return any ? total + NOTES_BLOCK_PX : 0;
    };
    const measureLines = (block: MeasuredBlock): MeasuredLine[] | undefined => {
      const entry = blockDom.get(block);
      if (!entry) return undefined;
      const box: TextBlockBox = { innerTop: entry.innerTop, innerBottom: entry.innerBottom, above: null };
      return collectLines(view, entry.element, box, measurer);
    };

    const marginBefore = (pos: number): number => marginBelow.get(pos) ?? observedMargin.get(pos) ?? 0;

    const pagination = computePageBreaks(blocks, {
      pageHeight: usablePageHeight(size),
      reserved,
      measureLines,
      marginBefore,
    });
    const feet = planFeet(pagination, notes, doc.content.size, marginBefore(doc.content.size));

    // Reads are over: a break inside a list sits in an indented box, and
    // its band must still start at the sheet's edge.
    for (const widget of widgets) {
      const parent = widget.element.parentElement;
      if (!parent) continue;
      let containerLeft = contentLeft;
      if (parent !== sheet) {
        const parentStyle = getComputedStyle(parent);
        containerLeft =
          parent.getBoundingClientRect().left + px(parentStyle.borderLeftWidth) + px(parentStyle.paddingLeft);
      }
      const indent = Math.max(0, roundHalf(containerLeft - contentLeft));
      if (Math.abs(indent - px(widget.element.style.getPropertyValue('--wh-indent'))) > 0.5) {
        widget.element.style.setProperty('--wh-indent', `${indent}px`);
      }
    }

    const currentTotal = pageLayoutKey.getState(state)?.totalPages ?? 1;
    const unchanged =
      feet.length === current.length &&
      pagination.totalPages === currentTotal &&
      feet.every((foot, index) => sameFoot(foot, current[index]));
    if (unchanged) return;
    if (this.quietDispatches >= MAX_QUIET_DISPATCHES) return;
    this.quietDispatches += 1;
    const meta: PageLayoutMeta = { feet, totalPages: pagination.totalPages };
    view.dispatch(view.state.tr.setMeta(pageLayoutKey, meta));
    this.expectedHeight = sheet.getBoundingClientRect().height;
  }
}

export function createPageLayoutPlugin(options: PageLayoutOptions): Plugin<PageLayoutState> {
  return new Plugin<PageLayoutState>({
    key: pageLayoutKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, totalPages: 1 }),
      apply(tr, value) {
        const meta = tr.getMeta(pageLayoutKey) as PageLayoutMeta | undefined;
        if (meta) return { decorations: decorate(tr.doc, meta, options), totalPages: meta.totalPages };
        // Between an edit and the measurement that follows it, the breaks
        // stay on the text they were drawn over.
        if (tr.docChanged) return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
        return value;
      },
    },
    props: {
      decorations: (state) => pageLayoutKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
    view: (view) => new PageLayoutView(view, options),
  });
}

export const PageLayout = Extension.create<PageLayoutOptions>({
  name: 'pageLayout',

  addOptions() {
    return {
      pageSize: 'a4',
      collectNotes: undefined,
      footerLabel: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [createPageLayoutPlugin(this.options)];
  },
});
