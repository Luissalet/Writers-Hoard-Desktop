// ============================================================================
// Footnotes — the node, the model, the panel and every export
// ============================================================================
//
// Runs inside the critical harness (a real Chromium window), so the editor
// here is a real Tiptap `Editor` on a real element, and the React surfaces
// are mounted with `react-dom`. Each exported `testFootnote…` throws on
// failure; `critical.browser.ts` calls them in `run()`.

import JSZip from 'jszip';
import { createElement, act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import type { Writing } from '@/types';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';
import {
  FOOTNOTE_INSERTED_META,
  FootnoteNode,
  footnoteInsertedIn,
  footnoteOpenedIn,
} from '@/components/editor/footnotes/FootnoteNode';
import {
  collectFootnotes,
  extractFootnotesFromHtml,
  findFootnote,
  normalizeFootnotePlacement,
  renderBookEndnotesHtml,
  renderEndnotesHtml,
  renderFootnoteRefs,
  sameFootnotes,
} from '@/components/editor/footnotes/footnoteModel';
import FootnoteLayer from '@/components/editor/footnotes/FootnoteLayer';
import FootnotesPanel from '@/components/editor/footnotes/FootnotesPanel';
import {
  composePublishingDocument,
  publishingSectionWordCount,
} from '@/engines/writings/publishingDocument';
import { htmlToMarkdown, renderPublishingHtml, renderPublishingMarkdown } from '@/engines/writings/manuscriptExport';
import { buildChapterExport } from '@/engines/writings/chapterExport';

declare global {
  // React's `act` warns unless the environment says it is a test.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const REF = (id: string, text: string) =>
  `<sup data-footnote-id="${id}" data-footnote="${text}" class="wh-footnote-ref"></sup>`;

function mountEditor(content: string): { editor: Editor; host: HTMLElement } {
  const host = document.createElement('div');
  host.className = 'tiptap-editor';
  host.style.cssText = 'position:relative;width:640px;overflow:hidden;';
  document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: [StarterKit, FootnoteNode], content });
  return { editor, host };
}

function unmountEditor(editor: Editor, host: HTMLElement): void {
  editor.destroy();
  host.remove();
}

function key(target: EventTarget, init: KeyboardEventInit & { keyCode: number }): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  return !target.dispatchEvent(event);
}

// ── (a) Serialisation, parsing and the sanitizer ────────────────────────────

export function testFootnoteRoundTripsThroughHtmlAndTheSanitizer(): void {
  const text = 'A note with "quotes", <angles> & a > sign\nand a second line';
  const { editor, host } = mountEditor(`<p>One${REF('n1', 'first')} two.</p>`);
  try {
    const html = editor.getHTML();
    assert(
      html === `<p>One${REF('n1', 'first')} two.</p>`,
      `the node does not serialise to the fixed byte shape: ${html}`,
    );

    // The sanitizer keeps exactly what the node needs and nothing is lost on
    // the way back in — including the characters the serialiser escapes.
    editor.commands.setFootnoteText('n1', text);
    const persisted = editor.getHTML();
    const cleaned = sanitizeRichHtml(persisted);
    assert(cleaned.includes('data-footnote-id="n1"'), 'the sanitizer dropped the footnote id');
    assert(cleaned.includes('class="wh-footnote-ref"'), 'the sanitizer dropped the reference class');
    const [note] = extractFootnotesFromHtml(cleaned);
    assert(note && note.text === text, `the note body did not survive the sanitizer: ${note?.text}`);

    editor.commands.setContent(cleaned);
    const [reparsed] = collectFootnotes(editor.state.doc);
    assert(reparsed && reparsed.id === 'n1' && reparsed.text === text, 'the node did not parse back from sanitized HTML');

    // A body that happens to start with `data:` is TEXT, not a URL. The
    // sanitizer's data:-URL hook used to strip any attribute whose value
    // began that way, whatever the attribute, and ate the note with it; it
    // now looks only at the attributes a browser reads as a URL.
    const dataish = sanitizeRichHtml(`<p>x${REF('n2', 'data: see appendix')}</p>`);
    const [survivor] = extractFootnotesFromHtml(dataish);
    assert(
      survivor && survivor.text === 'data: see appendix',
      `a note body starting with "data:" did not survive the sanitizer: ${survivor?.text}`,
    );
    // The narrowing must not have opened the door it was guarding: an <img>
    // carrying an SVG data document is still refused.
    const svg = sanitizeRichHtml('<p><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="></p>');
    assert(!svg.includes('data:image/svg'), 'the sanitizer let an SVG data URL through an <img>');
    const png = sanitizeRichHtml('<p><img src="data:image/png;base64,iVBORw0KGgo="></p>');
    assert(png.includes('data:image/png'), 'the sanitizer dropped a raster image the editor writes');
  } finally {
    unmountEditor(editor, host);
  }
}

// ── (b) The commands, on a live editor ──────────────────────────────────────

export function testFootnoteCommandsOnALiveEditor(): void {
  const { editor, host } = mountEditor('<p>Alpha beta gamma.</p>');
  try {
    let insertedMeta: string | null = null;
    editor.on('transaction', ({ transaction }) => {
      const meta = footnoteInsertedIn(transaction);
      if (meta) insertedMeta = meta.id;
    });

    // Insert at a cursor: the node lands there, the cursor lands after it,
    // and both the storage and the transaction meta name the new note.
    editor.commands.setTextSelection(6); // after "Alpha"
    assert(editor.commands.insertFootnote('why alpha'), 'insertFootnote refused a plain cursor');
    const storage = editor.storage.footnote;
    assert(storage.lastInsertedId, 'storage.lastInsertedId was not set');
    assert(insertedMeta === storage.lastInsertedId, `the ${FOOTNOTE_INSERTED_META} meta did not carry the id`);
    let notes = collectFootnotes(editor.state.doc);
    assert(notes.length === 1 && notes[0].text === 'why alpha' && notes[0].pos === 6, 'the note is not where the cursor was');
    assert(
      editor.state.selection instanceof TextSelection && editor.state.selection.from === 7,
      'the cursor did not land after the reference',
    );
    assert(editor.getHTML().startsWith('<p>Alpha<sup data-footnote-id='), `unexpected HTML: ${editor.getHTML()}`);

    // Insert over a selection: the selected text is replaced.
    editor.commands.setTextSelection({ from: 8, to: 12 }); // "beta"
    editor.commands.insertFootnote();
    assert(!editor.state.doc.textContent.includes('beta'), 'a selection was not replaced by the note');
    notes = collectFootnotes(editor.state.doc);
    assert(notes.length === 2 && notes[1].text === '', 'a note inserted without text should be empty');

    // Edit and remove by id; both refuse an id the document does not hold.
    const second = notes[1].id;
    assert(editor.commands.setFootnoteText(second, 'gone soon'), 'setFootnoteText failed');
    assert(findFootnote(editor.state.doc, second)?.node.attrs.text === 'gone soon', 'setFootnoteText did not write');
    assert(!editor.commands.setFootnoteText('nope', 'x'), 'setFootnoteText accepted an unknown id');
    assert(editor.commands.removeFootnote(second), 'removeFootnote failed');
    assert(!findFootnote(editor.state.doc, second), 'removeFootnote left the node');
    assert(!editor.commands.removeFootnote(second), 'removeFootnote accepted a removed id');
    assert(editor.state.doc.textContent === 'Alpha  gamma.', `unexpected text after removal: ${editor.state.doc.textContent}`);

    // Editing a selected note keeps it selected: the highlight must not
    // vanish on the first keystroke of the note.
    const [first] = collectFootnotes(editor.state.doc);
    editor.commands.setNodeSelection(first.pos);
    editor.commands.setFootnoteText(first.id, 'still selected');
    assert(
      editor.state.selection instanceof NodeSelection && editor.state.selection.from === first.pos,
      'editing the body of a selected note dropped the node selection',
    );

    // Backspace just after the reference deletes the whole note — the
    // atom rule, exercised through a real keydown on the editor's DOM.
    editor.commands.focus();
    editor.commands.setTextSelection(first.pos + 1);
    const handled = key(editor.view.dom, { key: 'Backspace', code: 'Backspace', keyCode: 8 });
    assert(handled, 'Backspace after the reference was not handled by the editor');
    assert(!findFootnote(editor.state.doc, first.id), 'Backspace after the reference did not delete it');
    assert(editor.state.doc.textContent === 'Alpha  gamma.', 'Backspace ate prose beside the note');

    // Mod+Alt+F inserts one; Enter on a selected reference asks the UI to
    // open it and leaves the paragraph whole.
    editor.commands.setTextSelection(1);
    key(editor.view.dom, { key: 'f', code: 'KeyF', keyCode: 70, ctrlKey: true, altKey: true });
    const [byKey] = collectFootnotes(editor.state.doc);
    assert(byKey && byKey.pos === 1, 'Mod+Alt+F did not insert a note at the cursor');

    let opened: string | null = null;
    editor.on('transaction', ({ transaction }) => {
      opened = footnoteOpenedIn(transaction) ?? opened;
    });
    editor.commands.setNodeSelection(byKey.pos);
    const before = editor.state.doc.toJSON();
    key(editor.view.dom, { key: 'Enter', code: 'Enter', keyCode: 13 });
    assert(opened === byKey.id, 'Enter on a selected reference did not ask to open it');
    assert(JSON.stringify(editor.state.doc.toJSON()) === JSON.stringify(before), 'Enter on a selected reference changed the document');

    // A code block holds text only: the command refuses rather than letting
    // ProseMirror drop the node somewhere outside the block.
    editor.commands.setContent('<pre><code>let x = 1;</code></pre>');
    editor.commands.setTextSelection(4);
    assert(!editor.commands.insertFootnote('nope'), 'insertFootnote accepted a code block');
    assert(collectFootnotes(editor.state.doc).length === 0, 'a note landed inside or beside a code block');
  } finally {
    unmountEditor(editor, host);
  }
}

// ── (c) Numbering follows document order ────────────────────────────────────

export function testFootnotesNumberInDocumentOrder(): void {
  const { editor, host } = mountEditor(
    `<h2>Title${REF('h', 'heading note')}</h2><p>Para${REF('p1', 'one')} and${REF('p2', 'two')}.</p><blockquote><p>Q${REF('q', 'quoted')}</p></blockquote>`,
  );
  try {
    const order = collectFootnotes(editor.state.doc);
    assert(
      order.map((note) => `${note.index}:${note.id}`).join(',') === '1:h,2:p1,3:p2,4:q',
      `collectFootnotes is not in document order: ${JSON.stringify(order)}`,
    );
    assert(
      extractFootnotesFromHtml(editor.getHTML()).map((note) => `${note.index}:${note.id}`).join(',') === '1:h,2:p1,3:p2,4:q',
      'extractFootnotesFromHtml disagrees with collectFootnotes',
    );

    // A note inserted ahead of the others pushes their numbers up.
    editor.commands.setTextSelection(1);
    editor.commands.insertFootnote('first now');
    const renumbered = collectFootnotes(editor.state.doc);
    assert(renumbered[0].text === 'first now' && renumbered[1].id === 'h' && renumbered[1].index === 2, 'an earlier insert did not renumber');

    // The equality the panel relies on ignores position.
    const shifted = renumbered.map((note) => ({ ...note, pos: note.pos + 10 }));
    assert(sameFootnotes(renumbered, shifted), 'sameFootnotes should ignore positions');
    assert(!sameFootnotes(renumbered, renumbered.slice(1)), 'sameFootnotes missed a removed note');
    assert(
      !sameFootnotes(renumbered, renumbered.map((note, at) => (at === 2 ? { ...note, text: 'changed' } : note))),
      'sameFootnotes missed a changed body',
    );
  } finally {
    unmountEditor(editor, host);
  }
}

// ── (d) The body is not prose ───────────────────────────────────────────────

export function testFootnoteBodyIsNotCounted(): void {
  const html = `<p>Seven words are in this very sentence${REF('a', 'but these six words are not')}.</p>`;
  assert(countWords(html) === 7, `countWords counted the note body: ${countWords(html)}`);
  const writing = { content: html, wordCount: 0 } as Writing;
  assert(publishingSectionWordCount(writing) === 7, 'publishingSectionWordCount counted the note body');
}

// ── (e) Every export ────────────────────────────────────────────────────────

function fixtureWritings(): Writing[] {
  const base: Omit<Writing, 'id' | 'title' | 'chapter' | 'content'> = {
    projectId: 'fn-project', status: 'draft', tags: [], createdAt: 1, updatedAt: 1, wordCount: 0,
  };
  return [
    {
      ...base,
      id: 'ch-1',
      title: 'Salt',
      chapter: 1,
      content: `<p>The harbour${REF('s1', 'On the harbour, see the survey of 1911.')} at dawn.</p><p>Nets &amp; ropes${REF('s2', 'Two lines\nof note')}.</p>`,
    },
    {
      ...base,
      id: 'ch-2',
      title: 'Iron',
      chapter: 2,
      content: `<p>Later${REF('i1', 'Restarts at one <here>.')}.</p>`,
    },
  ];
}

export async function testFootnotesReachEveryExport(): Promise<void> {
  const [{ buildPublishingDocx }, { buildPublishingEpub }] = await Promise.all([
    import('@/engines/writings/publishingDocx'),
    import('@/engines/writings/publishingEpub'),
  ]);
  const document = composePublishingDocument(fixtureWritings(), {
    projectTitle: 'Tides',
    includeTitlePage: false,
    includeSynopsis: false,
    chapterLabel: 'Chapter',
    notesLabel: 'Notas',
    locale: 'en-US',
    generatedAt: Date.UTC(2026, 8, 2),
  });
  assert(document.notesLabel === 'Notas', 'the notes heading did not reach the IR');
  // Eight words of prose: "The harbour at dawn." (4) + "Nets & ropes." (3) +
  // "Later." (1). Nothing from the three note bodies — including the `<here>`
  // in the last one, which used to end `stripHtml`'s tag pattern early and
  // leak the rest of the attribute into the count as a ninth word.
  assert(document.wordCount === 8, `the export counted note bodies as words: ${document.wordCount}`);

  // Markdown: [^n] inline, definitions after the chapter, numbering per chapter.
  const markdown = renderPublishingMarkdown(document);
  assert(markdown.includes('The harbour[^1] at dawn.') && markdown.includes('Nets & ropes[^2].'), `Markdown lost an inline marker:\n${markdown}`);
  assert(markdown.includes('[^1]: On the harbour, see the survey of 1911.'), 'Markdown lost a definition');
  assert(markdown.includes('[^2]: Two lines\n    of note'), 'Markdown did not indent the continuation line');
  assert(markdown.includes('Later[^1].') && markdown.includes('[^1]: Restarts at one <here>.'), 'Markdown numbering did not restart per chapter');
  assert(markdown.indexOf('[^1]: On the harbour') < markdown.indexOf('## Chapter 2'), 'the definitions are not at the end of their chapter');
  assert(htmlToMarkdown('<p>No notes here</p>') === 'No notes here', 'htmlToMarkdown changed a body without notes');

  // HTML/PDF: explicit numbers, ids, links both ways, endnotes per chapter.
  const html = renderPublishingHtml(document);
  assert(html.includes('<sup class="wh-footnote-ref" id="fnref-s1"><a href="#fn-s1">1</a></sup>'), 'HTML reference lost its number or link');
  assert(html.includes('<sup class="wh-footnote-ref" id="fnref-i1"><a href="#fn-i1">1</a></sup>'), 'HTML numbering did not restart per chapter');
  assert((html.match(/<section class="wh-endnotes">/g) ?? []).length === 2, 'HTML should carry one endnotes section per chapter with notes');
  assert(html.includes('<h2>Notas</h2>'), 'HTML endnotes lost the translated heading');
  assert(html.includes('<li id="fn-s2">Two lines<br>of note <a href="#fnref-s2"'), 'HTML endnote lost its line break or back-link');
  assert(html.includes('Restarts at one &lt;here&gt;.'), 'HTML endnote did not escape the body');
  assert(!html.includes('data-footnote='), 'HTML export leaked the raw attribute form');

  // DOCX: real footnotes, numbered continuously across chapters.
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(document)).arrayBuffer());
  const footnotesXml = await docx.file('word/footnotes.xml')?.async('string') ?? '';
  const bodyXml = await docx.file('word/document.xml')?.async('string') ?? '';
  assert(footnotesXml.includes('On the harbour, see the survey of 1911.'), 'DOCX footnotes.xml lacks the first note');
  assert(footnotesXml.includes('Restarts at one &lt;here&gt;.'), 'DOCX footnotes.xml lacks the second chapter note');
  assert(footnotesXml.includes('Two lines') && footnotesXml.includes('<w:br/>') && footnotesXml.includes('of note'), 'DOCX lost the note line break');
  for (const id of [1, 2, 3]) {
    assert(bodyXml.includes(`<w:footnoteReference w:id="${id}"/>`), `DOCX body lacks footnote reference ${id}`);
    assert(new RegExp(`<w:footnote w:id="${id}"`).test(footnotesXml), `DOCX footnotes.xml lacks footnote ${id}`);
  }
  assert(!bodyXml.includes('On the harbour'), 'DOCX body inlined the note text');

  // EPUB: well-formed XHTML with EPUB 3 note semantics, per chapter.
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(document)).arrayBuffer());
  const parser = new DOMParser();
  for (const name of ['EPUB/section-1.xhtml', 'EPUB/section-2.xhtml', 'EPUB/nav.xhtml']) {
    const xhtml = await epub.file(name)?.async('string') ?? '';
    const parsed = parser.parseFromString(xhtml, 'application/xhtml+xml');
    assert(!parsed.querySelector('parsererror'), `${name} is not well-formed XML:\n${xhtml}`);
  }
  const chapterOne = await epub.file('EPUB/section-1.xhtml')?.async('string') ?? '';
  const chapterTwo = await epub.file('EPUB/section-2.xhtml')?.async('string') ?? '';
  assert(chapterOne.includes('<a epub:type="noteref" class="wh-noteref" href="#fn-s1" id="fnref-s1"><sup>1</sup></a>'), 'EPUB reference lost its noteref form');
  assert(chapterOne.includes('<aside epub:type="footnote" class="wh-footnote" id="fn-s2"><p>2. Two lines<br />of note <a href="#fnref-s2">↩</a></p></aside>'), 'EPUB aside lost its shape');
  assert(chapterTwo.includes('<sup>1</sup>') && chapterTwo.includes('Restarts at one &lt;here&gt;.'), 'EPUB numbering did not restart per chapter');
  const epubDom = parser.parseFromString(chapterOne, 'application/xhtml+xml');
  const noteref = epubDom.querySelector('a[href="#fn-s1"]');
  assert(noteref?.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'noteref', 'epub:type is not in the EPUB namespace');

  // One chapter through the chapter menu is the same compiler.
  const chapter = buildChapterExport([fixtureWritings()[0]], {
    projectTitle: 'Tides',
    chapterLabel: 'Chapter',
    untitledLabel: 'Untitled',
    wordLabel: 'words',
    notesLabel: 'Notas',
    locale: 'en-US',
    numberWidth: 2,
    generatedAt: Date.UTC(2026, 8, 2),
  });
  assert(chapter.markdown.includes('[^1]: On the harbour'), 'the chapter export lost its footnotes');
  assert(chapter.document.notesLabel === 'Notas', 'the chapter export lost the notes heading');

  // The reading view's endnotes survive the sanitizer with their text.
  const endnotes = renderEndnotesHtml(extractFootnotesFromHtml(fixtureWritings()[0].content), { heading: 'Notas', backlinks: false });
  const shown = sanitizeRichHtml(fixtureWritings()[0].content + endnotes);
  const shownDom = parser.parseFromString(shown, 'text/html');
  const items = shownDom.querySelectorAll('section.wh-endnotes ol > li');
  assert(items.length === 2 && items[1].innerHTML === 'Two lines<br>of note', `the reading view endnotes did not survive the sanitizer: ${shown}`);
  assert(!shown.includes('wh-endnote-back'), 'the reading view should not print back-links');
  assert(renderFootnoteRefs('<p>plain</p>', () => 'x').html === '<p>plain</p>', 'renderFootnoteRefs touched a body without notes');
}

// ── (e2) Notes at the end of the book ───────────────────────────────────────

export function testFootnotePlacementNormalizes(): void {
  assert(normalizeFootnotePlacement('book') === 'book', 'book is a placement');
  assert(normalizeFootnotePlacement('chapter') === 'chapter', 'chapter is a placement');
  for (const garbage of [undefined, null, '', 'page', 42, {}, 'BOOK']) {
    assert(normalizeFootnotePlacement(garbage) === 'chapter', `garbage placement ${String(garbage)} did not fall back to chapter`);
  }
  // The IR normalises too, so a stale row cannot reach a writer.
  const document = composePublishingDocument([], {
    projectTitle: 'x', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Chapter',
    footnotePlacement: 'nowhere' as never,
  });
  assert(document.footnotePlacement === 'chapter', 'the IR did not normalise the placement');
}

function composeFixture(footnotePlacement: 'chapter' | 'book') {
  return composePublishingDocument(fixtureWritings(), {
    projectTitle: 'Tides',
    includeTitlePage: false,
    includeSynopsis: false,
    chapterLabel: 'Chapter',
    notesLabel: 'Notas',
    footnotePlacement,
    locale: 'en-US',
    generatedAt: Date.UTC(2026, 8, 2),
  });
}

export async function testFootnotesAtTheEndOfTheBook(): Promise<void> {
  const [{ buildPublishingDocx }, { buildPublishingEpub }] = await Promise.all([
    import('@/engines/writings/publishingDocx'),
    import('@/engines/writings/publishingEpub'),
  ]);
  const parser = new DOMParser();
  const book = composeFixture('book');
  const chapter = composeFixture('chapter');
  assert(book.footnotePlacement === 'book' && chapter.footnotePlacement === 'chapter', 'the placement did not reach the IR');

  // HTML: 1, 2, 3 through the book; one section at the end with a heading
  // per chapter; the same ids and links as before.
  const html = renderPublishingHtml(book);
  for (const [id, n] of [['s1', 1], ['s2', 2], ['i1', 3]] as const) {
    assert(html.includes(`<sup class="wh-footnote-ref" id="fnref-${id}"><a href="#fn-${id}">${n}</a></sup>`), `HTML reference ${id} is not numbered ${n}:\n${html}`);
  }
  assert((html.match(/<section class="wh-endnotes">/g) ?? []).length === 0, 'HTML book placement still prints a section per chapter');
  const htmlDom = parser.parseFromString(html, 'text/html');
  const sections = htmlDom.querySelectorAll('section.wh-endnotes--book');
  assert(sections.length === 1, `HTML should carry one book-level notes section, found ${sections.length}`);
  const section = sections[0];
  assert(section.querySelector('h1')?.textContent === 'Notas', 'the book-level section lost its heading');
  const headings = [...section.querySelectorAll('h2')].map((h) => h.textContent);
  assert(headings.length === 2 && headings[0] === 'Chapter 1 — Salt' && headings[1] === 'Chapter 2 — Iron', `the book-level section does not head each chapter: ${headings.join(' | ')}`);
  const lists = [...section.querySelectorAll('ol')];
  assert(lists.length === 2 && !lists[0].hasAttribute('start') && lists[1].getAttribute('start') === '3', 'the second chapter\'s list does not start at 3');
  assert(section.querySelector('li#fn-i1 a.wh-endnote-back')?.getAttribute('href') === '#fnref-i1', 'the book-level note lost its back-link');
  // After the last chapter (the class is in the stylesheet too, so ask the DOM).
  const before = section.previousElementSibling;
  assert(before?.classList.contains('chapter') && before.querySelector('h1')?.textContent === 'Chapter 2 — Iron', 'the notes section is not after the last chapter');
  // Per chapter is what it was.
  const perChapter = renderPublishingHtml(chapter);
  assert((perChapter.match(/<section class="wh-endnotes">/g) ?? []).length === 2 && !perChapter.includes('<section class="wh-endnotes wh-endnotes--book">'), 'chapter placement changed');
  assert(perChapter.includes('<sup class="wh-footnote-ref" id="fnref-i1"><a href="#fn-i1">1</a></sup>'), 'chapter placement no longer restarts the numbers');

  // Markdown: the references count on, the definitions gather at the end
  // under one heading with a sub-heading per chapter.
  const markdown = renderPublishingMarkdown(book);
  assert(markdown.includes('The harbour[^1] at dawn.') && markdown.includes('Later[^3].'), `Markdown did not number continuously:\n${markdown}`);
  const notesAt = markdown.indexOf('# Notas');
  assert(notesAt > 0 && notesAt > markdown.indexOf('## Chapter 2 — Iron'), 'Markdown has no notes heading after the last chapter');
  assert(markdown.indexOf('[^1]: On the harbour') > notesAt && markdown.indexOf('[^3]: Restarts at one <here>.') > notesAt, 'Markdown definitions are not gathered at the end');
  const tail = markdown.slice(notesAt);
  assert(tail.indexOf('## Chapter 1 — Salt') < tail.indexOf('[^1]:') && tail.indexOf('## Chapter 2 — Iron') < tail.indexOf('[^3]:'), 'Markdown definitions are not grouped under their chapter');
  assert(!markdown.slice(0, notesAt).includes('[^1]:'), 'a definition escaped into the prose');
  const perChapterMarkdown = renderPublishingMarkdown(chapter);
  assert(perChapterMarkdown.includes('Later[^1].') && !perChapterMarkdown.includes('# Notas'), 'chapter placement changed the Markdown');

  // EPUB: a notes file at the end of the spine and the nav, every noteref
  // pointing into it, every aside pointing back to its chapter file.
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(book)).arrayBuffer());
  const opf = await epub.file('EPUB/package.opf')?.async('string') ?? '';
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)" \/>/g)].map((m) => m[1]);
  assert(spine.join(',') === 'section-1,section-2,notes', `EPUB spine is not chapters then notes: ${spine.join(',')}`);
  assert(opf.includes('<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml" />'), 'EPUB manifest lacks the notes file');
  const nav = await epub.file('EPUB/nav.xhtml')?.async('string') ?? '';
  assert(nav.includes('<li><a href="notes.xhtml">Notas</a></li>') && nav.lastIndexOf('notes.xhtml') > nav.indexOf('section-2.xhtml'), 'EPUB nav does not list the notes last');
  const notes = await epub.file('EPUB/notes.xhtml')?.async('string') ?? '';
  for (const name of ['EPUB/section-1.xhtml', 'EPUB/section-2.xhtml', 'EPUB/notes.xhtml']) {
    const parsed = parser.parseFromString(await epub.file(name)?.async('string') ?? '', 'application/xhtml+xml');
    assert(!parsed.querySelector('parsererror'), `${name} is not well-formed XML`);
  }
  const one = await epub.file('EPUB/section-1.xhtml')?.async('string') ?? '';
  const two = await epub.file('EPUB/section-2.xhtml')?.async('string') ?? '';
  assert(one.includes('<a epub:type="noteref" class="wh-noteref" href="notes.xhtml#fn-s1" id="fnref-s1"><sup>1</sup></a>'), 'EPUB noteref does not point into the notes file');
  assert(two.includes('href="notes.xhtml#fn-i1" id="fnref-i1"><sup>3</sup></a>'), 'EPUB numbering did not count on');
  assert(!one.includes('<aside') && !two.includes('<aside'), 'EPUB chapters still carry their asides');
  assert(notes.includes('<section epub:type="endnotes" class="wh-endnotes"><h1>Notas</h1><h2>Chapter 1 — Salt</h2>'), 'EPUB notes file lacks its heading or chapter groups');
  assert(notes.includes('<aside epub:type="endnote" class="wh-footnote" id="fn-i1"><p>3. Restarts at one &lt;here&gt;. <a href="section-2.xhtml#fnref-i1">↩</a></p></aside>'), `EPUB endnote aside lost its shape:\n${notes}`);
  const notesDom = parser.parseFromString(notes, 'application/xhtml+xml');
  assert(notesDom.querySelectorAll('aside').length === 3, 'EPUB notes file does not hold every note');
  const chapterEpub = await JSZip.loadAsync(await (await buildPublishingEpub(chapter)).arrayBuffer());
  assert(!chapterEpub.file('EPUB/notes.xhtml'), 'chapter placement grew a notes file');

  // DOCX: real Word endnotes instead of footnotes.
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(book)).arrayBuffer());
  const endnotesXml = await docx.file('word/endnotes.xml')?.async('string') ?? '';
  const footnotesXml = await docx.file('word/footnotes.xml')?.async('string') ?? '';
  const bodyXml = await docx.file('word/document.xml')?.async('string') ?? '';
  for (const id of [1, 2, 3]) {
    assert(bodyXml.includes(`<w:endnoteReference w:id="${id}"/>`), `DOCX body lacks endnote reference ${id}`);
    assert(new RegExp(`<w:endnote w:id="${id}"`).test(endnotesXml), `DOCX endnotes.xml lacks endnote ${id}`);
  }
  assert(!bodyXml.includes('<w:footnoteReference'), 'DOCX body still references footnotes');
  assert(endnotesXml.includes('Restarts at one &lt;here&gt;.') && !footnotesXml.includes('Restarts at one'), 'DOCX note bodies are not in endnotes.xml');

  // The reading view's list says where it starts, and survives the sanitizer.
  const shifted = extractFootnotesFromHtml(fixtureWritings()[1].content).map((note) => ({ ...note, index: note.index + 2 }));
  const shown = sanitizeRichHtml(renderEndnotesHtml(shifted, { heading: 'Notas', backlinks: false }));
  assert(shown.includes('<ol start="3">'), `the reading view list does not start at 3: ${shown}`);
  assert(renderBookEndnotesHtml([{ title: 'Empty', notes: [] }], { heading: 'Notas' }) === '', 'a book with no notes printed a notes section');
}

// ── (f) The two surfaces ────────────────────────────────────────────────────

interface HarnessProps {
  content: string;
  onEditor: (editor: Editor) => void;
}

/** The editor wrapper as `TiptapEditor` shapes it: relative, clipped, layer inside. */
function Harness({ content, onEditor }: HarnessProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mount) return;
    const instance = new Editor({ element: mount, extensions: [StarterKit, FootnoteNode], content });
    setEditor(instance);
    onEditor(instance);
    return () => instance.destroy();
    // Built once per mount, like `useEditor`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount]);
  return createElement(
    'div',
    { className: 'tiptap-editor', style: { position: 'relative', width: 640, overflow: 'hidden' } },
    createElement('div', { style: { height: 40 } }),
    createElement('div', { ref: setMount }),
    editor ? createElement(FootnoteLayer, { editor }) : null,
    editor ? createElement(FootnotesPanel, { editor }) : null,
  );
}

function setFieldValue(field: HTMLTextAreaElement, value: string): void {
  // Through the prototype setter so React's tracked value sees a change.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testFootnoteLayerAndPanel(): Promise<void> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  let editor: Editor | null = null;
  try {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Harness, {
        content: `<p>Alpha${REF('a', 'about alpha')} beta.</p>`,
        onEditor: (instance) => { editor = instance; },
      }));
    });
    assert(editor, 'the harness did not build an editor');
    const live: Editor = editor;
    const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
    const rows = () => container.querySelectorAll('aside ol > li');

    // The panel lists the note; nothing is open yet.
    assert(rows().length === 1, 'the panel does not list the existing note');
    assert(!dialog(), 'the popover opened without being asked');

    // A click on the reference opens the popover with the note's text and focus.
    const ref = container.querySelector<HTMLElement>('sup.wh-footnote-ref');
    assert(ref, 'the reference is not in the DOM');
    const refPos = findFootnote(live.state.doc, 'a')?.pos;
    assert(refPos === 6, `the reference is not where the fixture put it: ${refPos}`);
    await act(async () => {
      // What a mouse does: the node is selected on mousedown, then clicked.
      live.commands.setNodeSelection(refPos);
      ref.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const field = dialog()?.querySelector('textarea');
    assert(field && field.value === 'about alpha', 'the popover did not open on click with the note');
    assert(document.activeElement === field, 'the popover field did not take focus on click');

    // Typing in the popover writes the node, and the panel follows.
    await act(async () => setFieldValue(field, 'about alpha, revised'));
    assert(findFootnote(live.state.doc, 'a')?.node.attrs.text === 'about alpha, revised', 'typing in the popover did not write the note');
    assert(rows()[0].querySelector('textarea')?.value === 'about alpha, revised', 'the panel did not follow the popover');

    // Escape closes and puts the caret after the reference.
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    assert(!dialog(), 'Escape did not close the popover');
    assert(live.state.selection instanceof TextSelection && live.state.selection.from === refPos + 1, 'Escape did not return the caret after the reference');

    // Arrowing onto the reference shows the note without stealing focus.
    await act(async () => {
      live.commands.focus();
      live.commands.setNodeSelection(refPos);
    });
    assert(dialog(), 'selecting the reference did not show the popover');
    assert(document.activeElement !== dialog()?.querySelector('textarea'), 'a keyboard selection stole focus into the field');
    await act(async () => {
      live.commands.setTextSelection(3);
    });
    assert(!dialog(), 'moving the selection into the prose did not close the popover');

    // The panel's add button inserts at the cursor and the popover opens, focused.
    const add = [...container.querySelectorAll('aside header button')].at(-1);
    assert(add instanceof HTMLButtonElement, 'the panel has no add button');
    await act(async () => {
      live.commands.setTextSelection(live.state.doc.content.size - 1);
      add.click();
    });
    assert(rows().length === 2, 'adding from the panel did not add a note');
    assert(document.activeElement === dialog()?.querySelector('textarea'), 'a new note did not open its popover focused');

    // Editing in the panel writes the node; deleting from the panel removes it.
    const second = collectFootnotes(live.state.doc)[1];
    const rowField = rows()[1].querySelector('textarea');
    assert(rowField, 'the new row has no field');
    await act(async () => setFieldValue(rowField, 'from the panel'));
    assert(findFootnote(live.state.doc, second.id)?.node.attrs.text === 'from the panel', 'typing in the panel did not write the note');
    const remove = rows()[1].querySelectorAll('button')[1];
    await act(async () => remove.click());
    assert(rows().length === 1 && !findFootnote(live.state.doc, second.id), 'deleting from the panel did not remove the note');

    // A note deleted while its popover shows takes the popover with it; a
    // note edited elsewhere is followed by an unfocused popover.
    await act(async () => {
      live.commands.focus();
      live.commands.setNodeSelection(refPos);
    });
    assert(dialog() && document.activeElement !== dialog()?.querySelector('textarea'), 'the popover did not show unfocused for the follow-up check');
    await act(async () => { live.commands.setFootnoteText('a', 'edited elsewhere'); });
    assert(dialog()?.querySelector('textarea')?.value === 'edited elsewhere', 'an unfocused popover did not follow an edit made elsewhere');
    await act(async () => { live.commands.removeFootnote('a'); });
    assert(!dialog(), 'the popover outlived its note');

    // The empty state folds to the header.
    assert(rows().length === 0 && container.querySelector('aside ol') === null, 'the panel did not fold when empty');
    assert((container.querySelector('aside header')?.textContent ?? '').length > 0, 'the empty panel lost its header line');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  }
}

export async function runFootnoteTests(): Promise<string[]> {
  const passed: string[] = [];
  testFootnoteRoundTripsThroughHtmlAndTheSanitizer();
  passed.push('Footnote node round-trips through HTML and the sanitizer');
  testFootnoteCommandsOnALiveEditor();
  passed.push('Footnote commands on a live editor');
  testFootnotesNumberInDocumentOrder();
  passed.push('Footnotes number in document order');
  testFootnoteBodyIsNotCounted();
  passed.push('Footnote bodies are not counted as words');
  await testFootnotesReachEveryExport();
  passed.push('Footnotes reach Markdown, HTML, DOCX and EPUB');
  testFootnotePlacementNormalizes();
  passed.push('Footnote placement normalises');
  await testFootnotesAtTheEndOfTheBook();
  passed.push('Notes at the end of the book in HTML, Markdown, EPUB and DOCX');
  await testFootnoteLayerAndPanel();
  passed.push('Footnote popover and panel');
  return passed;
}
