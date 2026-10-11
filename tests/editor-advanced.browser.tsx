import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CellSelection } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { createPageLayoutPlugin, getPageCount, pageLayoutKey } from '@/components/editor/pageMode/PageLayout';
import { collectFootnotes } from '@/components/editor/footnotes/footnoteModel';
import { computePageBreaks } from '@/components/editor/pageMode/pagination';
import { testPageModeInEditor, testPaginationPureFitsExactly, testPaginationPureCutsBetweenLines, testPaginationPureOversizedBlockOverflows, testPaginationPureNotesPushALine, testPaginationPureAtomicBlockMovesWhole, testPaginationPureForcedBreak, testPaginationPureMargins, testPageSizes } from './pageMode';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { normalizeColumnWidths } from '@/components/editor/advanced/model';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { createAdvancedExtensions, applyAdvancedFormatting, describeAdvancedDocument, normalizeAdvancedFormatting, normalizeAdvancedHtml, advancedHtmlForInterchange, AdvancedEditorToolbar } from '@/components/editor/advanced';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

export async function testAdvancedEditor(): Promise<string[]> {
  const passed: string[] = [];
  const host = document.createElement('div'); document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: [StarterKit, FootnoteNode, ...createAdvancedExtensions()], content: '<p>Alpha beta gamma</p><p>Second paragraph</p>' });
  const resetContent = (html: string) => { editor.commands.setContent(html); editor.view.dispatch(closeHistory(editor.state.tr)); };
  const run = (name: string, test: () => void) => { test(); passed.push(name); };
  try {
    run('normalizer accepts only supported finite values', () => {
      equal(normalizeAdvancedFormatting({ color: '#Ab12FF', fontSize: 12, indent: 2, lineHeight: 1.5, fontFamily: 'Times New Roman' }), { fontFamily: 'Times New Roman', color: '#ab12ff', fontSize: 12, lineHeight: 1.5, indent: 2 }, 'valid formatting');
      equal(normalizeAdvancedFormatting({ fontSize: Infinity, indent: -1.5, lineHeight: NaN, color: 'url(javascript:alert(1))', fontFamily: 'x;position:fixed', alignment: 'bogus' }), {}, 'invalid values');
      equal(normalizeColumnWidths(Array(65).fill(5000.5)), Array(65).fill(5000.5), 'width dimensions beyond presets');
      equal(normalizeColumnWidths([Infinity]), null, 'nonfinite width');
      equal(normalizeColumnWidths([-1]), null, 'negative width');
      equal(normalizeAdvancedFormatting({ fontSize: 5, lineHeight: 0.75, indent: 1.5 }), { fontSize: 5, lineHeight: 0.75, indent: 1.5 }, 'small valid dimensions');
    });
    run('format outside toolbar presets survives interchange, sanitizer and editor reload', () => {
      const clean = normalizeAdvancedHtml('<p style="line-height:4;margin-left:14.25em"><span style="font-size:96pt">Large</span></p><table><tr><td style="width:5000.5px"><p>Wide</p></td></tr></table>');
      resetContent(clean);
      const html = editor.getHTML();
      assert(html.includes('data-wh-size="96"') && html.includes('data-wh-line-height="4"') && html.includes('data-wh-indent="9.5"') && html.includes('data-wh-colwidth="5000.5"'), html);
      resetContent(normalizeAdvancedHtml(advancedHtmlForInterchange(sanitizeRichHtml(html))));
      equal(editor.getHTML(), html, 'outside-preset roundtrip');
      const wide = normalizeAdvancedHtml('<table><tr><td colspan="65" style="width:6500px"><p>Many columns</p></td></tr></table>');
      assert(wide.includes('data-wh-colwidth="' + Array(65).fill(100).join(',') + '"'), wide);
      resetContent('<p>Alpha beta gamma</p><p>Second paragraph</p>');
    });
    run('range formatting changes only chosen text and paragraphs in one undo', () => {
      const before = editor.getHTML();
      assert(applyAdvancedFormatting(editor, { color: '#112233', highlight: '#ffeeaa', fontFamily: 'serif', fontSize: 18, alignment: 'right', indent: 2, lineHeight: 2, paragraphStyle: 'lead' }, { from: 1, to: 6 }), 'apply');
      const html = editor.getHTML();
      assert(html.includes('data-wh-color="#112233"') && html.includes('data-wh-indent="2"'), html);
      assert(html.includes('text-align: right') || html.includes('text-align:right'), html);
      assert(!describeAdvancedDocument(editor).blocks[1].formatting.alignment, 'untouched paragraph');
      assert(editor.commands.undo(), 'undo'); equal(editor.getHTML(), before, 'single undo restores all');
      assert(editor.commands.redo(), 'redo'); equal(editor.getHTML(), html, 'redo');
    });
    run('sanitizer and editor reload preserve all semantic format attrs', () => {
      const clean = sanitizeRichHtml(editor.getHTML());
      const otherHost = document.createElement('div'); document.body.appendChild(otherHost);
      const other = new Editor({ element: otherHost, extensions: [StarterKit, ...createAdvancedExtensions()], content: clean });
      try { equal(other.getHTML(), editor.getHTML(), 'reload byte stable'); equal(sanitizeRichHtml(clean), clean, 'sanitizer idempotent'); }
      finally { other.destroy(); otherHost.remove(); }
    });
    run('mixed range mark patches preserve other inline attributes', () => {
      applyAdvancedFormatting(editor, { color: '#445566' }, { from: 3, to: 10 });
      const marks = describeAdvancedDocument(editor).marks;
      assert(marks.some(mark => mark.from === 3 && mark.formatting.fontSize === 18 && mark.formatting.color === '#445566'), JSON.stringify(marks));
      assert(marks.some(mark => mark.to === 10 && mark.formatting.color === '#445566' && !mark.formatting.fontSize), JSON.stringify(marks));
    });
    run('invalid ranges leave document and history untouched', () => {
      const before = editor.getHTML();
      for (const range of [{ from: -1, to: 5 }, { from: 4, to: 2 }, { from: 1, to: 999 }, { from: 1.2, to: 4 }]) assert(!applyAdvancedFormatting(editor, { color: '#aaaaaa' }, range), 'invalid range accepted');
      equal(editor.getHTML(), before, 'unchanged');
    });
    run('subscript and superscript exclude each other and footnotes remain their own node', () => {
      applyAdvancedFormatting(editor, { subscript: true }, { from: 1, to: 3 }); assert(editor.getHTML().includes('<sub>'), 'subscript');
      applyAdvancedFormatting(editor, { superscript: true }, { from: 1, to: 3 }); assert(editor.getHTML().includes('<sup>') && !editor.getHTML().includes('<sub>'), 'mutual exclusion');
      resetContent('<p>Text<sup data-footnote-id="n1" data-footnote="A note" class="wh-footnote-ref"></sup> more</p>');
      assert(editor.state.doc.firstChild?.child(1).type.name === 'footnote', editor.getHTML());
    });
    run('collapsed selection stores formatting for new typing', () => {
      resetContent('<p>Test</p>'); editor.commands.setTextSelection(5);
      assert(applyAdvancedFormatting(editor, { color: '#00ff00', subscript: true }), 'stored style');
      editor.commands.insertContent(' inserted'); assert(editor.getHTML().includes('data-wh-color="#00ff00"') && editor.getHTML().includes('<sub>'), editor.getHTML());
    });
    run('manual page break serializes, reloads and undoes', () => {
      resetContent('<p>First</p><p>Last</p>'); editor.commands.setTextSelection(6);
      const before = editor.getHTML(); assert(editor.commands.insertPageBreak(), 'insert page');
      const html = editor.getHTML(); assert(describeAdvancedDocument(editor).pageBreaks.length === 1, html);
      assert(sanitizeRichHtml(html).includes('data-wh-page-break="true"'), 'sanitize page');
      assert(editor.commands.undo(), 'undo page'); equal(editor.getHTML(), before, 'undo page exact');
    });
    run('table add/delete rows and columns and undo', () => {
      resetContent('<p>Before</p>'); editor.commands.setTextSelection(7); assert(editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false }), 'insert table');
      equal(describeAdvancedDocument(editor).tables.map(table => [table.rows, table.columns]), [[2, 2]], 'dimensions');
      assert(editor.commands.addRowAfter(), 'add row'); assert(editor.commands.addColumnAfter(), 'add column');
      equal(describeAdvancedDocument(editor).tables.map(table => [table.rows, table.columns]), [[3, 3]], 'expanded');
      assert(editor.commands.deleteColumn(), 'delete column'); assert(editor.commands.deleteRow(), 'delete row');
      equal(describeAdvancedDocument(editor).tables.map(table => [table.rows, table.columns]), [[2, 2]], 'contracted');
      editor.view.dispatch(closeHistory(editor.state.tr));
      assert(editor.commands.deleteTable(), 'delete table'); equal(describeAdvancedDocument(editor).tables.length, 0, 'deleted');
      assert(editor.commands.undo(), 'undo table'); equal(describeAdvancedDocument(editor).tables.length, 1, 'restored');
    });
    run('table merges and splits a real cell selection', () => {
      resetContent('<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>After</p>');
      const positions: number[] = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions.push(pos); });
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, positions[0], positions[1])));
      assert(editor.commands.mergeCells(), 'merge'); assert(editor.getHTML().includes('colspan="2"'), editor.getHTML());
      equal(describeAdvancedDocument(editor).tables[0].columns, 2, 'merged cells retain grid column count');
      assert(editor.commands.splitCell(), 'split'); assert(!editor.getHTML().includes('colspan="2"'), editor.getHTML());
      assert(editor.commands.toggleHeaderRow(), 'header'); assert(editor.getHTML().includes('<th'), editor.getHTML());
    });
    run('resized table cell widths survive sanitizer and real editor reload', () => {
      editor.commands.setCellAttribute('colwidth', [160]);
      const clean = sanitizeRichHtml(editor.getHTML());
      assert(clean.includes('data-wh-colwidth="160"'), clean);
      const otherHost = document.createElement('div'); document.body.appendChild(otherHost);
      const other = new Editor({ element: otherHost, extensions: [StarterKit, ...createAdvancedExtensions()], content: clean });
      try { assert(other.getHTML().includes('data-wh-colwidth="160"'), other.getHTML()); }
      finally { other.destroy(); otherHost.remove(); }
    });
    run('standard HTML fonts/color/alignment normalize without executable CSS', () => {
      const html = normalizeAdvancedHtml('<p style="font-family:Times New Roman;font-size:16px;color:rgb(18, 52, 86);text-align:center;line-height:1.5;position:fixed;background-image:url(https://example.com/x)">Native text</p><div style="break-after:page"></div>');
      assert(html.includes('data-wh-font="Times New Roman"') && html.includes('data-wh-size="12"') && html.includes('data-wh-color="#123456"') && html.includes('data-wh-align="center"'), html);
      assert(!html.includes('position') && !html.includes('example.com'), html);
      assert(html.includes('data-wh-page-break="true"'), html);
      const interchange = advancedHtmlForInterchange(html); assert(interchange.includes('break-after: page'), interchange);
    });
    run('standard table widths and generic font families import into portable attrs', () => {
      const html = normalizeAdvancedHtml('<p style="font-family:sans-serif">Sans</p><p style="font-family:monospace">Mono</p><table><tbody><tr><td style="width:120pt"><p>Cell</p></td></tr></tbody></table>');
      assert(html.includes('data-wh-font="sans"') && html.includes('data-wh-font="mono"') && html.includes('data-wh-colwidth="160"'), html);
      const output = advancedHtmlForInterchange(html); assert(output.includes('colwidth="160"') && output.includes('width: 160px'), output);
    });
    run('hostile semantic attrs/styles/events are dropped and old HTML sanitizer still strips inline layout', () => {
      const clean = sanitizeRichHtml('<p style="position:fixed;color:red" data-wh-indent="-1" data-wh-line-height="NaN" onclick="alert(1)"><span data-wh-color="url(javascript:x)" data-wh-font="x;position:fixed" data-wh-size="-1">Safe</span><img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="alert(2)"></p><script>alert(3)</script>');
      assert(!/position|onclick|onerror|javascript|svg\+xml|data-wh-|<script|style=/.test(clean), clean);
    });
    run('whole document boundary ranges apply without creating invalid text selections', () => {
      resetContent('<p>One</p><p>Two</p>'); assert(applyAdvancedFormatting(editor, { alignment: 'justify' }, { from: 0, to: editor.state.doc.content.size }), 'whole doc');
      assert(describeAdvancedDocument(editor).blocks.every(block => block.formatting.alignment === 'justify'), editor.getHTML());
    });
    run('manual break arithmetic uses existing forced cut with no empty leading or trailing page', () => {
      const pagination = computePageBreaks([{ pos: 0, top: 0, bottom: 25 }, { pos: 7, top: 25, bottom: 50, breakBefore: true }], { pageHeight: 1000, reserved: () => 0 });
      equal(pagination.breaks.map(cut => cut.pos), [7], 'one cut'); equal(pagination.totalPages, 2, 'two pages');
      equal(computePageBreaks([{ pos: 0, top: 0, bottom: 25, breakBefore: true }], { pageHeight: 1000, reserved: () => 0 }).totalPages, 1, 'no leading phantom');
    });
    const waitLayout = async () => { for (let frame = 0; frame < 12; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
    const attachPage = () => editor.registerPlugin(createPageLayoutPlugin({ pageSize: 'a4', collectNotes: doc => collectFootnotes(doc).map(note => ({ pos: note.pos, text: note.text })) }));
    resetContent('<p>First<sup data-footnote-id="first" data-footnote="First note"></sup></p><div data-wh-page-break="true"></div><p>Second<sup data-footnote-id="second" data-footnote="Second note"></sup></p>');
    const pagedHtml = editor.getHTML(); attachPage(); await waitLayout();
    assert(getPageCount(editor) === 2, `manual cut expected 2 pages, got ${getPageCount(editor)}`);
    const feet = Array.from(editor.view.dom.querySelectorAll('.wh-page-foot'));
    assert(feet.length === 2 && feet[0].textContent?.includes('First note') && !feet[0].textContent?.includes('Second note') && feet[1].textContent?.includes('Second note'), 'notes assigned to their correct pages');
    const paras = editor.view.dom.querySelectorAll('p'); const top = editor.view.dom.getBoundingClientRect().top;
    assert(paras[1].getBoundingClientRect().top >= top + 1123 + 24, 'second paragraph is on rendered second sheet');
    equal(editor.getHTML(), pagedHtml, 'pagination does not persist decorations'); passed.push('manual break renders real second A4 sheet and keeps page footnotes');
    editor.unregisterPlugin(pageLayoutKey); equal(editor.getHTML(), pagedHtml, 'flow toggle keeps document');
    attachPage(); await waitLayout(); equal(getPageCount(editor), 2, 'retoggle');
    editor.unregisterPlugin(pageLayoutKey);
    resetContent('<p>Before</p>'); editor.commands.setTextSelection(7); editor.commands.insertContent(' after'); const afterTyping = editor.getHTML();
    attachPage(); await waitLayout(); editor.unregisterPlugin(pageLayoutKey); editor.commands.undo(); equal(editor.getHTML(), '<p>Before</p>', 'toggle preserves undo'); editor.commands.redo(); equal(editor.getHTML(), afterTyping, 'toggle preserves redo'); passed.push('page/flow toggle preserves native undo and redo');
    for (const content of ['<div data-wh-page-break="true"></div><p>Start</p>', '<p>End</p><div data-wh-page-break="true"></div>', '<p>End</p><div data-wh-page-break="true"></div><p></p>', '<div data-wh-page-break="true"></div>']) {
      resetContent(content); attachPage(); await waitLayout(); equal(getPageCount(editor), 1, 'edge marker no phantom'); editor.unregisterPlugin(pageLayoutKey);
    }
    passed.push('leading/trailing/empty manual markers do not create phantom sheets');
    run('existing pagination arithmetic regressions', () => { testPageSizes(); testPaginationPureFitsExactly(); testPaginationPureCutsBetweenLines(); testPaginationPureOversizedBlockOverflows(); testPaginationPureNotesPushALine(); testPaginationPureAtomicBlockMovesWhole(); testPaginationPureForcedBreak(); testPaginationPureMargins(); });
    await testPageModeInEditor(); passed.push('existing real page-layout geometry and notes regression');
    resetContent('<p>One</p><p>Two</p>'); editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    applyAdvancedFormatting(editor, { fontFamily: 'Times New Roman', fontSize: 96, lineHeight: 4, indent: 9 });
    const toolbarHost = document.createElement('div'); document.body.appendChild(toolbarHost); const root = createRoot(toolbarHost);
    try {
      await act(async () => { root.render(createElement(AdvancedEditorToolbar, { editor, locale: 'es' })); });
      assert(toolbarHost.querySelector('[aria-label="Fuente"]'), 'Spanish labels');
      equal(toolbarHost.querySelector<HTMLSelectElement>('[aria-label="Tamaño"]')?.value, '96', 'imported font size visible');
      equal(toolbarHost.querySelector<HTMLSelectElement>('[aria-label="Interlineado"]')?.value, '4', 'imported line spacing visible');
      equal(toolbarHost.querySelector<HTMLSelectElement>('[aria-label="Fuente"]')?.value, 'Times New Roman', 'imported font visible'); passed.push('toolbar preserves visible imported values outside presets');
      await act(async () => { toolbarHost.querySelector<HTMLButtonElement>('[aria-label="Aumentar sangría"]')!.click(); });
      assert(describeAdvancedDocument(editor).blocks.some(block => block.formatting.indent === 10), 'indent beyond presets'); passed.push('toolbar increases indentation beyond eight');
      const button = toolbarHost.querySelector<HTMLButtonElement>('[aria-label="Centrar"]')!;
      await act(async () => { button.click(); }); assert(describeAdvancedDocument(editor).blocks.some(block => block.formatting.alignment === 'center'), 'toolbar changed doc'); passed.push('real mounted toolbar controls change the same editor');
      await act(async () => { root.render(createElement(AdvancedEditorToolbar, { editor, locale: 'en' })); }); assert(toolbarHost.querySelector('[aria-label="Font"]'), 'English labels');
      await act(async () => { editor.setEditable(false); }); assert(Array.from(toolbarHost.querySelectorAll('button,select,input')).every(element => (element as HTMLButtonElement).disabled), 'read only toolbar'); passed.push('ES/EN and read-only states');
    } finally { await act(async () => root.unmount()); toolbarHost.remove(); }
  } finally { editor.destroy(); host.remove(); }
  return passed;
}
