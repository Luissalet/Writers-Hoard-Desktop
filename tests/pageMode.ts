import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import {
  PAGE_SIZES,
  computePageBreaks,
  usablePageHeight,
  type MeasuredBlock,
  type PaginationOptions,
} from '@/components/editor/pageMode/pagination';
import {
  BREAK_CLASS,
  PageLayout,
  getPageCount,
  pageLayoutKey,
  type PageNote,
} from '@/components/editor/pageMode/PageLayout';

/**
 * Page mode: the pure arithmetic first, then a real editor on a real sheet.
 *
 * The browser test needs no stylesheet of the app's: the extension injects
 * the geometry it depends on (`pageLayoutCss.ts`), and colours do not move
 * a page break. What does move one is the prose's own metrics — size,
 * leading, the space between paragraphs — so the test sets them as
 * `.tiptap-editor .ProseMirror` in index.css does (the same numbers, copied),
 * and asks that every page still come out exactly one sheet tall.
 */

const PROSE_STYLE_ID = 'wh-page-mode-test-prose';
const PROSE_CSS = `
.tiptap-editor .ProseMirror { font-family: Georgia, serif; font-size: 1.0625rem; line-height: 1.7; }
.tiptap-editor .ProseMirror p { margin: 0.5em 0; }
.tiptap-editor .ProseMirror h1, .tiptap-editor .ProseMirror h2, .tiptap-editor .ProseMirror h3 {
  font-weight: 600; line-height: 1.3; margin: 1.2em 0 0.5em;
}
.tiptap-editor .ProseMirror h2 { font-size: 1.28em; }
.tiptap-editor .ProseMirror ul { padding-left: 1.5rem; margin: 0; }
.tiptap-editor .wh-page-break { font-size: 12.5px; line-height: 1.45; }
.tiptap-editor[data-reading-size='large'] .ProseMirror { font-size: 1.25rem; }
.tiptap-editor[data-editor-layout='page'] .ProseMirror h2 { break-before: page; }
`;

function ensureProseStyle(): void {
  if (document.getElementById(PROSE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PROSE_STYLE_ID;
  style.textContent = PROSE_CSS;
  document.head.appendChild(style);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function near(actual: number, expected: number, tolerance: number, what: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} ±${tolerance}, received ${actual}`,
  );
}

const NO_NOTES: PaginationOptions['reserved'] = () => 0;

/* ── Pure ──────────────────────────────────────────────────────────────── */

export function testPaginationPureFitsExactly(): void {
  const blocks: MeasuredBlock[] = [
    { pos: 0, top: 0, bottom: 50 },
    { pos: 10, top: 50, bottom: 100 },
  ];
  const result = computePageBreaks(blocks, { pageHeight: 100, reserved: NO_NOTES });
  assert(result.breaks.length === 0, 'two paragraphs filling the page exactly must not be cut');
  assert(result.totalPages === 1, `expected 1 page, received ${result.totalPages}`);
  assert(result.lastFill === 0, `a full page has no fill, received ${result.lastFill}`);

  const third = computePageBreaks(
    [...blocks, { pos: 20, top: 100, bottom: 150 }],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(third.breaks.length === 1 && third.breaks[0].pos === 20, 'the block after a full page opens page 2');
  assert(third.breaks[0].fillHeight === 0 && third.breaks[0].page === 1, 'a cut at the exact limit fills nothing');
  assert(third.totalPages === 2 && third.lastFill === 50, `page 2 holds 50px, received fill ${third.lastFill}`);
}

export function testPaginationPureCutsBetweenLines(): void {
  const blocks: MeasuredBlock[] = [
    { pos: 0, top: 0, bottom: 60 },
    {
      pos: 10,
      top: 60,
      bottom: 160,
      lines: [
        { pos: 11, top: 60, bottom: 85 },
        { pos: 40, top: 85, bottom: 110 },
        { pos: 70, top: 110, bottom: 135 },
        { pos: 100, top: 135, bottom: 160 },
      ],
    },
  ];
  const result = computePageBreaks(blocks, { pageHeight: 100, reserved: NO_NOTES });
  assert(result.breaks.length === 1, `expected one cut, received ${result.breaks.length}`);
  const [cut] = result.breaks;
  assert(cut.pos === 40, `the cut goes before the first line that crosses (pos 40), received ${cut.pos}`);
  assert(cut.fillHeight === 15, `fill runs from the line's top to the page end (15), received ${cut.fillHeight}`);
  assert(cut.pull === 0, 'no margin between two lines of one paragraph');
  assert(result.totalPages === 2 && result.lastFill === 25, `page 2 fill 25, received ${result.lastFill}`);

  // Lines are asked for lazily, and only for the block that crosses.
  let asked = 0;
  const lazy = computePageBreaks(
    blocks.map((block) => ({ pos: block.pos, top: block.top, bottom: block.bottom })),
    {
      pageHeight: 100,
      reserved: NO_NOTES,
      measureLines: (block) => {
        asked += 1;
        return blocks.find((candidate) => candidate.pos === block.pos)?.lines;
      },
    },
  );
  assert(asked === 1, `lines measured for one block, received ${asked}`);
  assert(lazy.breaks[0].pos === 40 && lazy.breaks[0].fillHeight === 15, 'lazy lines give the same cut');

  // A cut on a block's first line is a cut before the block, at the block's
  // own (margin-box) top.
  const firstLine = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 90 },
      { pos: 10, top: 90, bottom: 150, lines: [{ pos: 11, top: 95, bottom: 120 }, { pos: 30, top: 120, bottom: 145 }] },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(firstLine.breaks[0].pos === 10, `cut before the block (pos 10), received ${firstLine.breaks[0].pos}`);
  assert(firstLine.breaks[0].fillHeight === 10, `fill from the block's top (10), received ${firstLine.breaks[0].fillHeight}`);
}

export function testPaginationPureOversizedBlockOverflows(): void {
  const result = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 30 },
      { pos: 10, top: 30, bottom: 330 },
      { pos: 20, top: 330, bottom: 360 },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(result.breaks.length === 2, `expected two cuts, received ${result.breaks.length}`);
  assert(result.breaks[0].pos === 10 && result.breaks[0].fillHeight === 70, 'the giant block is moved to its own page');
  assert(result.breaks[1].pos === 20 && result.breaks[1].fillHeight === 0, 'the page after the giant block starts right after it');
  assert(result.totalPages === 3, `expected 3 pages, received ${result.totalPages}`);

  // A giant line inside a paragraph: overflow it, cut before the next line.
  const line = computePageBreaks(
    [
      {
        pos: 0,
        top: 0,
        bottom: 300,
        lines: [
          { pos: 1, top: 0, bottom: 250 },
          { pos: 50, top: 250, bottom: 275 },
          { pos: 60, top: 275, bottom: 300 },
        ],
      },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(line.breaks.length === 1 && line.breaks[0].pos === 50, `cut after the giant line (pos 50), received ${JSON.stringify(line.breaks)}`);
  assert(line.breaks[0].fillHeight === 0, 'nothing to fill after an overflow');
  assert(line.totalPages === 2, `expected 2 pages, received ${line.totalPages}`);

  // Alone and taller than a page: one page, no cut at position 0, ever.
  const alone = computePageBreaks([{ pos: 0, top: 0, bottom: 150 }], { pageHeight: 100, reserved: NO_NOTES });
  assert(alone.breaks.length === 0 && alone.totalPages === 1 && alone.lastFill === 0, 'a lone giant block is one page');
}

export function testPaginationPureNotesPushALine(): void {
  const blocks: MeasuredBlock[] = [
    { pos: 0, top: 0, bottom: 40 },
    {
      pos: 10,
      top: 40,
      bottom: 100,
      lines: [
        { pos: 11, top: 40, bottom: 60 },
        { pos: 30, top: 60, bottom: 80 },
        { pos: 50, top: 80, bottom: 100 },
      ],
    },
  ];
  const noteAt = (pos: number, height: number): PaginationOptions['reserved'] =>
    (_page, from, to) => (pos >= from && pos < to ? height : 0);

  const plain = computePageBreaks(blocks, { pageHeight: 100, reserved: NO_NOTES });
  assert(plain.breaks.length === 0, 'without notes everything fits on the page');

  const pushed = computePageBreaks(blocks, { pageHeight: 100, reserved: noteAt(5, 15) });
  assert(pushed.breaks.length === 1 && pushed.breaks[0].pos === 50, `a note on the page pushes the last line off it, received ${JSON.stringify(pushed.breaks)}`);
  assert(pushed.breaks[0].fillHeight === 20, `the fill (20) covers the note (15), received ${pushed.breaks[0].fillHeight}`);

  // The note's reference is on the very line that gets pushed: the space is
  // still reserved (page 1 shows a little air) and the run terminates with
  // the note on page 2, instead of oscillating between the two answers.
  let calls = 0;
  const onTheLine = computePageBreaks(blocks, {
    pageHeight: 100,
    reserved: (page, from, to) => {
      calls += 1;
      return noteAt(55, 15)(page, from, to);
    },
  });
  assert(onTheLine.breaks.length === 1 && onTheLine.breaks[0].pos === 50, 'a note on the pushed line still cuts once');
  assert(onTheLine.totalPages === 2, `expected 2 pages, received ${onTheLine.totalPages}`);
  assert(calls <= 8, `the reserve must settle in a handful of calls, took ${calls}`);
}

export function testPaginationPureAtomicBlockMovesWhole(): void {
  const result = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 80 },
      { pos: 10, top: 80, bottom: 130 },
      { pos: 20, top: 130, bottom: 140 },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(result.breaks.length === 1 && result.breaks[0].pos === 10, 'a block without lines is cut before, not inside');
  assert(result.breaks[0].fillHeight === 20, `fill 20, received ${result.breaks[0].fillHeight}`);
  assert(result.totalPages === 2 && result.lastFill === 40, `page 2 fill 40, received ${result.lastFill}`);

  // Same measurements, same cuts: the extension relies on it to stop.
  const again = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 80 },
      { pos: 10, top: 80, bottom: 130 },
      { pos: 20, top: 130, bottom: 140 },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(JSON.stringify(again) === JSON.stringify(result), 'pagination is deterministic');

  const empty = computePageBreaks([], { pageHeight: 100, reserved: NO_NOTES });
  assert(empty.breaks.length === 0 && empty.totalPages === 1, 'no blocks is one page');
}

export function testPaginationPureForcedBreak(): void {
  const result = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 30 },
      { pos: 10, top: 30, bottom: 60, breakBefore: true },
      { pos: 20, top: 60, bottom: 90 },
      { pos: 30, top: 90, bottom: 120, breakBefore: true },
      { pos: 40, top: 120, bottom: 300, breakBefore: true },
    ],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(
    result.breaks.map((cut) => cut.pos).join(',') === '10,30,40',
    `a block that asks for a page gets one, received ${JSON.stringify(result.breaks)}`,
  );
  assert(result.breaks[0].fillHeight === 70 && result.breaks[1].fillHeight === 40, 'the fill runs to the page end');
  assert(result.totalPages === 4, `expected 4 pages, received ${result.totalPages}`);

  // First on its page already: no empty page in front of it.
  const first = computePageBreaks(
    [{ pos: 0, top: 0, bottom: 30, breakBefore: true }, { pos: 10, top: 30, bottom: 60 }],
    { pageHeight: 100, reserved: NO_NOTES },
  );
  assert(first.breaks.length === 0 && first.totalPages === 1, 'a forced break at the top of a page is nothing');
}

export function testPaginationPureMargins(): void {
  // Blocks with a 10px margin between them: `top` is the margin-box top,
  // `bottom` the border-box bottom. The fill starts at the text's bottom
  // edge (80), the next page starts at the next block's margin box (90 =
  // 80 + the margin the widget covers), and a bottom margin that runs past
  // the limit does not move a line.
  const marginBefore = () => 10;
  const result = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 80 },
      { pos: 10, top: 90, bottom: 130 },
      { pos: 20, top: 140, bottom: 170 },
    ],
    { pageHeight: 100, reserved: NO_NOTES, marginBefore },
  );
  assert(result.breaks.length === 1 && result.breaks[0].pos === 10, `one cut before block 2, received ${JSON.stringify(result.breaks)}`);
  assert(result.breaks[0].fillHeight === 20, `fill from the text's bottom (20), received ${result.breaks[0].fillHeight}`);
  assert(result.breaks[0].pull === 10, `the widget is pulled over the margin (10), received ${result.breaks[0].pull}`);
  assert(result.lastFill === 20, `page 2 runs 90..190, block 3 ends at 170: fill 20, received ${result.lastFill}`);

  // A list keeps its last item's margin inside its box: the cut after it
  // starts at the last line, and the pull covers the inner margin too.
  const container = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 40 },
      {
        pos: 10,
        top: 50,
        bottom: 108,
        lines: [{ pos: 11, top: 50, bottom: 75 }, { pos: 20, top: 75, bottom: 98 }],
      },
      { pos: 30, top: 118, bottom: 140 },
    ],
    { pageHeight: 100, reserved: NO_NOTES, marginBefore },
  );
  assert(container.breaks.length === 1 && container.breaks[0].pos === 30, `cut after the list, received ${JSON.stringify(container.breaks)}`);
  assert(container.breaks[0].fillHeight === 2, `fill from the last line (98): 2, received ${container.breaks[0].fillHeight}`);
  assert(container.breaks[0].pull === 20, `pull covers inner (10) and outer (10) margins, received ${container.breaks[0].pull}`);
  assert(container.lastFill === 78, `page 2 starts at 118, block ends at 140: fill 78, received ${container.lastFill}`);

  const margin = computePageBreaks(
    [
      { pos: 0, top: 0, bottom: 98, lines: [{ pos: 1, top: 0, bottom: 49 }, { pos: 30, top: 49, bottom: 98 }] },
      { pos: 10, top: 108, bottom: 120 },
    ],
    { pageHeight: 100, reserved: NO_NOTES, marginBefore },
  );
  assert(margin.breaks.length === 1 && margin.breaks[0].pos === 10, 'the margin after a fitting paragraph is not carried over');
  assert(margin.breaks[0].fillHeight === 2, `fill 2, received ${margin.breaks[0].fillHeight}`);
}

/* ── In the editor ─────────────────────────────────────────────────────── */

const LONG_PARAGRAPH =
  'The lamp had burned down to a blue bead by the time she finished the letter, and the ' +
  'house around her had gone so quiet that she could hear the river under the ice. She read ' +
  'it through once more, changed nothing, and folded it into thirds the way her mother had ' +
  'taught her, with the crease pressed under a thumbnail so it would hold.';

/** Paragraphs of varying length: identical ones would break identically on every page. */
function paragraphs(count: number, seed = 0): string {
  let html = '';
  for (let index = 0; index < count; index += 1) {
    const extra = LONG_PARAGRAPH.slice(0, ((seed + index) * 53) % LONG_PARAGRAPH.length);
    if ((seed + index) % 12 === 0) html += `<h2>Chapter ${(seed + index) / 12 + 1}</h2>`;
    html += `<p>[${seed + index + 1}] ${LONG_PARAGRAPH} ${extra}</p>`;
  }
  return html;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Resolve once the plugin has gone `quietFrames` frames without dispatching. */
async function settled(counter: { dispatches: number }, quietFrames = 4, maxFrames = 120): Promise<void> {
  let seen = counter.dispatches;
  let quiet = 0;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextFrame();
    if (counter.dispatches === seen) {
      quiet += 1;
      if (quiet >= quietFrames) return;
    } else {
      seen = counter.dispatches;
      quiet = 0;
    }
  }
  throw new Error(`page layout did not settle in ${maxFrames} frames (${counter.dispatches} dispatches)`);
}

interface Mounted {
  editor: Editor;
  wrapper: HTMLElement;
  sheet: HTMLElement;
  counter: { dispatches: number };
  destroy: () => void;
}

function mount(content: string, collectNotes?: (doc: Editor['state']['doc']) => PageNote[]): Mounted {
  ensureProseStyle();
  const wrapper = document.createElement('div');
  wrapper.className = 'tiptap-editor';
  wrapper.dataset.editorLayout = 'page';
  const element = document.createElement('div');
  wrapper.appendChild(element);
  document.body.appendChild(wrapper);
  const counter = { dispatches: 0 };
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      PageLayout.configure({
        pageSize: 'a4',
        collectNotes,
        footerLabel: (page, total) => `Page ${page} of ${total}`,
      }),
    ],
    content,
  });
  editor.on('transaction', ({ transaction }) => {
    if (transaction.getMeta(pageLayoutKey)) counter.dispatches += 1;
  });
  return {
    editor,
    wrapper,
    sheet: editor.view.dom,
    counter,
    destroy: () => {
      editor.destroy();
      wrapper.remove();
    },
  };
}

function breaks(sheet: HTMLElement): HTMLElement[] {
  return Array.from(sheet.querySelectorAll<HTMLElement>(`.${BREAK_CLASS}:not(.wh-page-break--last)`));
}

function lastFoot(sheet: HTMLElement): HTMLElement | null {
  return sheet.querySelector<HTMLElement>('.wh-page-break--last');
}

/** Every page, from the head of its sheet to the foot, must be one sheet tall. */
function assertSheetGeometry(sheet: HTMLElement, expectedPages: number): void {
  const size = PAGE_SIZES.a4;
  const middle = breaks(sheet);
  const sheetRect = sheet.getBoundingClientRect();
  near(sheetRect.width, size.widthPx, 0.5, 'sheet width');
  let pageTop = sheetRect.top;
  middle.forEach((widget, index) => {
    const foot = widget.querySelector('.wh-page-foot');
    const head = widget.querySelector('.wh-page-head');
    assert(foot && head, `break ${index + 1} has a foot and a head`);
    // Half a pixel: the fill is snapped to 0.5px, nothing else is rounded.
    near(foot.getBoundingClientRect().bottom - pageTop, size.heightPx, 0.5, `page ${index + 1} height`);
    pageTop = head.getBoundingClientRect().top;
  });
  near(sheetRect.bottom - pageTop, size.heightPx, 0.5, `last page (${expectedPages}) height`);
  const total = middle.length + 1;
  assert(total === expectedPages, `expected ${expectedPages} pages on screen, received ${total}`);
}

export async function testPageModeInEditor(): Promise<void> {
  const notesAtParagraphs = (doc: Editor['state']['doc']): PageNote[] => {
    const notes: PageNote[] = [];
    doc.forEach((_node, offset, index) => {
      if (index === 0) notes.push({ pos: offset + 5, text: 'First note, on the first page.' });
      if (index === 1) notes.push({ pos: offset + 5, text: 'Second note, also on the first page.' });
    });
    return notes;
  };

  const mounted = mount(paragraphs(60));
  const { editor, sheet, counter } = mounted;
  try {
    assert(sheet.dataset.pageSize === 'a4', 'the plugin marks the sheet with its page size');
    assert(sheet.style.getPropertyValue('--wh-page-width') === '794px', 'the sheet carries its width from PAGE_SIZES');
    assert(document.head.querySelector('style[data-wh-page-layout]'), 'the geometry stylesheet is injected');

    await settled(counter);
    // (a) The text spans several sheets.
    const initial = breaks(sheet);
    assert(initial.length >= 2, `expected at least 2 page breaks, received ${initial.length}`);
    assert(lastFoot(sheet), 'the last page has a foot');
    // (b) The count the host shows is the number of feet.
    assert(getPageCount(editor) === initial.length + 1, `getPageCount ${getPageCount(editor)} vs ${initial.length + 1} sheets`);
    assertSheetGeometry(sheet, getPageCount(editor));
    assert(
      lastFoot(sheet)?.querySelector('.wh-page-number')?.textContent === `Page ${initial.length + 1} of ${initial.length + 1}`,
      'the footer label is the host\'s',
    );
    assert(
      initial[0].querySelector('.wh-page-number')?.textContent === `Page 1 of ${initial.length + 1}`,
      'the first page is numbered 1',
    );
    // At least one break landed inside a paragraph: the cut is by lines,
    // not by whole blocks, or the page would end well above its foot.
    assert(initial.some((widget) => widget.parentElement?.tagName === 'P'), 'paragraphs are cut between lines');
    // Every chapter heading after the first (`break-before: page`) opens a sheet.
    const headings = Array.from(sheet.querySelectorAll('h2')).slice(1);
    assert(headings.length >= 2, 'the document has chapters');
    for (const heading of headings) {
      const before = heading.previousElementSibling;
      assert(before?.classList.contains(BREAK_CLASS), `a page break precedes "${heading.textContent}"`);
    }
    // Settling took the passes it is allowed and no more.
    assert(counter.dispatches <= 3, `first layout took ${counter.dispatches} dispatches`);

    // The caret can sit at a break, on the page that follows it. The break
    // inside a paragraph is the interesting one: there the widget is a block
    // between two runs of the same text.
    const inParagraph = initial.findIndex((widget) => widget.parentElement?.tagName === 'P');
    const decorations = (pageLayoutKey.getState(editor.state)?.decorations.find() ?? [])
      .slice()
      .sort((a, b) => a.from - b.from);
    const firstBreak = decorations[inParagraph];
    assert(firstBreak, 'the in-paragraph break has a decoration');
    const breakPos = firstBreak.from;
    editor.view.focus();
    editor.commands.setTextSelection(breakPos);
    assert(editor.state.selection.from === breakPos, 'the selection lands on the break position');
    assert(editor.view.hasFocus(), 'the harness window can focus the editor');
    const domSelection = window.getSelection();
    assert(domSelection && domSelection.rangeCount > 0, 'the browser has a selection');
    const focus = domSelection.focusNode;
    const focusElement = focus instanceof Element ? focus : focus?.parentElement;
    assert(focusElement && !focusElement.closest(`.${BREAK_CLASS}`), 'the caret is never inside the break widget');

    // Backspace at the break removes exactly one character of text — the one
    // before the cut — and no widget, as ProseMirror steers the native delete
    // past the non-editable node. Emulated: the keydown handler adjusts the
    // DOM selection, execCommand plays the browser's default action.
    const docBefore = editor.state.doc;
    const prefix = docBefore.textBetween(0, breakPos - 1, '\n');
    const suffix = docBefore.textBetween(breakPos, docBefore.content.size, '\n');
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, breakPos)));
    const keydown = new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(keydown);
    if (!keydown.defaultPrevented) document.execCommand('delete');
    await nextFrame();
    const docAfter = editor.state.doc;
    const textAfter = docAfter.textBetween(0, docAfter.content.size, '\n');
    assert(textAfter === prefix + suffix, 'Backspace at a break deletes the one character before the cut');
    assert(editor.state.selection.from === breakPos - 1, `the caret moves back one (${editor.state.selection.from} vs ${breakPos - 1})`);
    await settled(counter);
    assert(editor.getHTML().includes('wh-page') === false, 'page breaks never reach the serialized HTML');

    // (c) More text: more pages, and a bounded number of passes.
    const before = getPageCount(editor);
    const dispatchesBefore = counter.dispatches;
    editor.commands.insertContentAt(editor.state.doc.content.size, paragraphs(20, 60));
    await settled(counter);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = getPageCount(editor);
    assert(after > before, `20 more paragraphs add pages (${before} → ${after})`);
    assert(after === breaks(sheet).length + 1, 'the count still matches the feet on screen');
    assert(counter.dispatches - dispatchesBefore < 10, `re-layout looped: ${counter.dispatches - dispatchesBefore} dispatches in a second`);
    assertSheetGeometry(sheet, after);

    // A larger reading size reflows the text with no transaction at all: the
    // resize observer must notice, and the sheets must still add up.
    const smallPages = getPageCount(editor);
    mounted.wrapper.dataset.readingSize = 'large';
    await settled(counter);
    assert(getPageCount(editor) > smallPages, `larger type takes more pages (${smallPages} → ${getPageCount(editor)})`);
    assertSheetGeometry(sheet, getPageCount(editor));
    delete mounted.wrapper.dataset.readingSize;
    await settled(counter);
    assert(getPageCount(editor) === smallPages, `back to ${smallPages} pages at the small size, received ${getPageCount(editor)}`);

    // (e) Nothing left: one sheet, filled to the bottom.
    editor.commands.clearContent();
    await settled(counter);
    assert(getPageCount(editor) === 1, `an empty document is one page, received ${getPageCount(editor)}`);
    assert(breaks(sheet).length === 0, 'no breaks on an empty document');
    assertSheetGeometry(sheet, 1);
    near(sheet.getBoundingClientRect().height, PAGE_SIZES.a4.heightPx, 1, 'empty sheet height');
  } finally {
    mounted.destroy();
  }

  // (d) Footnotes: two references on the first page, both printed at its foot,
  // numbered from 1, and the page still one sheet tall.
  const withNotes = mount(paragraphs(60), notesAtParagraphs);
  try {
    await settled(withNotes.counter);
    const first = breaks(withNotes.sheet)[0];
    assert(first, 'the document still spans pages');
    const list = first.querySelector<HTMLOListElement>('.wh-page-notes');
    assert(list, 'the first page has a notes list');
    assert(list.querySelectorAll('li').length === 2, `two notes on page 1, received ${list.querySelectorAll('li').length}`);
    assert(list.start === 1, `numbering starts at 1, received ${list.start}`);
    assert(list.querySelector('li')?.textContent === 'First note, on the first page.', 'the note text is printed');
    const second = breaks(withNotes.sheet)[1];
    assert(second && !second.querySelector('.wh-page-notes'), 'page 2 has no notes list');
    assertSheetGeometry(withNotes.sheet, getPageCount(withNotes.editor));
    assert(withNotes.counter.dispatches <= 3, `notes settled in ${withNotes.counter.dispatches} dispatches`);
  } finally {
    withNotes.destroy();
  }

  // A long list: the cut lands inside it, the widget's band is pulled back
  // to the sheet's edge, and the layout still settles.
  const items = Array.from({ length: 40 }, (_, index) => `<li><p>Item ${index + 1}: ${LONG_PARAGRAPH.slice(0, 120)}</p></li>`).join('');
  const withList = mount(`<p>${LONG_PARAGRAPH}</p><ul>${items}</ul><p>${LONG_PARAGRAPH}</p>`);
  try {
    await settled(withList.counter);
    const cuts = breaks(withList.sheet);
    assert(cuts.length >= 1, 'a long list spans pages');
    const inList = cuts.find((widget) => widget.closest('ul'));
    assert(inList, 'the list is cut inside, not moved whole');
    near(
      inList.getBoundingClientRect().left,
      withList.sheet.getBoundingClientRect().left,
      1,
      'a break inside a list starts at the sheet edge',
    );
    assertSheetGeometry(withList.sheet, getPageCount(withList.editor));
  } finally {
    withList.destroy();
  }

  // Letter is a different sheet.
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const letter = new Editor({
    element: wrapper,
    extensions: [StarterKit, PageLayout.configure({ pageSize: 'letter' })],
    content: '<p>Short.</p>',
  });
  try {
    await nextFrame();
    await nextFrame();
    await nextFrame();
    near(letter.view.dom.getBoundingClientRect().width, PAGE_SIZES.letter.widthPx, 0.5, 'letter width');
    near(letter.view.dom.getBoundingClientRect().height, PAGE_SIZES.letter.heightPx, 1, 'letter height');
    assert(getPageCount(letter) === 1, 'one short paragraph is one page');
  } finally {
    letter.destroy();
    wrapper.remove();
  }
}

export function testPageSizes(): void {
  for (const size of Object.values(PAGE_SIZES)) {
    near(size.widthPx, (size.widthMm / 25.4) * 96, 1, 'width px vs mm');
    near(size.heightPx, (size.heightMm / 25.4) * 96, 1, 'height px vs mm');
    near(size.marginPx, (size.marginMm / 25.4) * 96, 0.5, 'margin px vs mm');
    assert(usablePageHeight(size) === size.heightPx - 2 * size.marginPx, 'usable height is the sheet minus both margins');
  }
}
