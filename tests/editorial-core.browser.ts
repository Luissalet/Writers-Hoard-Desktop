import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { EditorState } from '@tiptap/pm/state';
import { createAdvancedExtensions } from '@/components/editor/advanced';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { createRevisionExtensions, proposeRevision, describeRevisions, setRevisionTracking } from '@/engines/writings/revisions';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { createEditorialExtensions, describeEditorial, describeEditorialDocument, prepareEditorialOperation, upsertEditorialStyle, applyEditorialStyle, removeEditorialStyle, setEditorialSection, insertEditorialCitation, removeEditorialCitation, refreshEditorialReferences, describeEditorialReferences, generateEditorialBibliography, configureEditorialList, normalizeEditorialSection, normalizeEditorialStyle, normalizeEditorialCitation, citationFromReference, DEFAULT_EDITORIAL_SECTION, type EditorialScope, type NamedEditorialStyle } from '@/engines/writings/editorial';

function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value; }
const equal = (a: unknown, b: unknown, label: string) => assert(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
function mount(content: string, book = false) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: [StarterKit.configure({ document: book ? false : {} }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...createEditorialExtensions(), ...(book ? [BookDocument, ChapterHeadingNode.configure({ nodeView: false })] : [])], content });
  return { editor, cleanup: () => { editor.destroy(); host.remove(); } };
}
const style: NamedEditorialStyle = { id: 'style-ñ', name: 'Título <literal>', format: { fontFamily: 'Georgia', fontSize: 21.5, color: '#123456', alignment: 'center', lineHeight: 1.4 }, bold: true };
const source = { id: 'source-ñ', title: 'Historia <b>literal</b>', authors: ['María 😀'], publishedAt: '2026', url: 'https://example.invalid/source', updatedAt: 10 };
function chapterScopes(editor: Editor): EditorialScope[] {
  const headings: { pos: number; size: number }[] = []; editor.state.doc.forEach((node, pos) => { if (node.type.name === 'chapterHeading') headings.push({ pos, size: node.nodeSize }); });
  return headings.map((h, i) => ({ from: h.pos + h.size, to: headings[i + 1]?.pos ?? editor.state.doc.content.size }));
}
export async function testEditorialCore(): Promise<string[]> {
  const passed: string[] = [];
  const run = (name: string, fn: () => void) => { fn(); passed.push(name); };
  run('typed metadata rejects malformed values and preserves Unicode without size caps', () => {
    equal(normalizeEditorialStyle({ ...style, name: 'ñ'.repeat(10000) })?.name.length, 10000, 'unlimited literal name');
    equal(normalizeEditorialSection({ id: 'section', ...DEFAULT_EDITORIAL_SECTION, marginLeft: Infinity }), null, 'finite margins');
    equal(normalizeEditorialSection({ id: 'section', ...DEFAULT_EDITORIAL_SECTION, marginLeft: 500, marginRight: 500 }), null, 'text area');
    equal(normalizeEditorialSection({ id: 'large', ...DEFAULT_EDITORIAL_SECTION, pageWidth: 10000, marginLeft: 2000 })?.pageWidth, 10000, 'no page cap');
    equal(normalizeEditorialCitation({ id: 'bad', sourceId: 'x', label: 2 }), null, 'typed label');
  });
  run('unused named definitions survive HTML reopen without appearing as document text', () => {
    const { editor, cleanup } = mount('<p>Texto 😀</p>'); try {
      assert(upsertEditorialStyle(editor, style).ok, 'save'); equal(editor.state.doc.textContent, 'Texto 😀', 'no metadata text');
      const html = editor.getHTML(); assert(html.includes('hidden'), 'hidden definition'); editor.commands.setContent(html, { emitUpdate: false }); equal(describeEditorial(editor).styles, [style], 'reopen styles');
    } finally { cleanup(); }
  });
  run('named style application preserves links and existing unrelated formatting', () => {
    const { editor, cleanup } = mount('<p><a href="https://example.invalid"><em>Árbol</em></a></p>'); try {
      upsertEditorialStyle(editor, style); const pos = editor.state.doc.child(0).nodeSize + 1;
      assert(applyEditorialStyle(editor, { id: style.id, from: pos, to: pos + 5 }).changed, 'apply');
      const html = editor.getHTML(); assert(html.includes('data-wh-style-id="style-ñ"') && html.includes('<strong>') && html.includes('<em>') && html.includes('<a '), html);
      assert(html.includes('data-wh-color="#123456"') && html.includes('data-wh-align="center"'), 'style attrs');
      editor.commands.undo(); assert(!editor.getHTML().includes('data-wh-style-id='), 'undo apply only'); equal(describeEditorial(editor).styles.length, 1, 'definition kept');
    } finally { cleanup(); }
  });
  run('style editing propagates renamed definition and controlled attributes in one undo', () => {
    const { editor, cleanup } = mount('<p>Uno</p><p>Dos</p>'); try {
      upsertEditorialStyle(editor, style); applyEditorialStyle(editor, { id: style.id, from: 1, to: editor.state.doc.content.size - 1 }); const before = editor.getHTML();
      const edited = { ...style, name: 'Nuevo', bold: false, format: { ...style.format, fontSize: 80 } }; upsertEditorialStyle(editor, edited);
      assert(!editor.getHTML().includes('<strong>') && editor.getHTML().includes('data-wh-size="80"'), 'reapplied'); equal(describeEditorial(editor).styles[0].name, 'Nuevo', 'renamed');
      editor.commands.undo(); equal(editor.getHTML(), before, 'atomic edit undo');
    } finally { cleanup(); }
  });
  run('removing named style detaches but retains visual character and paragraph format', () => {
    const { editor, cleanup } = mount('<p>Texto</p>'); try {
      upsertEditorialStyle(editor, style); applyEditorialStyle(editor, { id: style.id, from: 2, to: 5 });
      removeEditorialStyle(editor, style.id); equal(describeEditorial(editor).styles.length, 0, 'deleted'); assert(!editor.getHTML().includes('data-wh-style-id') && editor.getHTML().includes('data-wh-color') && editor.getHTML().includes('<strong>'), 'format remains');
    } finally { cleanup(); }
  });
  run('heading level and character style preserve semantic paragraphs through HTML reopen', () => {
    const { editor, cleanup } = mount('<p>Heading</p>'); try {
      upsertEditorialStyle(editor, { ...style, headingLevel: 3 }); applyEditorialStyle(editor, { id: style.id, from: 2, to: 5 });
      assert(editor.getHTML().includes('<h3'), 'semantic heading'); const json = editor.getJSON(); editor.commands.setContent(editor.getHTML(), { emitUpdate: false }); equal(editor.getJSON(), json, 'reopen');
    } finally { cleanup(); }
  });
  run('chapter definitions with the same id are scoped before applying and editing', () => {
    const { editor, cleanup } = mount('<h1 data-writing-id="one">Uno</h1><p>Alpha</p><h1 data-writing-id="two">Dos</h1><p>Beta</p>', true); try {
      let scopes = chapterScopes(editor); upsertEditorialStyle(editor, style, scopes[0]); scopes = chapterScopes(editor); upsertEditorialStyle(editor, { ...style, name: 'Other', format: { color: '#abcdef' } }, scopes[1]);
      scopes = chapterScopes(editor); const other = editor.state.doc.cut(scopes[1].from, scopes[1].to).toJSON();
      applyEditorialStyle(editor, { id: style.id, from: scopes[0].from + 2, to: scopes[0].to - 1 }, scopes[0]); upsertEditorialStyle(editor, { ...style, name: 'First updated' }, scopes[0]);
      equal(editor.state.doc.cut(scopes[1].from, scopes[1].to).toJSON(), other, 'other chapter exact'); equal(describeEditorial(editor, scopes[0]).styles[0].name, 'First updated', 'own definition');
      assert(!applyEditorialStyle(editor, { id: style.id, from: scopes[0].from, to: scopes[1].to }, scopes[0]).ok, 'cross chapter rejected');
    } finally { cleanup(); }
  });
  run('section geometry and literal header/footer persist and update with one undo', () => {
    const { editor, cleanup } = mount('<p><strong>Texto</strong></p>'); try {
      const original = editor.getHTML(); const config = { id: 'sec', ...DEFAULT_EDITORIAL_SECTION, header: '<script>literal</script> 😀', footer: 'Pie ñ', start: 'oddPage' as const };
      assert(setEditorialSection(editor, config).changed, 'section'); const inserted = editor.getHTML(); equal(describeEditorial(editor).sections[0].header, config.header, 'literal');
      editor.commands.setContent(inserted, { emitUpdate: false }); equal(describeEditorial(editor).sections[0].start, 'oddPage', 'reopened section');
      setEditorialSection(editor, { ...config, pageWidth: 792, pageHeight: 612, marginLeft: 40 }); editor.commands.undo(); equal(editor.getHTML(), inserted, 'undo update');
      const reopened = mount(original); reopened.cleanup(); assert(editor.getHTML().includes('<strong>Texto</strong>'), 'text preserved');
    } finally { cleanup(); }
  });
  run('section insertion leaves book headings and the next chapter untouched', () => {
    const { editor, cleanup } = mount('<h1 data-writing-id="one">Uno</h1><p>Alpha</p><h1 data-writing-id="two">Dos</h1><p>Beta</p>', true); try {
      const scopes = chapterScopes(editor); const other = editor.state.doc.cut(scopes[1].from - editor.state.doc.child(2).nodeSize).toJSON(); const header = editor.state.doc.firstChild!.toJSON();
      setEditorialSection(editor, { id: 'sec', ...DEFAULT_EDITORIAL_SECTION }, scopes[0]); const next = chapterScopes(editor);
      equal(editor.state.doc.firstChild!.toJSON(), header, 'first heading intact'); equal(editor.state.doc.cut(next[1].from - editor.state.doc.child(3).nodeSize).toJSON(), other, 'second chapter exact');
    } finally { cleanup(); }
  });
  run('citation insertion escapes literal labels and snapshots with durable source identity', () => {
    const { editor, cleanup } = mount('<p>Text 😀</p>'); try {
      const citation = citationFromReference(source, { id: 'c', label: '<b>María 😀</b>', locator: 'p. 2', evidenceId: 'e' });
      assert(insertEditorialCitation(editor, citation, { from: 1, to: 1 }).ok, 'citation'); const html = editor.getHTML(); assert(html.includes('&lt;b&gt;María'), 'literal escaped');
      editor.commands.setContent(html, { emitUpdate: false }); const actual = describeEditorial(editor).citations[0]; equal(actual.sourceId, source.id, 'id retained'); equal(actual.snapshotUpdatedAt, 10, 'snapshot version'); equal(actual.evidenceId, 'e', 'evidence');
    } finally { cleanup(); }
  });
  run('Unicode citation insertion refuses surrogate splits and works beside existing inline atoms', () => {
    const { editor, cleanup } = mount('<p>😀 A</p>'); try {
      const citation = citationFromReference(source, { id: 'c', label: '[1]' }); const before = editor.getHTML();
      assert(!insertEditorialCitation(editor, citation, { from: 2, to: 2 }).ok, 'surrogate split'); equal(editor.getHTML(), before, 'original exact');
      assert(insertEditorialCitation(editor, citation, { from: 1, to: 1 }).ok, 'before emoji'); assert(insertEditorialCitation(editor, { ...citation, id: 'c2' }, { from: 4, to: 4 }).ok, 'after emoji and atom');
    } finally { cleanup(); }
  });
  run('reference notices are informative and explicit refresh retains authored labels', () => {
    const { editor, cleanup } = mount('<p>Text</p>'); try {
      insertEditorialCitation(editor, citationFromReference(source, { id: 'c', label: 'Author literal' }), { from: 1, to: 1 }); const before = editor.getHTML();
      equal(describeEditorialReferences(editor, []).map(n => n.kind), ['missing'], 'missing');
      const changed = { ...source, title: 'Changed', updatedAt: 20, retractedAt: 21 }; equal(describeEditorialReferences(editor, [changed]).map(n => n.kind), ['retracted', 'changed'], 'notices');
      refreshEditorialReferences(editor, [changed]); equal(describeEditorial(editor).citations[0].label, 'Author literal', 'literal untouched'); equal(describeEditorial(editor).citations[0].snapshotUpdatedAt, 20, 'version refreshed'); equal(describeEditorial(editor).citations[0].snapshotRetractedAt, 21, 'retracted snapshot'); editor.commands.undo(); equal(editor.getHTML(), before, 'refresh undo');
    } finally { cleanup(); }
  });
  run('bibliography deduplicates sources and regenerates only dedicated paragraphs', () => {
    const { editor, cleanup } = mount('<p>Text</p><p><strong>Original bibliography heading</strong></p>'); try {
      insertEditorialCitation(editor, citationFromReference(source, { id: 'c1', label: '[1]' }), { from: 1, to: 1 }); insertEditorialCitation(editor, citationFromReference(source, { id: 'c2', label: '[1 p.2]' }), { from: 2, to: 2 });
      const before = editor.getHTML(); assert(generateEditorialBibliography(editor).ok, 'generate'); const first = editor.getHTML(); equal((first.match(/data-wh-bibliography=/g) ?? []).length, 1, 'dedup'); assert(first.includes('Original bibliography heading') && first.includes('Historia &lt;b&gt;literal'), 'literal sources and original preserved');
      generateEditorialBibliography(editor, [{ ...source, title: 'New title' }]); assert(editor.getHTML().includes('New title') && !editor.getHTML().includes('Historia &lt;b&gt;literal&lt;/b&gt;. 2026'), 'regenerated'); editor.commands.undo(); equal(editor.getHTML(), first, 'undo regenerate'); editor.commands.undo(); equal(editor.getHTML(), before, 'undo initial bibliography');
    } finally { cleanup(); }
  });
  run('same citation id in imported chapters refreshes and removes only scoped copies', () => {
    const { editor, cleanup } = mount('<h1 data-writing-id="one">Uno</h1><p>Alpha</p><h1 data-writing-id="two">Dos</h1><p>Beta</p>', true); try {
      let scopes = chapterScopes(editor); const citation = citationFromReference(source, { id: 'same', label: '[1]' }); insertEditorialCitation(editor, citation, { from: scopes[0].from + 1, to: scopes[0].from + 1 }, scopes[0]);
      scopes = chapterScopes(editor); insertEditorialCitation(editor, citation, { from: scopes[1].from + 1, to: scopes[1].from + 1 }, scopes[1]); scopes = chapterScopes(editor);
      const other = editor.state.doc.cut(scopes[1].from, scopes[1].to).toJSON(); refreshEditorialReferences(editor, [{ ...source, updatedAt: 30 }], scopes[0]); generateEditorialBibliography(editor, undefined, scopes[0]); scopes = chapterScopes(editor); removeEditorialCitation(editor, 'same', scopes[0]); scopes = chapterScopes(editor);
      equal(editor.state.doc.cut(scopes[1].from, scopes[1].to).toJSON(), other, 'other citation exact'); equal(describeEditorial(editor, scopes[0]).citations.length, 0, 'own removed');
    } finally { cleanup(); }
  });
  run('list start changes persist HTML and are undoable including zero and negative starts', () => {
    const { editor, cleanup } = mount('<ol start="5"><li><p>One</p></li><li><p>Two</p></li></ol><p></p>'); try {
      const original = editor.getHTML(); assert(configureEditorialList(editor, { kind: 'ordered', start: -3 }, { from: 3, to: 6 }).ok, 'start'); assert(editor.getHTML().includes('start="-3"'), 'negative start'); editor.commands.undo(); equal(editor.getHTML(), original, 'undo');
      configureEditorialList(editor, { kind: 'ordered', start: 0 }, { from: 3, to: 6 }); const html = editor.getHTML(); editor.commands.setContent(html, { emitUpdate: false }); assert(editor.getHTML().includes('start="0"'), 'zero reopen');
    } finally { cleanup(); }
  });
  run('list nesting and lifting retain formatting with one transaction per operation', () => {
    const { editor, cleanup } = mount('<ol><li><p>One</p></li><li><p><strong>Two 😀</strong></p></li><li><p>Three</p></li></ol><p></p>'); try {
      let position = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Two 😀') position = pos; }); const original = editor.getHTML();
      const result = configureEditorialList(editor, { kind: 'ordered', level: 2 }, { from: position, to: position + 3 }); assert(result.ok, result.reason ?? 'nested'); assert((editor.getHTML().match(/<ol/g) ?? []).length === 2 && editor.getHTML().includes('<strong>Two 😀</strong>'), 'nested structure'); const nested = editor.getHTML(); editor.commands.undo(); equal(editor.getHTML(), original, 'nest undo'); editor.commands.redo(); equal(editor.getHTML(), nested, 'redo');
      assert(configureEditorialList(editor, { kind: 'ordered', level: 1 }).ok, 'lift'); equal(editor.getHTML(), original, 'lift exact');
    } finally { cleanup(); }
  });
  run('list wrapping and kind conversion preserve source text and mark structure', () => {
    const { editor, cleanup } = mount('<p><em>One</em></p><p>Two</p><p></p>'); try {
      const original = editor.getHTML(); assert(configureEditorialList(editor, { kind: 'ordered', start: 12 }, { from: 1, to: 9 }).ok, 'wrap'); assert(editor.getHTML().includes('<ol start="12">') && editor.getHTML().includes('<em>One</em>'), 'formatted wrap'); editor.commands.undo(); equal(editor.getHTML(), original, 'wrap undo'); editor.commands.redo(); assert(configureEditorialList(editor, { kind: 'bullet' }).ok, 'kind'); assert(editor.getHTML().includes('<ul>'), 'bullet structure');
    } finally { cleanup(); }
  });
  run('unsupported first-item nesting is atomic and never changes original content', () => {
    const { editor, cleanup } = mount('<p>First</p>'); try {
      const before = editor.getHTML(); const result = configureEditorialList(editor, { kind: 'ordered', level: 2 }, { from: 1, to: 3 }); assert(!result.ok && result.reason?.includes('preceding'), 'meaningful reason'); equal(editor.getHTML(), before, 'no partial wrapping');
    } finally { cleanup(); }
  });
  run('combined nesting and start changes affect the resulting list and preserve parent numbering', () => {
    const { editor, cleanup } = mount('<ol start="4"><li><p>One</p></li><li><p>Two</p></li></ol><p></p>'); try {
      let position = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Two') position = pos; });
      const result = configureEditorialList(editor, { kind: 'ordered', start: 20, level: 2 }, { from: position, to: position + 3 }); assert(result.ok, result.reason ?? 'combined');
      equal(editor.state.doc.firstChild!.attrs.start, 4, 'parent numbering unchanged'); let nestedStart = 0; editor.state.doc.firstChild!.descendants(node => { if (node.type.name === 'orderedList') nestedStart = node.attrs.start; }); equal(nestedStart, 20, 'new nested numbering');
    } finally { cleanup(); }
  });
  run('a selection crossing distinct lists cannot silently format only its first list', () => {
    const { editor, cleanup } = mount('<ol><li><p>One</p></li></ol><p>Middle</p><ol><li><p>Two</p></li></ol><p></p>'); try {
      let end = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Two') end = pos + 3; }); const before = editor.getHTML();
      assert(!configureEditorialList(editor, { kind: 'bullet' }, { from: 3, to: end }).ok, 'scope reason'); equal(editor.getHTML(), before, 'both source lists untouched');
    } finally { cleanup(); }
  });
  run('chapter-scoped list wrapping never moves headings or later chapter content', () => {
    const { editor, cleanup } = mount('<h1 data-writing-id="one">Uno</h1><p>Alpha</p><h1 data-writing-id="two">Dos</h1><p>Beta</p>', true); try {
      const scopes = chapterScopes(editor); const heading = editor.state.doc.firstChild!.toJSON(); const other = editor.state.doc.lastChild!.toJSON();
      const result = configureEditorialList(editor, { kind: 'ordered', start: 1000 }, { from: scopes[0].from + 1, to: scopes[0].to - 1 }, scopes[0]); assert(result.ok, result.reason ?? 'scope list'); equal(editor.state.doc.firstChild!.toJSON(), heading, 'heading'); equal(editor.state.doc.lastChild!.toJSON(), other, 'other paragraph');
    } finally { cleanup(); }
  });
  run('named formatting preserves pending replacements and metadata operations do not invent tracked text', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      proposeRevision(editor, { from: 1, to: 9, text: 'Candidate', author: 'Luis', source: 'test' }); const before = describeRevisions(editor);
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'manual' }); upsertEditorialStyle(editor, style); applyEditorialStyle(editor, { id: style.id, from: 2, to: editor.state.doc.content.size - 1 }); setEditorialSection(editor, { id: 'sec', ...DEFAULT_EDITORIAL_SECTION });
      const after = describeRevisions(editor); equal(after.map(r => [r.id, r.originalText, r.proposedText]), before.map(r => [r.id, r.originalText, r.proposedText]), 'proposals unchanged');
    } finally { cleanup(); }
  });
  run('images footnotes and table cells survive style operations and HTML reopening', () => {
    const { editor, cleanup } = mount('<p>Word<sup data-footnote-id="n" data-footnote="note"></sup></p><img src="data:image/png;base64,AA=="><table><tbody><tr><td><p><em>Cell</em></p></td></tr></tbody></table>'); try {
      upsertEditorialStyle(editor, style); applyEditorialStyle(editor, { id: style.id, from: 1, to: editor.state.doc.content.size - 1 }); const json = editor.getJSON(); const html = editor.getHTML(); assert(html.includes('<img') && html.includes('<table') && html.includes('data-footnote'), 'nodes retained'); editor.commands.setContent(html, { emitUpdate: false }); equal(editor.getJSON(), json, 'custom nodes roundtrip');
    } finally { cleanup(); }
  });
  run('pure headless operation has the same schema document and does not mutate its input', () => {
    const { editor, cleanup } = mount('<p>Pure 😀</p>'); try {
      const doc = editor.state.doc; const original = doc.toJSON(); const state = EditorState.create({ schema: editor.schema, doc }); const prepared = prepareEditorialOperation(state, { kind: 'upsertStyle', style }); assert(prepared.transaction, 'pure transaction'); const projected = state.apply(prepared.transaction).doc;
      equal(doc.toJSON(), original, 'immutable source'); equal(describeEditorialDocument(projected).styles, [style], 'pure metadata'); upsertEditorialStyle(editor, style); equal(editor.getJSON(), projected.toJSON(), 'same live document');
    } finally { cleanup(); }
  });
  run('sanitized saved HTML reopens styles sections citations and source snapshots exactly', () => {
    const { editor, cleanup } = mount('<p>Preserved <strong>😀</strong></p>'); try {
      upsertEditorialStyle(editor, style); setEditorialSection(editor, { id: 'section', ...DEFAULT_EDITORIAL_SECTION, header: '<img onerror=alert(1)> literal' });
      let position = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text?.startsWith('Preserved')) position = pos; });
      insertEditorialCitation(editor, citationFromReference(source, { id: 'citation', label: '<script>literal</script>' }), { from: position, to: position }); generateEditorialBibliography(editor);
      const json = editor.getJSON(); const saved = sanitizeRichHtml(sanitizeRichHtml(editor.getHTML())); editor.commands.setContent(saved, { emitUpdate: false }); equal(editor.getJSON(), json, 'semantic saved document');
      const hostile = document.createElement('div'); hostile.innerHTML = sanitizeRichHtml('<span data-wh-section="{}" onclick="alert(1)">invalid</span><div data-wh-editorial-style="{}">bad</div>');
      assert(!hostile.querySelector('[onclick],[data-wh-section],[data-wh-editorial-style]'), 'invalid metadata and handlers dropped');
    } finally { cleanup(); }
  });
  run('read-only and malformed scope operations leave the document untouched', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      const original = editor.getHTML(); editor.setEditable(false); assert(!upsertEditorialStyle(editor, style).ok, 'readonly'); editor.setEditable(true); assert(!setEditorialSection(editor, { id: 's', ...DEFAULT_EDITORIAL_SECTION }, { from: -1, to: 3 }).ok, 'invalid scope'); equal(editor.getHTML(), original, 'unchanged');
    } finally { cleanup(); }
  });
  return passed;
}
