// Pure logic of beta reading: text blocks, the package file, anchors, the
// response file, idempotent import planning and the word diff.
//   node scripts/run-beta-reading-tests.mjs
import assert from 'node:assert/strict';
import { makeAnchor, resolveAnchor } from '../src/services/betaReading/anchor';
import { chapterChange, chapterTextFromHtml, countAnchorStates, evaluateComment, planImport } from '../src/services/betaReading/core';
import { buildBetaPackage, scrubChapterHtml } from '../src/services/betaReading/package';
import { BetaFormatError, commentIdFor, parseResponse, responseIdFor } from '../src/services/betaReading/response';
import { chapterHash, diffText, hashText, htmlToText, splitBlocks } from '../src/services/betaReading/text';
import { FORMAT_VERSION, RESPONSE_FORMAT, type BetaCommentRow, type ReaderResponse } from '../src/services/betaReading/types';

const CHAPTER = [
  '<h2>El faro</h2>',
  '<p>La lluvia caía sobre el puerto y nadie salió a mirar el mar aquella noche.</p>',
  '<p>Marta subió los ciento doce escalones con la linterna apagada, contando en voz baja.</p>',
  '<ul><li>una cuerda</li><li>un cuchillo</li></ul>',
  '<p>En lo alto el viento arrancó la puerta de sus goznes y la luz se apagó para siempre.</p>',
].join('');

function response(overrides: Partial<ReaderResponse> = {}): ReaderResponse {
  return {
    format: RESPONSE_FORMAT, formatVersion: FORMAT_VERSION, packageId: 'beta_x', packageVersion: 1,
    reader: 'Lucía', exportedAt: '2026-10-01T10:00:00.000Z',
    chapters: [{ chapterId: 'w1', contentHash: 'abc' }], reactions: { w1: ['love', 'nonsense'] },
    comments: [], ...overrides,
  };
}

function comment(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', chapterId: 'w1', quote: 'nadie salió a mirar el mar', prefix: 'sobre el puerto y ', suffix: ' aquella noche.',
    paragraph: 1, text: 'Me encanta esta frase', createdAt: '2026-10-01T09:00:00.000Z', ...over,
  };
}

export function runBetaReadingLogicTests(): string[] {
  const passed: string[] = [];
  const test = (name: string, body: () => void) => { body(); passed.push(name); };

  test('text: blocks are the top-level elements, br and li keep words apart, entities decode', () => {
    const blocks = splitBlocks(CHAPTER);
    assert.equal(blocks.length, 5);
    assert.equal(blocks[0].text, 'El faro');
    assert.equal(blocks[3].text, 'una cuerda un cuchillo');
    assert.equal(htmlToText('<p>uno<br>dos &amp; tres&nbsp;cuatro &#233;</p>'), 'uno dos & tres cuatro é');
    assert.equal(splitBlocks('texto suelto<p>dentro</p>más suelto').map(block => block.text).join('|'), 'texto suelto|dentro|más suelto');
    assert.equal(splitBlocks('<p></p><p> </p><p>x</p>').length, 1);
    assert.equal(splitBlocks('<p>sin cerrar').length, 1, 'unbalanced markup does not throw');
    assert.equal(splitBlocks('<blockquote><p>a</p><p>b</p></blockquote><p>c</p>').length, 2, 'nesting stays inside one block');
  });

  test('text: the hash ignores whitespace and tracks words', () => {
    assert.equal(hashText('a'), hashText('a'));
    assert.notEqual(hashText('a'), hashText('b'));
    assert.equal(chapterHash('uno dos\ntres'), chapterHash('uno   dos tres'));
    assert.notEqual(chapterHash('uno dos'), chapterHash('uno dos tres'));
    assert.match(hashText('x'), /^[0-9a-f]{14}$/);
  });

  test('package: one self-contained page with a versioned manifest', () => {
    const built = buildBetaPackage({
      packageId: 'beta_1', version: 3, projectId: 'p1', projectTitle: 'Mi <novela> "larga"', createdAt: Date.UTC(2026, 9, 1),
      locale: 'es',
      chapters: [
        { writingId: 'w1', title: 'El faro', html: CHAPTER },
        { writingId: 'w2', title: 'La costa', html: '<p>Otro capítulo.</p>' },
      ],
    });
    assert.equal(built.manifest.version, 3);
    assert.equal(built.manifest.packageId, 'beta_1');
    assert.equal(built.manifest.format, 'writers-hoard.beta-package');
    assert.deepEqual(built.manifest.chapters.map(chapter => chapter.chapterId), ['w1', 'w2']);
    assert.equal(built.manifest.chapters[0].contentHash, chapterHash(built.manifest.chapters[0].text));
    assert.ok(built.manifest.chapters[0].text.includes('Marta subió los ciento doce escalones'));
    assert.ok(built.manifest.chapters[0].wordCount > 30);
    // Nothing external, nothing escaped wrongly, CSP present.
    assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(built.html), 'no external URL');
    assert.ok(!/<link\b|@import|url\(\s*["']?(https?:|\/\/)/i.test(built.html), 'no external stylesheet');
    assert.ok(built.html.includes("default-src 'none'"));
    assert.ok(built.html.includes('Mi &lt;novela&gt; &quot;larga&quot;'));
    const script = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(built.html)?.[1] ?? '';
    assert.ok(script.length > 1000 && !script.includes('__LABELS__') && !script.includes('__REACTIONS__'));
    assert.doesNotThrow(() => new Function(script), 'the reader script parses');
    const manifestJson = /<script type="application\/json" id="wh-manifest">([\s\S]*?)<\/script>/.exec(built.html)?.[1] ?? '';
    assert.equal(JSON.parse(manifestJson).chapters.length, 2);
    // Deterministic: the same input renders the same bytes (what "download again" relies on).
    const again = buildBetaPackage({
      packageId: 'beta_1', version: 3, projectId: 'p1', projectTitle: 'Mi <novela> "larga"', createdAt: Date.UTC(2026, 9, 1), locale: 'es',
      chapters: built.chapters.map(chapter => ({ writingId: chapter.chapterId, title: chapter.title, html: chapter.html })),
    });
    assert.equal(again.html, built.html);
  });

  test('package: active content and remote images never reach the file', () => {
    const dirty = '<p onclick="x()">hola <script>alert(1)</script><a href="javascript:alert(1)">link</a> <a href="https://x.example/">web</a></p>'
      + '<p><img src="https://x.example/a.png" alt="r"> <img src="data:image/png;base64,AAAA" alt="ok"></p><iframe src="https://x.example"></iframe><form><input></form>';
    const clean = scrubChapterHtml(dirty);
    assert.ok(!/<script|onclick|javascript:|iframe|<form|<input|https:/i.test(clean), clean);
    assert.ok(clean.includes('data:image/png'));
    const built = buildBetaPackage({ packageId: 'b', version: 1, projectId: 'p', projectTitle: 'T', createdAt: 0, locale: 'en', chapters: [{ writingId: 'w', title: 'C', html: dirty }] });
    assert.ok(!/alert\(1\)/.test(built.html));
  });

  test('anchor: a verbatim quote attaches, the best copy wins', () => {
    const blocks = splitBlocks(CHAPTER).map(block => block.text);
    const anchor = makeAnchor(blocks, 1, blocks[1].indexOf('nadie salió'), blocks[1].indexOf(' aquella'));
    assert.equal(anchor.quote, 'nadie salió a mirar el mar');
    assert.equal(anchor.prefix, 'La lluvia caía sobre el puerto y ');
    const match = resolveAnchor(blocks, anchor);
    assert.deepEqual([match.state, match.paragraph, match.score], ['attached', 1, 1]);
    // Two copies of the quote: the one with the matching surroundings wins, wherever it moved to.
    const twice = ['Dijo: no hay nada. Y se fue.', 'Era tarde y dijo: no hay nada. Pero volvió.'];
    const pick = resolveAnchor(twice, { quote: 'no hay nada', prefix: 'Era tarde y dijo: ', suffix: '. Pero volvió.', paragraph: 0 });
    assert.equal(pick.paragraph, 1);
    // Added paragraphs above shift the index; the quote is still found.
    assert.equal(resolveAnchor(['nuevo', 'otro', ...blocks], anchor).paragraph, 3);
  });

  test('anchor: a reworded quote is "moved", a deleted one is "orphaned"', () => {
    const blocks = splitBlocks(CHAPTER).map(block => block.text);
    const anchor = makeAnchor(blocks, 2, blocks[2].indexOf('Marta subió'), blocks[2].indexOf(', contando'));
    const reworded = blocks.map(text => text.replace('subió los ciento doce escalones', 'subió los ciento trece escalones'));
    const moved = resolveAnchor(reworded, anchor);
    assert.equal(moved.state, 'moved');
    assert.equal(moved.paragraph, 2);
    assert.ok(moved.score >= 0.7 && moved.score < 1);
    const wordsChanged = resolveAnchor(blocks.map(text => text.replace('contando en voz baja', 'contando para sí')), makeAnchor(blocks, 2, blocks[2].indexOf('Marta subió'), blocks[2].indexOf(', contando')));
    assert.equal(wordsChanged.state, 'attached', 'text around the quote may change freely');
    const gone = resolveAnchor(blocks.filter((_, i) => i !== 2), anchor);
    assert.equal(gone.state, 'orphaned');
    assert.equal(gone.paragraph, null);
    const rewritten = resolveAnchor(['Todo es distinto ahora y nada se parece a lo que hubo antes.'], anchor);
    assert.equal(rewritten.state, 'orphaned');
    // A very short quote is never guessed at.
    assert.equal(resolveAnchor(['el mar'], { quote: 'el mat', prefix: '', suffix: '', paragraph: 0 }).state, 'orphaned');
    assert.equal(resolveAnchor(blocks, { quote: '', prefix: '', suffix: '', paragraph: 0 }).state, 'orphaned');
  });

  test('core: evaluating against a chapter, a missing chapter and a whole-chapter comment', () => {
    const chapter = chapterTextFromHtml(CHAPTER);
    const anchor = { quote: 'ciento doce escalones', prefix: '', suffix: '', paragraph: 2 };
    assert.equal(evaluateComment(anchor, chapter).anchorState, 'attached');
    assert.equal(evaluateComment(anchor, chapter).evaluatedHash, chapter.hash);
    assert.equal(evaluateComment(anchor, null).anchorState, 'orphaned');
    assert.equal(evaluateComment({ quote: '', prefix: '', suffix: '', paragraph: 0 }, chapter).anchorState, 'attached');
    assert.deepEqual(countAnchorStates([{ anchorState: 'moved' }, { anchorState: 'moved' }, { anchorState: 'orphaned' }]), { attached: 0, moved: 2, orphaned: 1 });
  });

  test('response: strangers\' files are validated, clipped and cleaned', () => {
    assert.throws(() => parseResponse('not json'), (error: unknown) => error instanceof BetaFormatError && error.code === 'not-json');
    assert.throws(() => parseResponse({ format: 'other' }), (error: unknown) => error instanceof BetaFormatError && error.code === 'wrong-format');
    assert.throws(() => parseResponse({ ...response(), formatVersion: 99 }), (error: unknown) => error instanceof BetaFormatError && error.code === 'wrong-version');
    assert.throws(() => parseResponse({ ...response(), packageId: '' }), BetaFormatError);
    assert.throws(() => parseResponse({ ...response(), packageVersion: 0 }), BetaFormatError);
    const { response: parsed, dropped } = parseResponse({
      ...response({ reader: '  Lucía\u0000   Pérez ' }),
      comments: [comment(), comment({ text: '   ' }), comment({ chapterId: '' }), 'junk', comment({ quote: 'x'.repeat(5000), text: 'y'.repeat(9000), paragraph: -4 })],
    });
    assert.equal(parsed.reader, 'Lucía Pérez');
    assert.equal(parsed.comments.length, 2);
    assert.equal(dropped, 3);
    assert.equal(parsed.comments[1].quote.length, 600);
    assert.equal(parsed.comments[1].text.length, 5000);
    assert.equal(parsed.comments[1].paragraph, 0);
    assert.deepEqual(parsed.reactions, { w1: ['love'] });
    assert.equal(parseResponse(JSON.stringify(response({ comments: [comment()] }))).response.comments.length, 1);
  });

  test('import plan: ids are stable, a second import adds nothing, a later file adds only what is new', () => {
    const chapters = new Map([['w1', chapterTextFromHtml(CHAPTER)]]);
    const file = response({ comments: [comment(), comment({ id: 'r2', quote: 'ciento doce escalones', text: 'Cuenta bien', paragraph: 2, prefix: '', suffix: '' })] });
    const first = planImport('p1', file, new Set(), chapters, 1000);
    assert.equal(first.fresh.length, 2);
    assert.equal(first.duplicateIds.length, 0);
    assert.deepEqual(first.fresh.map(row => row.anchorState), ['attached', 'attached']);
    const stored = new Set(first.fresh.map(row => row.id));
    const second = planImport('p1', file, stored, chapters, 2000);
    assert.equal(second.fresh.length, 0);
    assert.equal(second.duplicateIds.length, 2);
    assert.deepEqual(second.allIds, first.allIds);
    // The reader's own ids are irrelevant: the same words get the same id.
    const renamed = response({ comments: file.comments.map(item => ({ ...item, id: `other-${item.id}` })) });
    assert.deepEqual(planImport('p1', renamed, new Set(), chapters, 3).allIds, first.allIds);
    // A later export with one more comment adds exactly one.
    const later = response({ comments: [...file.comments, comment({ id: 'r3', text: 'Otra cosa', quote: 'Marta', paragraph: 2 })] });
    assert.equal(planImport('p1', later, stored, chapters, 4).fresh.length, 1);
    // The same comment text in another project is another row; the same twice in one file is one.
    assert.notEqual(commentIdFor('p2', file, file.comments[0]), commentIdFor('p1', file, file.comments[0]));
    assert.equal(planImport('p1', response({ comments: [comment(), comment()] }), new Set(), chapters, 5).fresh.length, 1);
    assert.equal(responseIdFor('p1', file), responseIdFor('p1', { ...file, reader: 'LUCÍA' }));
    assert.notEqual(responseIdFor('p1', file), responseIdFor('p1', { ...file, reader: 'Otro' }));
    // A comment on a chapter that is not in the project is kept, orphaned.
    const stray = planImport('p1', response({ comments: [comment({ chapterId: 'gone' })] }), new Set(), chapters, 6);
    assert.equal(stray.fresh[0].anchorState, 'orphaned');
    const rows: BetaCommentRow[] = stray.fresh;
    assert.equal(rows[0].writingId, 'gone');
  });

  test('re-import after the chapter changed: moved and orphaned are told apart', () => {
    const file = response({ comments: [
      comment(),
      comment({ id: 'r2', quote: 'Marta subió los ciento doce escalones', text: 'Cuenta bien', paragraph: 2, prefix: '', suffix: ', contando en voz baja.' }),
      comment({ id: 'r3', quote: 'la luz se apagó para siempre', text: 'Final fuerte', paragraph: 4, prefix: 'sus goznes y ', suffix: '.' }),
    ] });
    const before = new Map([['w1', chapterTextFromHtml(CHAPTER)]]);
    const stored = planImport('p1', file, new Set(), before, 1).fresh;
    assert.deepEqual(stored.map(row => row.anchorState), ['attached', 'attached', 'attached']);
    const edited = CHAPTER
      .replace('Marta subió los ciento doce escalones', 'Marta subió los ciento trece escalones')
      .replace('<p>En lo alto el viento arrancó la puerta de sus goznes y la luz se apagó para siempre.</p>', '<p>Arriba todo era silencio.</p>');
    const after = chapterTextFromHtml(edited);
    assert.notEqual(after.hash, before.get('w1')!.hash);
    const states = stored.map(row => evaluateComment(row.anchor, after).anchorState);
    assert.deepEqual(states, ['attached', 'moved', 'orphaned']);
    // Importing again plans no new rows; the stored ones are simply judged again by the caller.
    assert.equal(planImport('p1', file, new Set(stored.map(row => row.id)), new Map([['w1', after]]), 2).fresh.length, 0);
  });

  test('diff: word-level summary of what changed since the package', () => {
    const same = diffText('uno dos tres', 'uno  dos tres');
    assert.equal(same.changed, false);
    assert.equal(same.ratio, 0);
    const d = diffText('La lluvia caía sobre el puerto\nMarta subió', 'La lluvia caía sobre el muelle viejo\nMarta subió deprisa');
    assert.deepEqual([d.added, d.removed], [3, 1]);
    assert.equal(d.changed, true);
    assert.equal(d.changedParagraphs, 2);
    assert.ok(d.ratio > 0 && d.ratio < 1);
    assert.deepEqual([diffText('', 'a b c').added, diffText('a b c', '').removed], [3, 3]);
    assert.equal(diffText('', '').changed, false);
    const big = Array.from({ length: 9000 }, (_, i) => `w${i}`).join(' ');
    assert.equal(diffText(big, big.replace('w4500 ', '')).removed, 1);
    const current = chapterTextFromHtml(CHAPTER);
    assert.deepEqual(chapterChange(current.hash, current.blocks.join('\n'), current), { changed: false, comparable: true, diff: null });
    const changed = chapterChange('old', 'uno dos', current);
    assert.equal(changed.changed, true);
    assert.equal(changed.comparable, true);
    assert.ok(changed.diff && changed.diff.added > 10);
    assert.equal(chapterChange('old', null, current).comparable, false);
    assert.equal(chapterChange('old', 'x', null).changed, true);
  });

  return passed;
}
