// ============================================================================
// Critical test — whole-book editing
// ============================================================================
//
// The book editor shows every chapter as one document and writes it back as
// rows. What must not rot:
//   1. the model round-trips: rows → one HTML string → the same sections;
//   2. the diff names exactly the work: an edit, a new heading, a lost one;
//   3. the heading node behaves like a chapter boundary in a real editor —
//      Backspace does not join chapters, a range deletion cannot swallow a
//      heading, Enter opens a paragraph and not a second heading, a chapter
//      block moves whole;
//   4. the save writes only what moved against a real Dexie, creates a row
//      for a new heading, renumbers along the document, and NEVER deletes a
//      row whose heading vanished without a confirmed merge.

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { Writing } from '@/types';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import {
  CHAPTER_HEADING_ATTR,
  CHAPTER_HEADING_NAME,
  chapterBlocks,
} from '@/components/editor/chapterHeading/chapterBlocks';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { collectFootnotes } from '@/components/editor/footnotes/footnoteModel';
import { getPageCount } from '@/components/editor/pageMode/PageLayout';
import { useAppStore } from '@/stores/appStore';
import {
  canonicalHtml,
  composeBookHtml,
  diffBookSections,
  splitBookDoc,
  splitBookHtml,
  type BookSection,
} from '@/engines/writings/bookDocument';
import { saveBook, type BookBaseline } from '@/engines/writings/bookSave';
import { updateWritingAtVersion } from '@/engines/writings/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writing(id: string, chapter: number, title: string, content: string): Writing {
  const now = 1_700_000_000_000 + chapter;
  return {
    id,
    projectId: 'book-test-project',
    title,
    status: 'draft',
    content,
    wordCount: 0,
    chapter,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

const THREE_CHAPTERS: Writing[] = [
  writing('wrt-one', 1, 'Uno & <primero>', '<p>First chapter, <strong>bold</strong> &amp; plain.</p><p>Second paragraph.</p>'),
  writing('wrt-two', 2, 'Dos', '<p>Middle before.</p><p>Middle cut here.</p><p>Middle after.</p>'),
  writing('wrt-three', 3, 'Tres', '<p>Last chapter.</p>'),
];

/**
 * A headless editor over the book: StarterKit (minus its `doc`) plus the
 * book's document node, the heading and the footnote — the schema the book
 * editor builds — with no React view.
 */
function bookEditor(html: string, onRefused?: () => void): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, document: false }),
      BookDocument,
      ChapterHeadingNode.configure({ nodeView: false, onRemovalRefused: onRefused ?? null }),
      FootnoteNode,
    ],
    content: html,
  });
}

/**
 * A key press as the view sees it. Not `commands.keyboardShortcut`: that
 * captures the handler's steps and replays them onto a fresh transaction,
 * dropping the selection the handler set — which is half of what these
 * tests are about.
 */
function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return Boolean(editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)));
}

/** The block the caret is in, read fresh so an assertion cannot narrow it. */
function caretParent(editor: Editor): string {
  return editor.state.selection.$from.parent.type.name;
}

function sectionIds(editor: Editor): (string | null)[] {
  return splitBookDoc(editor.state.doc, editor.schema).map((section) => section.writingId);
}

/** Position just inside the Nth paragraph whose text starts with `text`. */
function insideParagraph(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === 'paragraph' && node.textContent.startsWith(text)) found = pos + 1;
    return found < 0;
  });
  assert(found >= 0, `no paragraph starting with "${text}"`);
  return found;
}

function headingPos(editor: Editor, writingId: string | null, index = 0): number {
  const blocks = chapterBlocks(editor.state.doc, editor.schema.nodes[CHAPTER_HEADING_NAME]);
  const matches = blocks.filter((block) => block.writingId === writingId && block.headingPos !== null);
  const block = matches[index];
  assert(block && block.headingPos !== null, `no heading for ${writingId}`);
  return block.headingPos;
}

// ---------------------------------------------------------------------------
// (a) compose / split round trip
// ---------------------------------------------------------------------------
export function testBookRoundTrip(): void {
  const html = composeBookHtml([THREE_CHAPTERS[2], THREE_CHAPTERS[0], THREE_CHAPTERS[1]]);
  assert(html.startsWith('<h1 data-writing-id="wrt-one" data-chapter="1"'), 'the book must open on chapter 1 whatever the input order');
  assert(html.includes('Uno &amp; &lt;primero&gt;'), 'the title is escaped');
  const sections = splitBookHtml(html);
  assert(sections.length === 3, `expected 3 sections, got ${sections.length}`);
  sections.forEach((section, index) => {
    const row = THREE_CHAPTERS[index];
    assert(section.writingId === row.id, `section ${index} id ${section.writingId} !== ${row.id}`);
    assert(section.title === row.title, `section ${index} title "${section.title}" !== "${row.title}"`);
    assert(section.html === row.content, `section ${index} html "${section.html}" !== "${row.content}"`);
  });
}

// ---------------------------------------------------------------------------
// (b) split edges: prose before the first h1, and an h1 that carries no data
// ---------------------------------------------------------------------------
export function testBookSplitEdges(): void {
  const withPrelude = splitBookHtml(`<p>Loose prose</p><h1 ${CHAPTER_HEADING_ATTR}="">Pasted title</h1><p>Body</p>`);
  assert(withPrelude.length === 2, `expected 2 sections, got ${withPrelude.length}`);
  assert(withPrelude[0].writingId === null && withPrelude[0].title === '' && withPrelude[0].html === '<p>Loose prose</p>', 'the prelude keeps its prose and has no id');
  assert(withPrelude[1].writingId === null && withPrelude[1].title === 'Pasted title' && withPrelude[1].html === '<p>Body</p>', 'a marked h1 without an id is a section with no row');

  // A bare h1 is a scene heading inside its chapter, never a chapter: a
  // chapter that held one used to be cut in two on the first autosave.
  const bareH1 = splitBookHtml('<h1 data-writing-id="a">A</h1><p>Intro</p><h1>Scene</h1><p>Rest</p>');
  assert(bareH1.length === 1 && bareH1[0].writingId === 'a' && bareH1[0].html === '<p>Intro</p><h1>Scene</h1><p>Rest</p>', `a bare h1 stays inside its chapter: ${JSON.stringify(bareH1)}`);

  const blankPrelude = splitBookHtml('<p></p> <h1 data-writing-id="a">A</h1><p>x</p>');
  assert(blankPrelude.length === 1 && blankPrelude[0].writingId === 'a', 'an empty paragraph before the first heading is not a section');

  const emptyBody = splitBookHtml('<h1 data-writing-id="a">A</h1><h1 data-writing-id="b">B</h1><p>b</p>');
  assert(emptyBody.length === 2 && emptyBody[0].html === '' && emptyBody[1].html === '<p>b</p>', 'a heading followed by a heading is an empty chapter');
}

// ---------------------------------------------------------------------------
// (c) the diff
// ---------------------------------------------------------------------------
export function testBookDiff(): void {
  const base = new Map([
    ['a', { title: 'A', html: '<p>a</p>' }],
    ['b', { title: 'B', html: '<p>b</p>' }],
    ['c', { title: 'C', html: '<p>c</p>' }],
  ]);
  const section = (writingId: string | null, title: string, html: string, clientId: string | null = null): BookSection => ({
    writingId,
    clientId,
    title,
    html,
  });

  const unchanged = diffBookSections(base, [section('a', 'A', '<p>a</p>'), section('b', 'B ', ' <p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(unchanged.updates.length === 0 && unchanged.creates.length === 0 && unchanged.missing.length === 0, 'whitespace is not a change');
  assert(unchanged.order.join(',') === 'a,b,c', 'order is reported in document order');

  const edited = diffBookSections(base, [section('a', 'A', '<p>a2</p>'), section('b', 'B2', '<p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(edited.updates.length === 2, `expected two updates, got ${edited.updates.length}`);
  assert(edited.updates[0].writingId === 'a' && edited.updates[0].html === '<p>a2</p>', 'a body edit is an update');
  assert(edited.updates[1].writingId === 'b' && edited.updates[1].title === 'B2', 'a title edit is an update');

  const created = diffBookSections(base, [section('a', 'A', '<p>a</p>'), section(null, 'New', '<p>n</p>', 'client-1'), section('b', 'B', '<p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(created.creates.length === 1 && created.creates[0].index === 1 && created.creates[0].clientId === 'client-1', 'a heading with no id is a create at its index');
  assert(created.order.join(',') === 'a,,b,c', 'the new section is a null in the order');

  const lost = diffBookSections(base, [section('a', 'A', '<p>a</p><p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(lost.missing.length === 1 && lost.missing[0] === 'b', 'a row with no heading left is missing');
  assert(lost.updates.length === 1 && lost.updates[0].writingId === 'a', 'the chapter that absorbed it is an update');

  const reordered = diffBookSections(base, [section('a', 'A', '<p>a</p>'), section('c', 'C', '<p>c</p>'), section('b', 'B', '<p>b</p>')]);
  assert(reordered.order.join(',') === 'a,c,b' && reordered.updates.length === 0, 'a move changes the order and nothing else');

  const unknown = diffBookSections(base, [section('a', 'A', '<p>a</p>'), section('zzz', 'Z', '<p>z</p>'), section('b', 'B', '<p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(unknown.creates.length === 1 && unknown.creates[0].title === 'Z', 'an id the base does not know is a create, never a silent write');

  const duplicate = diffBookSections(base, [section('a', 'A', '<p>a</p>'), section('a', 'A copy', '<p>copy</p>'), section('b', 'B', '<p>b</p>'), section('c', 'C', '<p>c</p>')]);
  assert(duplicate.creates.length === 1 && duplicate.updates.length === 0 && duplicate.creates[0].title === 'A copy', 'a duplicated id is a create for the second copy');
}

// ---------------------------------------------------------------------------
// (d) the heading node in a real editor
// ---------------------------------------------------------------------------
export function testBookHeadingNode(): void {
  let refusals = 0;
  const refused = () => refusals;
  const editor = bookEditor(composeBookHtml(THREE_CHAPTERS), () => {
    refusals += 1;
  });
  try {
    const sections = splitBookDoc(editor.state.doc, editor.schema);
    assert(sections.length === 3, `expected 3 sections in the editor, got ${sections.length}`);
    assert(sections[0].title === THREE_CHAPTERS[0].title, `title round-trips through the editor: "${sections[0].title}"`);
    assert(sections[1].html === THREE_CHAPTERS[1].content, `prose round-trips through the editor: "${sections[1].html}"`);
    assert(sections.every((section) => typeof section.clientId === 'string'), 'every parsed heading gets a client id');
    assert(editor.getHTML() === composeBookHtml(THREE_CHAPTERS), 'canonical rows compose to exactly what the editor serialises');
    assert(canonicalHtml(THREE_CHAPTERS[0].content, editor.schema) === THREE_CHAPTERS[0].content, 'canonical prose is a fixed point');

    // Heading 1 in the middle of a chapter: a new chapter, right there.
    editor.commands.setTextSelection(insideParagraph(editor, 'Middle cut'));
    assert(editor.commands.setChapterHeading(), 'setChapterHeading applies to a paragraph');
    let split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 4, `a new heading makes 4 sections, got ${split.length}`);
    assert(split[2].writingId === null && split[2].title === 'Middle cut here.' && typeof split[2].clientId === 'string', 'the new section has the paragraph as title and no row');
    assert(split[1].html === '<p>Middle before.</p>' && split[2].html === '<p>Middle after.</p>', 'the prose is cut at the new heading');
    assert(!editor.commands.setChapterHeading(), 'a heading is not turned into a heading again');

    // Backspace at the start of a heading does nothing.
    const before = editor.state.doc.toJSON();
    editor.commands.setTextSelection(headingPos(editor, 'wrt-two') + 1);
    press(editor, 'Backspace');
    assert(JSON.stringify(editor.state.doc.toJSON()) === JSON.stringify(before), 'Backspace at the start of a heading must not join the chapter before');

    // Backspace at the start of the paragraph right after a heading: nothing either.
    editor.commands.setTextSelection(insideParagraph(editor, 'Middle before'));
    press(editor, 'Backspace');
    assert(sectionIds(editor).length === 4, 'Backspace at the start of a chapter body must not remove the heading');

    // Delete at the end of the paragraph before a heading: nothing either way.
    editor.commands.setTextSelection(insideParagraph(editor, 'Middle before') + 'Middle before.'.length);
    press(editor, 'Delete');
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 4 && split[1].html === '<p>Middle before.</p>' && split[2].title === 'Middle cut here.', 'Delete at the end of a chapter must not pull the next heading up');
    editor.commands.setTextSelection(headingPos(editor, null) + 1 + 'Middle cut here.'.length);
    press(editor, 'Delete');
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split[2].title === 'Middle cut here.' && split[2].html === '<p>Middle after.</p>', 'Delete at the end of a heading must not pull the paragraph up');

    // An empty paragraph after a heading goes on Backspace; the heading stays.
    editor.commands.setTextSelection(headingPos(editor, 'wrt-three') + 1 + 'Tres'.length);
    press(editor, 'Enter');
    assert(caretParent(editor) === 'paragraph', 'Enter at the end of a heading opens a paragraph');
    assert(sectionIds(editor).length === 4, 'Enter never makes a second heading');
    press(editor, 'Backspace');
    assert(caretParent(editor) === CHAPTER_HEADING_NAME, 'Backspace in the empty paragraph lands back in the heading');
    assert(splitBookDoc(editor.state.doc, editor.schema)[3].html === '<p>Last chapter.</p>', 'the empty paragraph is gone and the prose is untouched');

    // Enter in the middle of a title: the tail becomes a paragraph below.
    editor.commands.setTextSelection(headingPos(editor, 'wrt-one') + 1 + 'Uno'.length);
    press(editor, 'Enter');
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 4 && split[0].title === 'Uno', `Enter mid-title keeps the head as the title: "${split[0].title}"`);
    assert(split[0].html.startsWith('<p> &amp; &lt;primero&gt;</p>'), `the tail is the first paragraph: ${split[0].html}`);

    // A range deletion that covers a heading is refused whole.
    const range = { from: insideParagraph(editor, 'Second paragraph'), to: insideParagraph(editor, 'Middle before') };
    const beforeRange = editor.state.doc.toJSON();
    editor.commands.deleteRange(range);
    assert(JSON.stringify(editor.state.doc.toJSON()) === JSON.stringify(beforeRange), 'a deletion across a heading is dropped');
    assert(refused() === 1, `the refusal is reported once, got ${refused()}`);
    editor.commands.setTextSelection({ from: 0, to: editor.state.doc.content.size });
    editor.commands.deleteSelection();
    assert(sectionIds(editor).length === 4, 'Select all + Delete cannot empty the book');
    assert(refused() === 2, `the refusal is reported again, got ${refused()}`);

    // Moving a chapter block: heading and prose together, one step.
    assert(editor.commands.moveChapterAt(headingPos(editor, 'wrt-three'), 'up'), 'the last chapter can move up');
    assert(sectionIds(editor).join(',') === 'wrt-one,wrt-two,wrt-three,', `moved above the new chapter: ${sectionIds(editor).join(',')}`);
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split[2].html === '<p>Last chapter.</p>' && split[3].html === '<p>Middle after.</p>', 'the prose travels with its heading');
    assert(caretParent(editor) === CHAPTER_HEADING_NAME && editor.state.selection.$from.parent.textContent === 'Tres', 'the caret follows the moved heading');
    assert(!editor.commands.moveChapterAt(headingPos(editor, 'wrt-one'), 'up'), 'the first chapter cannot move up');
    assert(editor.commands.undo(), 'a move is one undo step');
    assert(sectionIds(editor).join(',') === 'wrt-one,wrt-two,,wrt-three', 'undo restores the order');

    // The two other ways in: the `# ` input rule and Mod-Alt-1.
    editor.commands.setTextSelection(insideParagraph(editor, 'Middle after'));
    editor.commands.insertContent('#');
    const typedAt = editor.state.selection.from;
    editor.view.someProp('handleTextInput', (handler) => handler(editor.view, typedAt, typedAt, ' ', () => editor.state.tr));
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 5 && split[3].writingId === null && split[3].title === 'Middle after.', `"# " at the start of a paragraph opens a chapter: ${split.map((row) => row.title).join(' | ')}`);
    editor.commands.setTextSelection(insideParagraph(editor, 'Second paragraph'));
    assert(press(editor, '1', { ctrlKey: true, altKey: true }), 'Mod-Alt-1 is handled');
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 6 && split[1].title === 'Second paragraph.' && split[1].writingId === null, 'Mod-Alt-1 opens a chapter too');
    assert(editor.commands.undo() && editor.commands.undo(), 'both are ordinary undo steps');
    assert(sectionIds(editor).length === 4, `undo takes the new headings away: ${sectionIds(editor).length}`);

    // The merge command is the one transaction that may drop a heading.
    assert(editor.commands.removeChapterHeadingAt(headingPos(editor, 'wrt-three')), 'a confirmed merge removes the heading');
    split = splitBookDoc(editor.state.doc, editor.schema);
    assert(split.length === 3 && split[2].html === '<p>Middle after.</p><p>Last chapter.</p>', 'the merged prose is the tail of the chapter before');
    assert(refused() === 2, 'a merge is not a refusal');

    // A heading cannot be wrapped: not by the Quote button, not by the
    // chord, not by a list. Wrapped, it would keep its id inside a quote,
    // stop being a boundary, and the save would write its prose twice.
    const docBeforeWrap = JSON.stringify(editor.state.doc.toJSON());
    editor.commands.setTextSelection(headingPos(editor, 'wrt-two') + 1);
    assert(!editor.commands.toggleBlockquote(), 'toggleBlockquote on a heading is refused');
    press(editor, 'b', { ctrlKey: true, shiftKey: true });
    assert(JSON.stringify(editor.state.doc.toJSON()) === docBeforeWrap, 'the quote chord does nothing to a heading');
    assert(refused() === 2, 'a refused wrap is the schema saying no, not the guard');
    assert(!editor.schema.nodes.blockquote.contentMatch.matchType(editor.schema.nodes[CHAPTER_HEADING_NAME]), 'the schema keeps a heading out of a blockquote');
    assert(!editor.schema.nodes.listItem.contentMatch.matchType(editor.schema.nodes[CHAPTER_HEADING_NAME]), 'the schema keeps a heading out of a list item');
    // Tiptap's list toggle falls back to `clearNodes` (the heading would
    // become a paragraph) and wraps that: one transaction, refused whole.
    editor.commands.toggleBulletList();
    assert(JSON.stringify(editor.state.doc.toJSON()) === docBeforeWrap, 'a list cannot swallow a chapter heading');
    assert(refused() === 3, 'the guard refuses the list toggle that would have unmade the heading');

    // The title is plain text: a footnote has nowhere to go in it (it would
    // be lost on the first save, which persists the title as a string).
    editor.commands.setTextSelection(headingPos(editor, 'wrt-two') + 1 + 'Dos'.length);
    assert(!editor.commands.insertFootnote('on the title'), 'a footnote is refused inside a title');
    assert(collectFootnotes(editor.state.doc).length === 0, 'no footnote landed anywhere');
    editor.commands.setTextSelection(insideParagraph(editor, 'Middle before'));
    assert(editor.commands.insertFootnote('in the prose'), 'the prose still takes footnotes');

    // A heading pasted beside its original: two headings with one id. Losing
    // either one is losing a heading, so the guard counts rather than lists.
    const copy = editor.state.doc.nodeAt(headingPos(editor, 'wrt-two'));
    assert(copy, 'the heading to copy is there');
    editor.commands.insertContentAt(editor.state.doc.content.size, copy.toJSON());
    assert(splitBookDoc(editor.state.doc, editor.schema).filter((row) => row.writingId === 'wrt-two').length === 1, 'the second copy is reported without an id');
    const secondCopy = headingPos(editor, 'wrt-two', 1);
    const beforeCopyDelete = JSON.stringify(editor.state.doc.toJSON());
    editor.commands.deleteRange({ from: secondCopy, to: secondCopy + (editor.state.doc.nodeAt(secondCopy)?.nodeSize ?? 0) });
    assert(JSON.stringify(editor.state.doc.toJSON()) === beforeCopyDelete && refused() === 4, 'deleting one of two headings sharing an id is refused');
    assert(editor.commands.removeChapterHeadingAt(secondCopy), 'the merge command still takes it away');

    assert(editor.getHTML().includes(`${CHAPTER_HEADING_ATTR}=""`), 'renderHTML marks the heading');
  } finally {
    editor.destroy();
  }

  // Serialised headings say what they are, so a copied one pastes as a
  // chapter; a bare h1 typed inside a chapter (Ctrl+Alt+1 in the single
  // editor, an imported scene heading) is StarterKit's heading and stays in
  // its chapter's prose — it used to become a new chapter on the first save.
  const mixed = bookEditor(
    `<h1 data-writing-id="x">X</h1><p>Intro</p><h1>Scene</h1><p>Rest</p><h1 ${CHAPTER_HEADING_ATTR}="">Pasted chapter</h1><p>Its prose</p>`,
  );
  try {
    const split = splitBookDoc(mixed.state.doc, mixed.schema);
    assert(split.length === 2 && split[0].writingId === 'x' && split[0].html === '<p>Intro</p><h1>Scene</h1><p>Rest</p>', `a bare h1 is prose: ${JSON.stringify(split)}`);
    assert(split[1].writingId === null && split[1].title === 'Pasted chapter' && typeof split[1].clientId === 'string', 'a marked h1 is a chapter with no row');
    const base = new Map([['x', { title: 'X', html: canonicalHtml('<p>Intro</p><h1>Scene</h1><p>Rest</p>', mixed.schema) }]]);
    const diff = diffBookSections(base, split.slice(0, 1));
    assert(diff.updates.length === 0 && diff.creates.length === 0, 'a chapter holding a bare h1 is not rewritten');
  } finally {
    mixed.destroy();
  }
}

// ---------------------------------------------------------------------------
// (d') the React node view, mounted for real
// ---------------------------------------------------------------------------
export async function testBookHeadingView(): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const moves: [number, string][] = [];
  const extensions = [
    StarterKit.configure({ document: false }),
    BookDocument,
    ChapterHeadingNode.configure({
      onMoveChapter: (pos, direction) => moves.push([pos, direction]),
    }),
  ];
  let mounted: Editor | null = null;
  function Harness() {
    const editor = useEditor({ extensions, content: composeBookHtml(THREE_CHAPTERS) });
    mounted = editor;
    return createElement(EditorContent, { editor });
  }
  try {
    flushSync(() => root.render(createElement(Harness)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const labels = host.querySelectorAll('.wh-chapter-heading__label');
    assert(labels.length === 3, `three headings render three labels, got ${labels.length}`);
    const titles = [...host.querySelectorAll('h1.wh-chapter-heading__title')].map((element) => element.textContent?.trim());
    assert(titles[0] === THREE_CHAPTERS[0].title && titles[2] === 'Tres', `titles render as editable text: ${titles.join(' | ')}`);
    const buttons = host.querySelectorAll('.wh-chapter-heading__actions button');
    assert(buttons.length === 12, `four controls per heading, got ${buttons.length}`);
    const firstUp = host.querySelector<HTMLButtonElement>('.wh-chapter-heading__grip button');
    assert(firstUp?.disabled === true, 'the first chapter cannot move up');
    const lastDown = [...host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__grip button')].pop();
    assert(lastDown?.disabled === true, 'the last chapter cannot move down');
    const secondDown = host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__grip button')[3];
    assert(secondDown && !secondDown.disabled, 'a middle chapter can move down');
    secondDown.click();
    assert(moves.length === 1 && moves[0][1] === 'down', 'the grip calls the host with the direction');
    const editor = mounted as Editor | null;
    assert(editor, 'the harness holds the editor');
    assert(moves[0][0] === headingPos(editor, 'wrt-two'), 'the grip reports the heading position');
    // The host moves it; the buttons follow the new order.
    editor.commands.moveChapterAt(moves[0][0], 'down');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(sectionIds(editor).join(',') === 'wrt-one,wrt-three,wrt-two', 'the view and the document agree');
    const lastDownAfter = [...host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__grip button')].pop();
    assert(lastDownAfter?.disabled === true, 'the chapter that is now last cannot move down');
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}

// ---------------------------------------------------------------------------
// (e) the save, against Dexie
// ---------------------------------------------------------------------------
export async function testBookSaveAgainstDexie(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-test-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const rows = THREE_CHAPTERS.map((row) => ({ ...row, projectId }));
  await db.writings.bulkAdd(rows);
  const editor = bookEditor(composeBookHtml(rows));
  const section = (writingId: string | null, title: string, html: string, clientId: string | null = null): BookSection => ({
    writingId,
    clientId,
    title,
    html,
  });
  const base = (): BookBaseline =>
    new Map(rows.map((row) => [row.id, {
      title: row.title,
      html: canonicalHtml(row.content, editor.schema),
      persisted: row.content,
      version: row.updatedAt,
      chapter: row.chapter ?? 0,
      wordCount: 0,
    }]));
  const common = { projectId, confirmedDeletes: new Set<string>(), firstChapter: 1, untitledTitle: 'Untitled' };
  try {
    // An edited chapter is written with a new version; nothing else is touched.
    let baseline = base();
    const edited = await saveBook({
      ...common,
      baseline,
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section('wrt-two', 'Dos', rows[1].content),
        section('wrt-three', 'Tres', rows[2].content),
      ],
    });
    assert(edited.wrote && edited.conflicts.length === 0 && edited.created.length === 0 && edited.deleted.length === 0, 'one edit is one write');
    const one = await db.writings.get('wrt-one');
    assert(one?.content === '<p>First chapter, rewritten.</p>' && one.wordCount === 3, 'the row holds the new prose and its word count');
    assert(one.updatedAt > rows[0].updatedAt && edited.baseline.get('wrt-one')?.version === one.updatedAt, 'the baseline moves to the version the write produced');
    assert((await db.writings.get('wrt-two'))?.updatedAt === rows[1].updatedAt, 'an untouched chapter is not rewritten');
    baseline = edited.baseline;

    // A heading with no row: a row is created, numbered, and the rest of the
    // range renumbered along the document.
    const created = await saveBook({
      ...common,
      baseline,
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section(null, '', '<p>Brand new.</p>', 'client-new'),
        section('wrt-two', 'Dos', rows[1].content),
        section('wrt-three', 'Tres', rows[2].content),
      ],
    });
    assert(created.created.length === 1 && created.created[0].clientId === 'client-new' && created.created[0].index === 1, 'the new section is created and named by its client id');
    const newId = created.created[0].writingId;
    const newRow = await db.writings.get(newId);
    assert(newRow && newRow.title === 'Untitled' && newRow.chapter === 2 && newRow.content === '<p>Brand new.</p>' && newRow.status === 'draft', 'the row is a draft chapter 2 with the untitled title');
    assert((await db.writings.get('wrt-two'))?.chapter === 3 && (await db.writings.get('wrt-three'))?.chapter === 4, 'the chapters after it move down one number');
    assert([...created.baseline.keys()].join(',') === `wrt-one,${newId},wrt-two,wrt-three`, 'the baseline is in document order');
    assert(created.baseline.get('wrt-three')?.chapter === 4 && created.baseline.get('wrt-three')?.version === (await db.writings.get('wrt-three'))?.updatedAt, 'renumbered rows carry their new version in the baseline');
    assert(created.baseline.get(newId)?.title === '', 'the baseline keeps the heading text, not the fallback title');
    assert(created.baseline.get(newId)?.persisted === '<p>Brand new.</p>' && created.baseline.get('wrt-one')?.persisted === '<p>First chapter, rewritten.</p>', 'the baseline knows what each row holds on disk');
    baseline = created.baseline;

    // A heading that vanished without a confirmed merge: refused, the row stays.
    const refused = await saveBook({
      ...common,
      baseline,
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section(newId, '', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(refused.refusedMissing.length === 1 && refused.refusedMissing[0] === 'wrt-three' && refused.deleted.length === 0, 'an unconfirmed missing row is refused');
    assert(await db.writings.get('wrt-three'), 'the row is still on disk');
    assert(refused.baseline.has('wrt-three') && [...refused.baseline.keys()].pop() === 'wrt-three', 'the refused row keeps its place in the baseline');
    assert((await db.writings.get('wrt-two'))?.content === `${rows[1].content}${rows[2].content}`, 'the chapter that absorbed the prose is still written');
    baseline = refused.baseline;

    // The same with the merge confirmed: the row goes, restorably.
    const merged = await saveBook({
      ...common,
      baseline,
      confirmedDeletes: new Set(['wrt-three']),
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section(newId, '', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(merged.deleted.length === 1 && merged.deleted[0].writing.id === 'wrt-three' && merged.refusedMissing.length === 0, 'a confirmed merge deletes the row and hands back the bundle');
    assert(!(await db.writings.get('wrt-three')), 'the merged row is gone');
    assert(!merged.baseline.has('wrt-three'), 'and out of the baseline');
    baseline = merged.baseline;

    // The heading comes back with its id (Ctrl+Z after the merge): the row
    // is restored from the bundle the merge left, not created a second time.
    const undone = await saveBook({
      ...common,
      baseline,
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section(newId, '', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', rows[1].content),
        section('wrt-three', 'Tres', '<p>Last chapter, back.</p>'),
      ],
    });
    assert(undone.restored.length === 1 && undone.restored[0] === 'wrt-three' && undone.created.length === 0, `the undone merge restores the row: ${JSON.stringify({ restored: undone.restored, created: undone.created })}`);
    const back = await db.writings.get('wrt-three');
    assert(back && back.content === '<p>Last chapter, back.</p>' && back.chapter === 4 && back.createdAt === rows[2].createdAt, `the restored row carries the section and its old identity: ${JSON.stringify(back)}`);
    assert((await db.writings.where('projectId').equals(projectId).count()) === 4, 'no duplicate row was created');
    assert(undone.baseline.get('wrt-three')?.version === back.updatedAt, 'the baseline holds the restored row at its new version');
    // Merged again: the bundle was spent, and a second merge parks a new one.
    const remerged = await saveBook({
      ...common,
      baseline: undone.baseline,
      confirmedDeletes: new Set(['wrt-three']),
      sections: [
        section('wrt-one', rows[0].title, '<p>First chapter, rewritten.</p>'),
        section(newId, '', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(remerged.deleted.length === 1 && !(await db.writings.get('wrt-three')), 'the second merge deletes the row again');
    baseline = remerged.baseline;

    // A row rewritten elsewhere is refused, reported, and never overwritten;
    // the other chapters are still saved. Contested rows are then skipped.
    const otherVersion = await updateWritingAtVersion('wrt-one', { content: '<p>Somebody else.</p>' });
    const conflicted = await saveBook({
      ...common,
      baseline,
      sections: [
        section('wrt-one', rows[0].title, '<p>Mine.</p>'),
        section(newId, 'Named now', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(conflicted.conflicts.length === 1 && conflicted.conflicts[0].kind === 'moved' && conflicted.conflicts[0].writingId === 'wrt-one', 'the moved row is a conflict');
    assert((await db.writings.get('wrt-one'))?.content === '<p>Somebody else.</p>', 'the other write is not overwritten');
    assert(conflicted.conflicts[0].kind === 'moved' && conflicted.conflicts[0].current.updatedAt === otherVersion, 'the conflict carries the row that won');
    assert((await db.writings.get(newId))?.title === 'Named now', 'the chapters that did not conflict are still written');
    const skipped = await saveBook({
      ...common,
      baseline: conflicted.baseline,
      contested: new Set(['wrt-one']),
      sections: [
        section('wrt-one', rows[0].title, '<p>Mine again.</p>'),
        section(newId, 'Named now', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(skipped.conflicts.length === 0 && !skipped.wrote, 'a contested row is neither written nor reported again');

    // Prose above the first heading becomes chapter 1 and pushes the rest down.
    const prelude = await saveBook({
      ...common,
      baseline: conflicted.baseline,
      contested: new Set(['wrt-one']),
      sections: [
        section(null, '', '<p>Above everything.</p>'),
        section('wrt-one', rows[0].title, '<p>Mine again.</p>'),
        section(newId, 'Named now', '<p>Brand new.</p>'),
        section('wrt-two', 'Dos', `${rows[1].content}${rows[2].content}`),
      ],
    });
    assert(prelude.created.length === 1 && prelude.created[0].clientId === null && prelude.created[0].index === 0, 'the prelude is a create with no heading');
    assert((await db.writings.get(prelude.created[0].writingId))?.chapter === 1, 'it becomes chapter 1');
    assert((await db.writings.get('wrt-two'))?.chapter === 4, 'the last chapter is renumbered to 4');
    assert((await db.writings.get('wrt-one'))?.chapter === 1, 'a contested chapter is not renumbered');
  } finally {
    editor.destroy();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

// ---------------------------------------------------------------------------
// (e') a partial range that grows: the chapters outside it move up first
// ---------------------------------------------------------------------------
export async function testBookSaveShiftsChaptersOutsideTheRange(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-range-project';
  await db.writings.where('projectId').equals(projectId).delete();
  // Chapters 1..5, plus a gap: 7. The book is open on 2..3.
  const rows = [1, 2, 3, 4, 5, 7].map((n) => ({ ...writing(`r${n}`, n, `Ch ${n}`, `<p>c${n}</p>`), projectId }));
  await db.writings.bulkAdd(rows);
  const editor = bookEditor(composeBookHtml(rows.slice(1, 3)));
  const section = (writingId: string | null, title: string, html: string, clientId: string | null = null): BookSection => ({
    writingId,
    clientId,
    title,
    html,
  });
  const range = rows.slice(1, 3);
  const baseline: BookBaseline = new Map(range.map((row) => [row.id, {
    title: row.title,
    html: canonicalHtml(row.content, editor.schema),
    persisted: row.content,
    version: row.updatedAt,
    chapter: row.chapter ?? 0,
    wordCount: 1,
  }]));
  const common = {
    projectId,
    confirmedDeletes: new Set<string>(),
    firstChapter: 2,
    outsideChapters: new Set([1, 4, 5, 7]),
    untitledTitle: 'Untitled',
  };
  const numbers = async () =>
    (await db.writings.where('projectId').equals(projectId).toArray())
      .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))
      .map((row) => `${row.chapter}:${row.title}`)
      .join(',');
  try {
    // One chapter added inside the range: 4 and everything above it move up
    // one, the gap between 5 and 7 kept, and no number is held twice.
    const grown = await saveBook({
      ...common,
      baseline,
      sections: [
        section('r2', 'Ch 2', '<p>c2</p>'),
        section(null, 'Inserted', '<p>new</p>', 'client-x'),
        section('r3', 'Ch 3', '<p>c3</p>'),
      ],
    });
    assert(grown.created.length === 1 && grown.collisions.length === 0, `the chapter is created without a collision: ${JSON.stringify(grown.collisions)}`);
    assert((await numbers()) === '1:Ch 1,2:Ch 2,3:Inserted,4:Ch 3,5:Ch 4,6:Ch 5,8:Ch 7', `the chapters outside moved up: ${await numbers()}`);
    assert([...grown.outsideChapters].sort((a, b) => a - b).join(',') === '1,5,6,8', `the caller learns the new numbers outside: ${[...grown.outsideChapters].join(',')}`);

    // The same growth after a chapter outside was renumbered elsewhere (6 to
    // 10): the pass reads the numbers as they are, not as the book opened.
    await updateWritingAtVersion('r5', { chapter: 10 });
    const again = await saveBook({
      ...common,
      outsideChapters: grown.outsideChapters,
      baseline: grown.baseline,
      sections: [
        section('r2', 'Ch 2', '<p>c2</p>'),
        section(grown.created[0].writingId, 'Inserted', '<p>new</p>'),
        section(null, 'Another', '<p>more</p>', 'client-y'),
        section('r3', 'Ch 3', '<p>c3</p>'),
      ],
    });
    assert(again.created.length === 1 && again.collisions.length === 0, `the second chapter is created without a collision: ${JSON.stringify(again.collisions)}`);
    assert((await numbers()) === '1:Ch 1,2:Ch 2,3:Inserted,4:Another,5:Ch 3,6:Ch 4,9:Ch 7,11:Ch 5', `the fresh numbers outside are the ones moved: ${await numbers()}`);
    assert([...again.outsideChapters].sort((a, b) => a - b).join(',') === '1,6,9,11', `the caller's numbers follow: ${[...again.outsideChapters].join(',')}`);
  } finally {
    editor.destroy();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

// ---------------------------------------------------------------------------
// (f) the view, end to end: load, autosave an edit, create a chapter from a
// heading, merge it back — against Dexie, through the real React tree.
// ---------------------------------------------------------------------------
async function until(condition: () => boolean, what: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function untilAsync(condition: () => Promise<boolean>, what: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function testBookEditorAutosave(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const { default: BookEditor } = await import('@/engines/writings/components/BookEditor');
  const projectId = 'book-editor-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const rows = THREE_CHAPTERS.map((row) => ({ ...row, projectId }));
  await db.writings.bulkAdd(rows);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let refreshes = 0;
  let unmounted = false;
  const opened: string[] = [];
  try {
    flushSync(() =>
      root.render(
        createElement(BookEditor, {
          projectId,
          writings: rows,
          onRefresh: () => {
            refreshes += 1;
          },
          onClose: () => undefined,
          onOpenChapter: (id: string) => opened.push(id),
        }),
      ),
    );
    await until(() => host.querySelectorAll('.wh-chapter-heading__label').length === 3, 'the book to load');
    const surface = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
    const editor = surface?.editor;
    assert(editor, 'the editor is reachable from its DOM');
    assert(host.querySelectorAll('.wh-chapter-heading[data-writing-id]').length === 3, 'every heading carries its row id in the DOM');

    // An edit lands in its row 1.2 s later, and nowhere else.
    editor.chain().focus().insertContentAt(insideParagraph(editor, 'Last chapter'), 'Edited: ').run();
    await untilAsync(async () => (await db.writings.get('wrt-three'))?.content === '<p>Edited: Last chapter.</p>', 'the autosave');
    assert((await db.writings.get('wrt-two'))?.updatedAt === rows[1].updatedAt, 'the other rows are untouched');
    assert(refreshes >= 1, 'the host list is asked to refresh');
    await until(() => Boolean(host.querySelector('[data-book-save-state="saved"]')), 'the saved indicator');

    // Heading 1 in the middle of chapter 2: a new row, numbered, stamped on the heading.
    editor.chain().focus().setTextSelection(insideParagraph(editor, 'Middle cut')).setChapterHeading().run();
    await until(() => host.querySelectorAll('.wh-chapter-heading__label').length === 4, 'the fourth heading');
    await untilAsync(async () => (await db.writings.where('projectId').equals(projectId).count()) === 4, 'the new row');
    await until(() => host.querySelectorAll('.wh-chapter-heading[data-writing-id]').length === 4, 'the new id on the heading');
    const all = await db.writings.where('projectId').equals(projectId).toArray();
    const fresh = all.find((row) => !rows.some((known) => known.id === row.id));
    assert(fresh && fresh.title === 'Middle cut here.' && fresh.chapter === 3 && fresh.content === '<p>Middle after.</p>', `the new row is chapter 3 with the paragraph as its title: ${JSON.stringify(fresh)}`);
    assert((await db.writings.get('wrt-two'))?.content === '<p>Middle before.</p>' && (await db.writings.get('wrt-three'))?.chapter === 4, 'chapter 2 was cut and chapter 3 moved to 4');
    await until(() => host.querySelectorAll('.wh-chapter-heading[data-chapter="4"]').length === 1, 'the renumbering to reach the heading');

    // Merge it back: the dialog asks, the row goes, the prose returns.
    const mergeButton = host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__actions button')[2 * 4 + 1];
    assert(mergeButton && !mergeButton.disabled, 'the new chapter can be merged with the one before');
    mergeButton.click();
    await until(() => Boolean(document.querySelector('[role="dialog"] button.bg-danger, .bg-danger')), 'the merge dialog');
    const confirm = document.querySelector<HTMLButtonElement>('button.bg-danger');
    assert(confirm, 'the dialog offers the merge');
    confirm.click();
    await untilAsync(async () => (await db.writings.where('projectId').equals(projectId).count()) === 3, 'the merged row to go');
    assert((await db.writings.get('wrt-two'))?.content === '<p>Middle before.</p><p>Middle after.</p>', 'the prose is back in chapter 2');
    assert((await db.writings.get('wrt-three'))?.chapter === 3, 'chapter 4 is chapter 3 again');
    await until(() => host.querySelectorAll('.wh-chapter-heading__label').length === 3, 'three headings again');
    await until(() => Boolean(document.querySelector('[role="status"] button')), 'the undo bar');

    // "Open chapter" flushes and hands the id to the host.
    host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__actions button')[0].click();
    await until(() => opened.length === 1, 'the host to be asked to open a chapter');
    assert(opened[0] === 'wrt-one', 'the first heading opens the first chapter');

    // Somebody else writes to a chapter while the book is clean: it reloads.
    await updateWritingAtVersion('wrt-three', { content: '<p>Rewritten elsewhere.</p>' });
    notifyDataChanged({ source: 'ai', table: 'writings', entityId: 'wrt-three', projectId });
    await until(() => host.textContent?.includes('Rewritten elsewhere.') === true, 'the clean reload');
    const reloaded = (host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
    assert(reloaded && reloaded !== editor, 'a reload is a new editor');

    // The same while the book is dirty: the chapter is contested, the banner
    // asks, and "keep mine" writes the book's text over theirs after filing it.
    reloaded.chain().focus().insertContentAt(insideParagraph(reloaded, 'Middle before'), 'Dirty: ').run();
    const theirVersion = await updateWritingAtVersion('wrt-three', { content: '<p>Theirs, again.</p>' });
    notifyDataChanged({ source: 'ai', table: 'writings', entityId: 'wrt-three', projectId });
    // The merge's undo bar is a status too; the banner is the amber one.
    const banner = () => [...host.querySelectorAll('[role="status"]')].find((element) => element.className.includes('border-accent-amber'));
    await until(() => Boolean(banner()?.querySelector('button')), 'the conflict banner');
    const keepMine = banner()?.querySelector<HTMLButtonElement>('button');
    assert(keepMine, 'the banner offers to keep the book text');
    keepMine.click();
    await untilAsync(async () => (await db.writings.get('wrt-three'))?.content === '<p>Rewritten elsewhere.</p>', 'the book text to win');
    assert((await db.writings.get('wrt-three'))?.updatedAt !== theirVersion, 'the row moved past their version');
    const filed = await db.writingSnapshots.where('writingId').equals('wrt-three').toArray();
    assert(filed.some((snapshot) => snapshot.content === '<p>Theirs, again.</p>' && snapshot.reason === 'manual'), 'their text is filed as a version first');
    await untilAsync(async () => (await db.writings.get('wrt-two'))?.content.startsWith('<p>Dirty: Middle before') === true, 'the dirty edit to land too');
    await until(() => Boolean(host.querySelector('[data-book-save-state="saved"]')), 'the book to be saved again');

    // Leaving inside the debounce: the unmount flush writes the last edit.
    const current = (host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
    assert(current, 'the editor is still there');
    current.chain().focus().insertContentAt(insideParagraph(current, 'First chapter'), 'Late: ').run();
    flushSync(() => root.unmount());
    unmounted = true;
    await untilAsync(async () => (await db.writings.get('wrt-one'))?.content.startsWith('<p>Late: First chapter') === true, 'the unmount flush');
  } finally {
    if (!unmounted) flushSync(() => root.unmount());
    host.remove();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

// ---------------------------------------------------------------------------
// (g) undoing a merge: Ctrl+Z restores the row, the bar reloads once
// ---------------------------------------------------------------------------
async function mountBook(
  projectId: string,
  rows: Writing[],
  extra: { footnotePlacement?: 'chapter' | 'book' } = {},
) {
  const { default: BookEditor } = await import('@/engines/writings/components/BookEditor');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      createElement(BookEditor, {
        projectId,
        writings: rows,
        onRefresh: () => undefined,
        onClose: () => undefined,
        onOpenChapter: () => undefined,
        ...extra,
      }),
    ),
  );
  await until(() => host.querySelectorAll('.wh-chapter-heading__label').length === rows.length, 'the book to load');
  const liveEditor = (): Editor => {
    const editor = (host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
    assert(editor, 'the editor is reachable from its DOM');
    return editor;
  };
  return {
    host,
    liveEditor,
    unmount: () => {
      flushSync(() => root.unmount());
      host.remove();
    },
  };
}

export async function testBookUndoMergeKeepsOneRow(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-undo-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const rows = [
    { ...writing('u-one', 1, 'Uno', '<p>First.</p>'), projectId },
    { ...writing('u-two', 2, 'Dos', '<p>Second.</p>'), projectId },
    { ...writing('u-three', 3, 'Tres', '<p>Third prose.</p>'), projectId },
  ];
  await db.writings.bulkAdd(rows);
  const book = await mountBook(projectId, rows);
  const rowsNow = async () =>
    (await db.writings.where('projectId').equals(projectId).toArray())
      .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))
      .map((row) => `${row.id}:${row.chapter}:${row.content}`)
      .join(' | ');
  const merge = async () => {
    book.host.querySelectorAll<HTMLButtonElement>('.wh-chapter-heading__actions button')[2 * 4 + 1].click();
    await until(() => Boolean(document.querySelector('button.bg-danger')), 'the merge dialog');
    document.querySelector<HTMLButtonElement>('button.bg-danger')?.click();
    await untilAsync(async () => (await db.writings.where('projectId').equals(projectId).count()) === 2, 'the merged row to go');
    await until(() => Boolean(document.querySelector('[role="status"] button')), 'the undo bar');
  };
  try {
    // The reflex after a merge: Ctrl+Z. The heading comes back with its id,
    // the row is restored — the same row, not a copy — and the bar retires.
    const editor = book.liveEditor();
    await merge();
    editor.chain().focus().undo().run();
    await untilAsync(async () => (await db.writings.where('projectId').equals(projectId).count()) === 3, 'the row to be restored');
    await until(() => Boolean(book.host.querySelector('[data-book-save-state="saved"]')), 'the save after the undo');
    assert((await rowsNow()) === 'u-one:1:<p>First.</p> | u-two:2:<p>Second.</p> | u-three:3:<p>Third prose.</p>', `Ctrl+Z brings the same row back: ${await rowsNow()}`);
    assert(!document.querySelector('[role="status"] button'), 'the undo bar has nothing left to offer');
    assert(book.liveEditor() === editor, 'no reload was needed');

    // The other way back: the bar. One reload, one "restored".
    await merge();
    const editors = new Set<Editor>([book.liveEditor()]);
    document.querySelector<HTMLButtonElement>('[role="status"] button')?.click();
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      editors.add(book.liveEditor());
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert((await rowsNow()) === 'u-one:1:<p>First.</p> | u-two:2:<p>Second.</p> | u-three:3:<p>Third prose.</p>', `the bar restores the row: ${await rowsNow()}`);
    assert(editors.size === 2, `the bar reloads the book exactly once, saw ${editors.size} editors`);
    assert(book.host.querySelectorAll('.wh-chapter-heading__label').length === 3, 'the reloaded book shows the three chapters');
  } finally {
    book.unmount();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

// ---------------------------------------------------------------------------
// (h) the layout toggle keeps the document: no remount, no lost edit
// ---------------------------------------------------------------------------
export async function testBookLayoutSwitchKeepsEdits(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-layout-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const rows = [
    { ...writing('l-one', 1, 'Uno', '<p>First chapter.</p>'), projectId },
    { ...writing('l-two', 2, 'Dos', '<p>Second chapter.</p>'), projectId },
  ];
  await db.writings.bulkAdd(rows);
  const setReading = useAppStore.getState().setReading;
  const book = await mountBook(projectId, rows);
  try {
    const editor = book.liveEditor();
    editor.chain().focus().insertContentAt(insideParagraph(editor, 'First chapter'), 'Typed before the toggle: ').run();
    // Straight to page mode, inside the autosave's debounce.
    await setReading({ layout: 'page' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert(book.liveEditor() === editor, 'switching the layout does not rebuild the editor');
    assert(editor.state.doc.textContent.includes('Typed before the toggle'), 'the unsaved edit is still on screen');
    assert(editor.view.dom.dataset.pageSize === 'a4', 'the page plugin is on the live editor');
    await until(() => getPageCount(editor) >= 1 && Boolean(editor.view.dom.querySelector('.wh-page-break--last')), 'the first page layout');
    await untilAsync(async () => (await db.writings.get('l-one'))?.content === '<p>Typed before the toggle: First chapter.</p>', 'the edit to be saved');

    // Letter, then back to flow: same editor, same history.
    await setReading({ pageSize: 'letter' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(book.liveEditor() === editor && editor.view.dom.dataset.pageSize === 'letter', 'the paper size swaps the plugin in place');
    await setReading({ layout: 'flow' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(book.liveEditor() === editor && editor.view.dom.dataset.pageSize === undefined, 'flow takes the plugin off the live editor');
    assert(!editor.view.dom.querySelector('.wh-page-break'), 'no page furniture is left behind');
    assert(editor.commands.undo(), 'the history survived the round trip');
    assert(!editor.state.doc.textContent.includes('Typed before the toggle'), 'undo takes the edit back');
  } finally {
    await setReading({ layout: 'flow', pageSize: 'a4' });
    book.unmount();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

// ---------------------------------------------------------------------------
// (i) the footnotes panel beside the book: opens on the button, lists the
// chapters' notes, and "go to" selects the note in the document
// ---------------------------------------------------------------------------
export async function testBookFootnotesPanel(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-notes-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const note = '<sup data-footnote-id="bn-1" data-footnote="A note in chapter two." class="wh-footnote-ref"></sup>';
  const rows = [
    { ...writing('n-one', 1, 'Uno', '<p>First chapter.</p>'), projectId },
    { ...writing('n-two', 2, 'Dos', `<p>Second${note} chapter.</p>`), projectId },
  ];
  await db.writings.bulkAdd(rows);
  try {
    window.localStorage.removeItem('writers-hoard:book:notesOpen');
  } catch {
    // The store is a convenience; the test does not depend on it.
  }
  const book = await mountBook(projectId, rows);
  try {
    const panel = () => book.host.querySelector<HTMLElement>('[data-testid="book-notes-panel"]');
    assert(!panel(), 'the panel is closed until asked for');
    // The label in either language, or the bare key while the locale lacks it.
    const toggle = [...book.host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((button) =>
      ['Panel de notas al pie', 'Footnotes panel', 'writings.book.notesPanel'].includes(button.getAttribute('aria-label') ?? ''),
    );
    assert(toggle, 'the header offers the footnotes panel');
    toggle.click();
    await until(() => Boolean(panel()?.querySelector('aside')), 'the panel to open');
    assert(toggle.getAttribute('aria-pressed') === 'true', 'the button shows the panel as open');
    assert(window.localStorage.getItem('writers-hoard:book:notesOpen') === '1', 'the choice is remembered');

    // The chapter's note is listed, with its text.
    const field = panel()?.querySelector<HTMLTextAreaElement>('textarea');
    assert(field && field.value === 'A note in chapter two.', `the panel lists the note of chapter two: ${field?.value}`);

    // "Go to" selects the footnote node in the book.
    const goTo = [...(panel()?.querySelectorAll<HTMLButtonElement>('li button') ?? [])].find((button) =>
      ['Ir a la referencia', 'Go to reference'].includes(button.getAttribute('aria-label') ?? ''),
    );
    assert(goTo, 'the row offers to go to the reference');
    goTo.click();
    const editor = book.liveEditor();
    const selected = editor.state.selection;
    assert('node' in selected && (selected as { node: { type: { name: string } } }).node.type.name === 'footnote', 'the footnote node is selected');
    assert(editor.state.doc.nodeAt(selected.from)?.attrs.id === 'bn-1', 'the selection is on the note that was clicked');

    // Closing the panel: gone, and remembered as closed.
    toggle.click();
    await until(() => !panel(), 'the panel to close');
    assert(window.localStorage.getItem('writers-hoard:book:notesOpen') === '0', 'the closed state is remembered');
  } finally {
    book.unmount();
    await db.writings.where('projectId').equals(projectId).delete();
  }
}

/**
 * With the notes placed per chapter, the book's numbers start again at each
 * chapter heading: the wrapper says so for the stylesheet's counter, and the
 * panel prints the chapter's number beside each note. At the end of the
 * book they run on, and the panel offers the choice.
 */
export async function testBookFootnotesRestartPerChapter(): Promise<void> {
  if (!db.isOpen()) await db.open();
  const projectId = 'book-notes-restart-project';
  await db.writings.where('projectId').equals(projectId).delete();
  const ref = (id: string, text: string) =>
    `<sup data-footnote-id="${id}" data-footnote="${text}" class="wh-footnote-ref"></sup>`;
  const rows = [
    { ...writing('r-one', 1, 'Uno', `<p>First${ref('r1', 'one-a')} chapter${ref('r2', 'one-b')}.</p>`), projectId },
    { ...writing('r-two', 2, 'Dos', `<p>Second${ref('r3', 'two-a')} chapter.</p>`), projectId },
  ];
  await db.writings.bulkAdd(rows);
  try {
    window.localStorage.setItem('writers-hoard:book:notesOpen', '1');
  } catch {
    // The store is a convenience; the test does not depend on it.
  }
  const markers = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>('[data-testid="book-notes-panel"] li > span')].map((span) => span.textContent);
  const collectedIndexes = (editor: Editor, restartAt?: string) =>
    collectFootnotes(editor.state.doc, restartAt).map((note) => note.index).join(',');

  const perChapter = await mountBook(projectId, rows, { footnotePlacement: 'chapter' });
  try {
    await until(() => perChapter.host.querySelectorAll('[data-testid="book-notes-panel"] li').length === 3, 'the panel to list the notes');
    // The stylesheet's hook: the wrapper carries the placement, and the
    // heading its rule resets on is a direct child of the prose body.
    const wrapper = perChapter.host.querySelector('[data-footnote-placement]');
    assert(wrapper?.getAttribute('data-footnote-placement') === 'chapter', 'the wrapper does not carry the placement');
    assert(
      perChapter.host.querySelectorAll("[data-footnote-placement='chapter'] .tiptap-editor .ProseMirror > .wh-chapter-heading").length === 2,
      'the CSS rule that resets the counter would match no heading',
    );
    assert(markers(perChapter.host).join(',') === '1,2,1', `the panel does not restart per chapter: ${markers(perChapter.host).join(',')}`);
    const editor = perChapter.liveEditor();
    assert(collectedIndexes(editor, CHAPTER_HEADING_NAME) === '1,2,1' && collectedIndexes(editor) === '1,2,3', 'collectFootnotes does not restart at the heading');
    // A note added ahead of the second chapter's renumbers the panel.
    editor.commands.setTextSelection(insideParagraph(editor, 'Second'));
    editor.commands.insertFootnote('two-new');
    await until(() => markers(perChapter.host).join(',') === '1,2,1,2', 'the panel to renumber');
    // The placement choice is offered here too, and writes the project row.
    const select = [...perChapter.host.querySelectorAll<HTMLSelectElement>('[data-testid="book-notes-panel"] select')]
      .find((element) => [...element.options].some((option) => option.value === 'book'));
    assert(select && select.value === 'chapter', 'the panel does not offer the placement');
  } finally {
    perChapter.unmount();
  }

  const wholeBook = await mountBook(projectId, rows, { footnotePlacement: 'book' });
  try {
    // Three notes, or four when the first book's autosave landed the new one.
    await until(() => wholeBook.host.querySelectorAll('[data-testid="book-notes-panel"] li').length >= 3, 'the panel to list the notes');
    assert(wholeBook.host.querySelector('[data-footnote-placement]')?.getAttribute('data-footnote-placement') === 'book', 'the wrapper does not carry the book placement');
    const shown = markers(wholeBook.host);
    assert(shown.join(',') === shown.map((_, at) => String(at + 1)).join(','), `the panel restarts with the notes at the end of the book: ${shown.join(',')}`);
  } finally {
    wholeBook.unmount();
    try {
      window.localStorage.removeItem('writers-hoard:book:notesOpen');
    } catch {
      // Same store, same indifference.
    }
    await db.writings.where('projectId').equals(projectId).delete();
  }
}
