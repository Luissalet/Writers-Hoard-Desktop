// ============================================================================
// Footnotes across the AI bridge, the search index and project-wide replace
// ============================================================================
//
// What the manuscript's footnote node needs from the rest of the app once it
// leaves the editor as `<sup data-footnote-id data-footnote>`:
//
//   • the AI bridge writes each note as `[^id]` plus a `[^id]: text` block and
//     reads that syntax back into the node, ids and texts intact — where before
//     `[^1]` came back as literal prose and the note as a stray paragraph;
//   • `wh_append_writing` leaves the notes already in a chapter byte for byte;
//   • the search index finds a word that only a note says;
//   • project-wide replace rewrites inside a note.
//
// Runs inside the critical harness (real DOM, real Dexie). Each exported
// `testFootnoteBridge…` throws on failure; `critical.browser.ts` calls them.

import { db } from '@/db';
import { markdownToTiptapHtml, tiptapHtmlToMarkdown } from '@/services/aiBridge/markdown';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';
import {
  extractFootnotesFromHtml,
  footnoteRefHtml,
  isFootnoteLabel,
  withFootnoteTexts,
} from '@/components/editor/footnotes/footnoteModel';
import {
  invalidateProjectSearchIndex,
  searchProjectContent,
} from '@/services/projectSearchIndex';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const REF = (id: string, text: string) => footnoteRefHtml(id, text);

/** The chapter every case below starts from: two notes, one of them awkward. */
const NOTE_ONE = 'See the survey of 1911.';
const NOTE_TWO = 'Two lines\nof note, with "quotes", <angles> & an ampersand';
const CHAPTER_HTML =
  `<h2>Salt</h2><p>The harbour${REF('n1abc_x1y2z3', NOTE_ONE)} at dawn.</p>` +
  `<p>Nets and <strong>ropes${REF('n2def_a4b5c6', NOTE_TWO)}</strong>.</p>`;

async function putProject(projectId: string, title: string): Promise<void> {
  await db.projects.put({
    id: projectId,
    title,
    mode: 'custom',
    type: 'idea',
    color: '#6b7280',
    description: '',
    status: 'draft',
    enabledEngines: ['writings'],
    engineOrder: ['writings'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

// ── (a) HTML → Markdown ─────────────────────────────────────────────────────

export function testFootnoteBridgeHtmlToMarkdown(): void {
  const markdown = tiptapHtmlToMarkdown(CHAPTER_HTML, { footnotes: true });
  assert(
    markdown.includes('The harbour[^n1abc_x1y2z3] at dawn.'),
    `the first reference is not written with its id as the label:\n${markdown}`,
  );
  assert(
    markdown.includes('**ropes[^n2def_a4b5c6]**'),
    `the second reference did not keep its place inside the bold:\n${markdown}`,
  );
  assert(markdown.includes('## Salt'), 'the heading was lost around the notes');
  const definitions = markdown.slice(markdown.indexOf('\n\n[^'));
  assert(
    definitions === `\n\n[^n1abc_x1y2z3]: ${NOTE_ONE}\n[^n2def_a4b5c6]: Two lines\n    of note, with "quotes", <angles> & an ampersand`,
    `the definitions block is not at the end, in order, with the continuation line indented:\n${JSON.stringify(definitions)}`,
  );
  assert(!markdown.includes('data-footnote'), 'the raw attribute form leaked into the Markdown');
  assert(!markdown.includes('<sup'), 'an empty <sup> leaked into the Markdown');

  // Without the option this is the exporter's numbering, untouched — the
  // manuscript export tests own that shape; here only that both agree.
  assert(
    tiptapHtmlToMarkdown(CHAPTER_HTML) === htmlToMarkdown(CHAPTER_HTML),
    'without footnotes:true the reading direction must be the exporter itself',
  );
  assert(
    tiptapHtmlToMarkdown('<p>No notes</p>', { footnotes: true }) === 'No notes',
    'a body without notes was touched',
  );

  // An id that cannot be a label, an empty one, and two references sharing
  // an id: every reference still gets a label of its own.
  const awkward = `<p>a${REF('has space', 'x')}b${REF('', 'y')}c${REF('dup', 'z')}d${REF('dup', 'w')}</p>`;
  const labels = [...tiptapHtmlToMarkdown(awkward, { footnotes: true }).matchAll(/\[\^([^\]]+)\](?!:)/g)]
    .map((match) => match[1]);
  assert(
    labels.join(',') === '1,2,dup,dup-4',
    `unsafe, empty or duplicated ids did not get distinct labels: ${labels.join(',')}`,
  );
  assert(isFootnoteLabel('n1abc_x1y2z3') && isFootnoteLabel('1') && isFootnoteLabel('note-a'), 'a safe label was refused');
  assert(!isFootnoteLabel('') && !isFootnoteLabel('a b') && !isFootnoteLabel('x]y'), 'an unsafe label was accepted');
}

// ── (b) Markdown → HTML ─────────────────────────────────────────────────────

export function testFootnoteBridgeMarkdownToHtml(): void {
  const markdown = [
    '# Salt',
    '',
    'She left[^1] at dawn, and **never[^note-b]** came back.',
    '',
    '- a list item[^1]',
    '',
    '`code[^1] stays code`',
    '',
    '```',
    '[^1]: inside a fence this is code, not a note',
    '```',
    '',
    '[^orphan]: a definition nobody references',
    '[^1]: A note with "quotes", <angles> & an ampersand',
    '    and a second line',
    '',
    '    and a third after a blank',
    '[^note-b]: Second note',
    'A last paragraph.',
  ].join('\n');
  const html = markdownToTiptapHtml(markdown, { footnotes: true });

  const noteOne = 'A note with "quotes", <angles> & an ampersand\nand a second line\n\nand a third after a blank';
  assert(
    html.includes(`<p>She left${REF('1', noteOne)} at dawn, and <strong>never${REF('note-b', 'Second note')}</strong> came back.</p>`),
    `the references did not become the node with the escaped note text:\n${html}`,
  );
  assert(html.includes('<h1>Salt</h1>'), 'the heading was lost');
  assert(html.includes('<p>A last paragraph.</p>'), 'the paragraph after the definitions was lost');
  assert(!html.replace(/<code>.*?<\/code>/gs, '').includes('[^'), `a footnote marker survived as prose:\n${html}`);
  assert(!html.includes('orphan') && !html.includes('nobody references'), 'a definition without a reference was written out');
  assert(html.includes('<code>code[^1] stays code</code>'), 'a reference inside a code span was converted');
  assert(html.includes('<pre><code>[^1]: inside a fence this is code, not a note</code></pre>'), 'a definition inside a fence was lifted');

  // Two references to one label: two notes with the same text, the second
  // under a fresh id, so each answers to its own id in the panel.
  const notes = extractFootnotesFromHtml(html);
  assert(notes.length === 3, `expected three notes, got ${notes.length}: ${JSON.stringify(notes)}`);
  assert(notes[0].id === '1' && notes[0].text === noteOne, 'the first note lost its label-as-id or its text');
  assert(notes[1].id === 'note-b' && notes[1].text === 'Second note', 'a hyphenated label was not used as the id');
  assert(notes[2].id !== '1' && notes[2].text === noteOne, 'the second reference to a label did not get its own id with the same text');

  // A reference nobody defined is an empty note, not a lost marker.
  const dangling = markdownToTiptapHtml('Word[^99].', { footnotes: true });
  assert(dangling === `<p>Word${REF('99', '')}.</p>`, `a reference without a definition was not kept as an empty note: ${dangling}`);

  // Without the option nothing changes: the copilot's chat bubbles and every
  // non-manuscript body keep `[^1]` as the text it always was.
  const asText = markdownToTiptapHtml('Word[^1].\n\n[^1]: note');
  assert(asText === '<p>Word[^1].</p><p>[^1]: note</p>', `footnotes were converted without being asked: ${asText}`);

  // Reserved ids: a label already used by the body being appended to is not
  // reused, everything else keeps its label.
  const reserved = markdownToTiptapHtml('A[^1] B[^2]\n\n[^1]: one\n[^2]: two', { footnotes: true, reservedFootnoteIds: ['1'] });
  const reservedNotes = extractFootnotesFromHtml(reserved);
  assert(reservedNotes[0].id !== '1' && reservedNotes[0].text === 'one', 'a reserved id was handed out again');
  assert(reservedNotes[1].id === '2', 'an unreserved label lost its id');

  // The sanitizer keeps what the node needs, and the note text is not prose.
  const stored = sanitizeRichHtml(html);
  assert(extractFootnotesFromHtml(stored).length === 3 && extractFootnotesFromHtml(stored)[0].text === noteOne, 'the sanitizer damaged the converted notes');
  // 28 words of prose (the code span and the fence count, the notes do not).
  assert(countWords(html) === 28 && countWords(stored) === 28, `note text was counted as words: ${countWords(html)} / ${countWords(stored)}`);
}

// ── (c) Round trip ──────────────────────────────────────────────────────────

export function testFootnoteBridgeRoundTripKeepsIdsAndTexts(): void {
  const markdown = tiptapHtmlToMarkdown(CHAPTER_HTML, { footnotes: true });
  const back = sanitizeRichHtml(markdownToTiptapHtml(markdown, { footnotes: true }));
  const before = extractFootnotesFromHtml(CHAPTER_HTML);
  const after = extractFootnotesFromHtml(back);
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    `ids, texts or order changed on the round trip:\n${JSON.stringify(before)}\n${JSON.stringify(after)}`,
  );
  assert(back.includes(`The harbour${REF('n1abc_x1y2z3', NOTE_ONE)} at dawn.`), `the reference moved on the round trip:\n${back}`);
  assert(back.includes(`<strong>ropes${REF('n2def_a4b5c6', NOTE_TWO)}</strong>`), `the reference inside the bold moved on the round trip:\n${back}`);
  // And the Markdown of the round-tripped body is the Markdown it came from.
  assert(tiptapHtmlToMarkdown(back, { footnotes: true }) === markdown, 'the second trip out differs from the first');
}

// ── (c′) Prose that looks like the syntax, and the converter's own sentinel ──

/**
 * A `[^…]` the writer typed, a line that reads like a definition, a
 * reference inside a code span, and the converter's internal placeholder
 * typed into the prose: none of them may gain, lose or duplicate a note.
 */
export function testFootnoteBridgeLiteralSyntaxSurvives(): void {
  const notesOf = (html: string) => extractFootnotesFromHtml(html).map((note) => [note.id, note.text]);
  const roundTrip = (html: string) => sanitizeRichHtml(markdownToTiptapHtml(tiptapHtmlToMarkdown(html, { footnotes: true }), { footnotes: true }));

  // A literal reference in the prose is escaped on the way out and stays text on the way back.
  const literal = `<p>lit [^mtk_1] ${REF('mtk_1', 'x')}</p>`;
  const literalMd = tiptapHtmlToMarkdown(literal, { footnotes: true });
  assert(literalMd.startsWith('lit \\[^mtk_1] [^mtk_1]'), `the literal [^ was not escaped in the Markdown: ${JSON.stringify(literalMd)}`);
  const literalBack = roundTrip(literal);
  assert(literalBack === literal, `a literal [^id] in the prose changed on the round trip:\n${literal}\n${literalBack}`);
  assert(JSON.stringify(notesOf(literalBack)) === JSON.stringify([['mtk_1', 'x']]), `the literal reference became a note: ${JSON.stringify(notesOf(literalBack))}`);

  // A paragraph that reads like a definition line is prose, not a note.
  const fakeDefinition = `<p>a${REF('mtk_1', 'x')}</p><p>[^mtk_1]: fake</p>`;
  const fakeBack = roundTrip(fakeDefinition);
  assert(fakeBack === fakeDefinition, `a paragraph shaped like a definition was read as one:\n${fakeDefinition}\n${fakeBack}`);
  assert(JSON.stringify(notesOf(fakeBack)) === JSON.stringify([['mtk_1', 'x']]), `the note's text was taken from the fake definition: ${JSON.stringify(notesOf(fakeBack))}`);

  // A reference inside <code> is written after the code span, not inside it, so it comes back as a note.
  const inCode = `<p><code>c${REF('mtk_1', 'x')}</code> d</p>`;
  const inCodeMd = tiptapHtmlToMarkdown(inCode, { footnotes: true });
  assert(inCodeMd.startsWith('`c`[^mtk_1] d'), `the reference stayed inside the code span: ${JSON.stringify(inCodeMd)}`);
  const inCodeBack = roundTrip(inCode);
  assert(inCodeBack === `<p><code>c</code>${REF('mtk_1', 'x')} d</p>`, `a reference inside code was lost on the round trip:\n${inCodeBack}`);
  // And a `[^` that genuinely is code is left alone: the parser never reads references there.
  const codeLiteral = `<p><code>[^1]</code>${REF('mtk_1', 'x')}</p>`;
  assert(roundTrip(codeLiteral) === codeLiteral, `a [^ inside code was escaped or converted:\n${roundTrip(codeLiteral)}`);

  // The converter's own placeholder, typed into the prose, is not a handle on a lifted note.
  const injected = markdownToTiptapHtml('x %%WHLIFT0%% y[^1]\n\n[^1]: secret', { footnotes: true });
  assert(injected.includes('x %%WHLIFT0%% y'), `the literal placeholder text was not kept: ${injected}`);
  assert(JSON.stringify(notesOf(injected)) === JSON.stringify([['1', 'secret']]), `the placeholder duplicated or lost the note: ${JSON.stringify(notesOf(injected))}`);
  const privateUse = markdownToTiptapHtml('x 0 y[^1]\n\n[^1]: secret', { footnotes: true });
  assert(JSON.stringify(notesOf(privateUse)) === JSON.stringify([['1', 'secret']]) && !privateUse.includes(''), `the sentinel characters themselves reached a lifted note: ${privateUse}`);
}

// ── (d) The bridge's own handlers, against Dexie ────────────────────────────

export async function testFootnoteBridgeAppendLeavesExistingNotesAlone(): Promise<void> {
  const projectId = 'fn-bridge-project';
  await putProject(projectId, 'Footnotes across the bridge');
  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> => TOOL_HANDLERS[tool](args);
  const idOf = (result: unknown): string => String((result as { id: string }).id);

  // A chapter whose second note was created under the label a model would
  // pick first, so the append below has a collision to avoid.
  const existingHtml = `<p>Prose${REF('n1abc_x1y2z3', 'kept as it was')} here.</p><p>More${REF('1', 'also kept')}.</p>`;
  const writingId = idOf(await call('wh_create_writing', { projectId, title: 'Salt', content: 'placeholder' }));
  await db.writings.update(writingId, { content: existingHtml, wordCount: countWords(existingHtml) });
  const original = await db.writings.get(writingId);
  assert(original?.content === existingHtml, 'the fixture did not land');

  // wh_get_writing shows the notes as Markdown with their ids.
  const read = (await call('wh_get_writing', { id: writingId })) as { content: string };
  assert(
    read.content === 'Prose[^n1abc_x1y2z3] here.\n\nMore[^1].\n\n[^n1abc_x1y2z3]: kept as it was\n[^1]: also kept',
    `wh_get_writing did not return the notes as Markdown:\n${JSON.stringify(read.content)}`,
  );

  // The executor path the app and the copilot actually take.
  const reply = await runBridgeTool('wh_append_writing', {
    id: writingId,
    content: 'Later[^1] still.\n\n[^1]: a new note under a label the chapter already uses',
  });
  assert(reply.ok, `wh_append_writing failed: ${reply.error}`);
  const grown = await db.writings.get(writingId);
  assert(grown, 'the writing vanished');
  assert(grown.content.startsWith(existingHtml), `the append re-serialised or renumbered the existing body:\n${grown.content}`);
  const notes = extractFootnotesFromHtml(grown.content);
  assert(notes.length === 3, `expected three notes after the append, got ${notes.length}`);
  assert(notes[0].id === 'n1abc_x1y2z3' && notes[0].text === 'kept as it was', 'the first existing note changed');
  assert(notes[1].id === '1' && notes[1].text === 'also kept', 'the second existing note changed');
  assert(notes[2].id !== '1' && notes[2].text === 'a new note under a label the chapter already uses', 'the appended note collided with, or lost, its text');
  assert(new Set(notes.map((note) => note.id)).size === 3, 'two notes share an id after the append');
  assert(grown.content.endsWith(`<p>Later${REF(notes[2].id, notes[2].text)} still.</p>`), `the addition is not what was appended:\n${grown.content}`);
  assert(grown.wordCount === countWords(grown.content) && grown.wordCount === 5, `the word count counted a note: ${grown.wordCount}`);

  // wh_update_writing with the Markdown wh_get_writing gave keeps every id.
  const again = (await call('wh_get_writing', { id: writingId })) as { content: string };
  const updated = await runBridgeTool('wh_update_writing', { id: writingId, content: again.content.replace('Prose', 'Prose, revised,') });
  assert(updated.ok, `wh_update_writing failed: ${updated.error}`);
  const rewritten = extractFootnotesFromHtml((await db.writings.get(writingId))?.content ?? '');
  assert(
    JSON.stringify(rewritten) === JSON.stringify(notes),
    `a whole-body update through the bridge changed the notes:\n${JSON.stringify(notes)}\n${JSON.stringify(rewritten)}`,
  );

  await db.writingSnapshots.where('writingId').equals(writingId).delete();
  await db.writings.delete(writingId);
  await db.projects.delete(projectId);
}

// ── (e) Search ──────────────────────────────────────────────────────────────

export async function testFootnoteBridgeSearchFindsNoteText(): Promise<void> {
  const projectId = 'fn-search-project';
  const now = Date.now();
  const ids = ['fn-search-noted', 'fn-search-plain'];
  await db.writings.bulkPut([
    {
      id: ids[0], projectId, title: 'Salt', status: 'draft', chapter: 1, tags: [], createdAt: now, updatedAt: now,
      content: `<p>Plain prose about the harbour.${REF('s1', 'Only the note mentions the xylophone > and it is found')}</p>`,
      wordCount: 5,
    },
    {
      id: ids[1], projectId, title: 'Iron', status: 'draft', chapter: 2, tags: [], createdAt: now, updatedAt: now,
      content: '<p>The harbour again, no notes.</p>',
      wordCount: 5,
    },
  ]);
  invalidateProjectSearchIndex();
  try {
    const hits = await searchProjectContent('xylophone', projectId);
    assert(hits.length === 1 && hits[0].id === ids[0], `a word only a note says was not found: ${JSON.stringify(hits)}`);
    assert(hits[0].snippet.includes('xylophone') && hits[0].snippet.includes('Only the note'), `the snippet does not quote the note: ${hits[0].snippet}`);
    assert(!hits[0].snippet.includes('data-footnote') && !hits[0].snippet.includes('"'), `the snippet leaked markup: ${hits[0].snippet}`);

    // Prose still matches, both chapters, and the prose hit outranks the note.
    const harbour = await searchProjectContent('harbour', projectId);
    assert(harbour.length === 2, `prose stopped matching beside a note: ${JSON.stringify(harbour)}`);
    const snippet = harbour.find((hit) => hit.id === ids[0])?.snippet ?? '';
    assert(snippet.startsWith('Plain prose about the harbour.'), `the prose snippet was cut short by the note: ${snippet}`);
  } finally {
    await db.writings.bulkDelete(ids);
    invalidateProjectSearchIndex();
  }
}

// ── (f) Project-wide replace ────────────────────────────────────────────────

export async function testFootnoteBridgeReplaceRewritesInsideNotes(): Promise<void> {
  const { applyProjectReplace, forgetReplaceUndo, scanProjectReplace } = await import('@/services/projectReplace');
  const projectId = 'fn-replace-project';
  const now = Date.now();
  const id = 'fn-replace-writing';
  const html = `<p>Marta in the prose.${REF('r1', 'Marta in the note, and Marta again')} End.${REF('r2', 'No name here')}</p>`;
  await db.writings.put({ id, projectId, title: 'Salt', status: 'draft', chapter: 1, tags: [], createdAt: now, updatedAt: now, content: html, wordCount: 5 });
  try {
    const plan = await scanProjectReplace({
      projectId,
      term: 'Marta',
      options: { caseSensitive: false, wholeWord: false, matchDiacritics: false },
      scopes: ['writings'],
    });
    assert(plan.total === 3, `expected the prose occurrence and the two in the note, got ${plan.total}`);
    const noteOccurrences = plan.documents[0]?.occurrences.filter((occurrence) => occurrence.fieldLabelKey === 'projectReplace.field.footnote') ?? [];
    assert(noteOccurrences.length === 2 && noteOccurrences[0].fieldLabelName === '1', `the note occurrences are not labelled with the note number: ${JSON.stringify(noteOccurrences)}`);
    assert(noteOccurrences[0].before === '' && noteOccurrences[0].match === 'Marta' && noteOccurrences[0].after === ' in the note, and Marta again', 'the note occurrence lost its line of context');

    // Excluding one of the two note occurrences rewrites the other alone.
    const outcome = await applyProjectReplace(plan, 'Clara', {
      excludedDocuments: new Set<string>(),
      excludedOccurrences: new Set<string>([noteOccurrences[1].key]),
    });
    assert(outcome.replaced === 2, `expected two rewrites, got ${outcome.replaced}`);
    const after = (await db.writings.get(id))?.content ?? '';
    assert(
      after === `<p>Clara in the prose.${REF('r1', 'Clara in the note, and Marta again')} End.${REF('r2', 'No name here')}</p>`,
      `the note was not rewritten in place, or something else moved:\n${after}`,
    );
    forgetReplaceUndo(outcome.batchId);

    // The DOM route for the attribute itself: unknown ids ignored, untouched body returned as is.
    assert(withFootnoteTexts(html, new Map([['nope', 'x']])) === html, 'an unknown id changed the body');
    assert(withFootnoteTexts('<p>plain</p>', new Map([['r1', 'x']])) === '<p>plain</p>', 'a body without notes was re-serialised');
  } finally {
    await db.writingSnapshots.where('writingId').equals(id).delete();
    await db.writings.delete(id);
  }
}

export async function runFootnoteBridgeTests(): Promise<string[]> {
  const passed: string[] = [];
  testFootnoteBridgeHtmlToMarkdown();
  passed.push('Footnotes → Markdown: [^id] references and a definitions block');
  testFootnoteBridgeMarkdownToHtml();
  passed.push('Markdown → footnotes: definitions, continuation lines, escaping, dangling and orphan cases');
  testFootnoteBridgeRoundTripKeepsIdsAndTexts();
  passed.push('Footnotes survive the bridge round trip with their ids');
  testFootnoteBridgeLiteralSyntaxSurvives();
  passed.push('Literal [^…] prose, definition-shaped lines, references in code and the lift sentinel survive the bridge');
  await testFootnoteBridgeAppendLeavesExistingNotesAlone();
  passed.push('wh_get/append/update_writing carry footnotes; append leaves existing notes alone');
  await testFootnoteBridgeSearchFindsNoteText();
  passed.push('Search finds a word only a footnote says');
  await testFootnoteBridgeReplaceRewritesInsideNotes();
  passed.push('Project-wide replace rewrites inside footnotes');
  return passed;
}
