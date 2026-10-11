import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { closeHistory } from '@tiptap/pm/history';
import { createAdvancedExtensions } from '@/components/editor/advanced';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { createRevisionExtensions, proposeRevision, resolveRevisions, describeRevisions, setRevisionTracking, getRevisionTracking, normalizeRevisionMetadata, projectRevisionDocument, describeRevisionDocument, prepareResolve } from '@/engines/writings/revisions';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, label: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
function mount(content: string, chapters = false) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: [StarterKit.configure({ document: chapters ? false : {} }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...(chapters ? [BookDocument, ChapterHeadingNode.configure({ nodeView: false })] : [])], content });
  return { editor, cleanup: () => { editor.destroy(); host.remove(); } };
}
const input = { author: 'Luis ñ "quotes"', source: 'AI <source>', createdAt: 123456 };

export async function testRevisionsCore(): Promise<string[]> {
  const passed: string[] = [];
  const run = (name: string, fn: () => void) => { fn(); passed.push(name); };
  run('metadata normalizes only actual typed revision records', () => {
    assert(normalizeRevisionMetadata({ id: 'id', kind: 'deletion', ...input }), 'valid metadata');
    equal(normalizeRevisionMetadata({ id: 'id', kind: 'insertion', author: 'Luis', source: 'manual', createdAt: Infinity }), null, 'finite timestamp');
    equal(normalizeRevisionMetadata({ id: 'id', kind: 'replacement', ...input }), null, 'only persisted insertion/deletion');
  });
  run('replacement retains rich original and plain candidate, one ID, accept/reject and undo', () => {
    const { editor, cleanup } = mount('<p><strong>España 😀</strong> tail</p><p>Untouched</p>');
    try {
      const original = editor.getHTML();
      assert(proposeRevision(editor, { from: 1, to: 10, text: '<b>literal</b> ñ', id: 'replace', ...input }).ok, 'proposal');
      const pending = editor.getHTML(); const revisions = describeRevisions(editor);
      equal(revisions.length, 1, 'one group'); equal(revisions[0].kind, 'replacement', 'group kind'); assert(pending.includes('&lt;b&gt;literal&lt;/b&gt;'), pending); assert(pending.includes('<strong>'), 'format retained');
      assert(resolveRevisions(editor, { ids: ['replace'], decision: 'accept' }).ok, 'accept'); assert(!editor.getHTML().includes('data-wh-revision'), 'resolved metadata'); assert(editor.state.doc.textContent.includes('<b>literal</b> ñ'), 'accepted literal');
      assert(editor.commands.undo(), 'undo acceptance'); equal(editor.getHTML(), pending, 'undo restores pending');
      assert(resolveRevisions(editor, { ids: ['replace'], decision: 'reject' }).ok, 'reject'); equal(editor.getHTML(), original, 'reject original exact');
      assert(editor.commands.undo(), 'undo rejection'); equal(editor.getHTML(), pending, 'undo reject restores pending');
    } finally { cleanup(); }
  });
  run('proposal itself undoes as a single transaction', () => {
    const { editor, cleanup } = mount('<p>Alpha</p>'); try {
      const original = editor.getHTML(); assert(proposeRevision(editor, { from: 1, to: 6, text: 'Beta', ...input }).ok, 'proposal');
      editor.commands.undo(); equal(editor.getHTML(), original, 'single undo'); editor.commands.redo(); equal(describeRevisions(editor).length, 1, 'redo proposal');
    } finally { cleanup(); }
  });
  run('accepted replacement inherits selected bold color and link inside the same link; rejection is exact', () => {
    for (const decision of ['accept', 'reject'] as const) {
      const { editor, cleanup } = mount('<p><a href="https://example.invalid/forest"><strong><span data-wh-color="#123456">Árbol largo</span></strong></a> tail</p>');
      try {
        const original = editor.getHTML(); assert(proposeRevision(editor, { from: 1, to: 6, text: 'Bosque', ...input }).ok, 'formatted replacement');
        resolveRevisions(editor, { decision });
        if (decision === 'reject') equal(editor.getHTML(), original, 'reject rich original exact');
        else {
          const node = editor.state.doc.firstChild!.firstChild!;
          equal(node.text, 'Bosque largo', 'replacement and unchanged linked remainder');
          assert(node.marks.some(mark => mark.type.name === 'bold'), 'bold preserved');
          assert(node.marks.some(mark => mark.type.name === 'advancedTextStyle' && mark.attrs.color === '#123456'), 'color preserved');
          assert(node.marks.some(mark => mark.type.name === 'link' && mark.attrs.href === 'https://example.invalid/forest'), 'link context preserved');
        }
      } finally { cleanup(); }
    }
  });
  run('collapsed insertion inherits explicitly stored character formatting without changing the original', () => {
    for (const decision of ['accept', 'reject'] as const) {
      const { editor, cleanup } = mount('<p>Original</p>'); try {
        const original = editor.getHTML(); editor.commands.setTextSelection(1); editor.commands.setBold(); editor.commands.setMark('advancedTextStyle', { color: '#654321' }); editor.commands.setLink({ href: 'https://example.invalid/new' });
        assert(proposeRevision(editor, { from: 1, to: 1, text: 'Bosque ', ...input }).ok, 'stored formatting proposal'); resolveRevisions(editor, { decision });
        if (decision === 'reject') equal(editor.getHTML(), original, 'reject leaves original exact');
        else {
          const node = editor.state.doc.firstChild!.firstChild!;
          equal(node.text, 'Bosque ', 'inserted candidate'); assert(node.marks.some(mark => mark.type.name === 'bold'), 'stored bold');
          assert(node.marks.some(mark => mark.type.name === 'advancedTextStyle' && mark.attrs.color === '#654321'), 'stored color');
          assert(node.marks.some(mark => mark.type.name === 'link' && mark.attrs.href === 'https://example.invalid/new'), 'stored link');
          assert(!editor.state.doc.firstChild!.lastChild!.marks.length, 'original remains unformatted');
        }
      } finally { cleanup(); }
    }
  });
  run('Unicode positions cannot split a surrogate pair or accept invalid ranges', () => {
    const { editor, cleanup } = mount('<p>A😀B</p>'); try {
      const original = editor.getHTML();
      for (const [from, to] of [[-1, 2], [1.5, 3], [2, 3], [3, 4], [4, 99]]) equal(proposeRevision(editor, { from, to, text: 'X', ...input }).reason, 'invalid-range', 'invalid Unicode range');
      equal(editor.getHTML(), original, 'no loss');
      assert(proposeRevision(editor, { from: 2, to: 4, text: '👩‍👩‍👧‍👦', ...input }).ok, 'whole emoji'); resolveRevisions(editor, { decision: 'reject' }); equal(editor.getHTML(), original, 'reject exact Unicode');
    } finally { cleanup(); }
  });
  run('multiparagraph replacement accepts without phantom paragraphs and rejects exact original', () => {
    for (const decision of ['accept', 'reject'] as const) {
      const { editor, cleanup } = mount('<p><em>Alpha</em></p><p><strong>Beta</strong></p><p>Tail</p>');
      try {
        const original = editor.getHTML(); assert(proposeRevision(editor, { from: 1, to: 12, text: 'New one\nNew two', id: 'multi', ...input }).ok, 'multi proposal');
        const pending = editor.getHTML(); equal(describeRevisions(editor).length, 1, 'single multipara group');
        assert(resolveRevisions(editor, { ids: ['multi'], decision }).ok, 'resolve multipara');
        if (decision === 'reject') equal(editor.getHTML(), original, 'reject multi exact');
        else { equal(editor.state.doc.childCount, 3, 'two candidate paragraphs plus untouched'); equal(editor.state.doc.textContent, 'New oneNew twoTail', 'only new text remains'); }
        editor.commands.undo(); equal(editor.getHTML(), pending, 'undo resolves multi');
      } finally { cleanup(); }
    }
  });
  run('multiparagraph delimiter revisions survive sanitizer and editor reload before rejection', () => {
    const { editor, cleanup } = mount('<p>Alpha</p><p>Beta</p><p>Tail</p>'); try {
      const original = editor.getHTML(); assert(proposeRevision(editor, { from: 1, to: 12, text: 'New one\nNew two', ...input }).ok, 'multi');
      const second = mount(sanitizeRichHtml(editor.getHTML())); try {
        equal(describeRevisions(second.editor), describeRevisions(editor), 'delimiter metadata reload');
        resolveRevisions(second.editor, { decision: 'reject' }); equal(second.editor.getHTML(), original, 'original paragraphs restored after reload');
      } finally { second.cleanup(); }
    } finally { cleanup(); }
  });
  run('stale source, overlapping proposals and structural chapter boundaries leave document untouched', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      const original = editor.getHTML(); const stale = proposeRevision(editor, { from: 1, to: 9, text: 'New', expectedUpdatedAt: 10, currentUpdatedAt: 11, ...input });
      equal(stale.reason, 'stale-source', 'stale'); equal(editor.getHTML(), original, 'no stale write');
      assert(proposeRevision(editor, { from: 1, to: 9, text: 'New', ...input }).ok, 'first'); const pending = editor.getHTML();
      equal(proposeRevision(editor, { from: 1, to: 3, text: 'X', ...input }).reason, 'overlapping-revision', 'overlap'); equal(editor.getHTML(), pending, 'no overlapping write');
    } finally { cleanup(); }
  });
  run('revision HTML and sanitizer reload metadata exactly; ordinary strike/del are not revisions', () => {
    const { editor, cleanup } = mount('<p>Original</p><p><s>Plain strike</s> <del>ordinary deletion</del></p>');
    try {
      equal(describeRevisions(editor).length, 0, 'plain formatting never interpreted as revisions');
      assert(proposeRevision(editor, { from: 1, to: 9, text: 'Candidate', id: 'html&"', ...input }).ok, 'html proposal');
      const second = mount(sanitizeRichHtml(editor.getHTML())); try { equal(describeRevisions(second.editor), describeRevisions(editor), 'all metadata and positions reload'); } finally { second.cleanup(); }
    } finally { cleanup(); }
  });
  run('scope prevents duplicate imported IDs from resolving outside the chapter', () => {
    const span = (text: string) => `<span data-wh-revision-id="duplicate" data-wh-revision-kind="insertion" data-wh-revision-author="Luis" data-wh-revision-source="manual" data-wh-revision-created-at="1">${text}</span>`;
    const { editor, cleanup } = mount(`<p>${span('First')}</p><p>${span('Second')}</p>`);
    try {
      const secondBefore = editor.getHTML().split('</p>')[1];
      assert(resolveRevisions(editor, { ids: ['duplicate'], from: 1, to: 6, decision: 'accept' }).ok, 'scope accept');
      equal(editor.getHTML().split('</p>')[1], secondBefore, 'outside scope byte unchanged'); equal(describeRevisions(editor).length, 1, 'second proposal persists');
      equal(describeRevisions(editor, { from: 8, to: 14 })[0].proposedText, 'Second', 'scoped description');
    } finally { cleanup(); }
  });
  run('chapter heading content cannot be revised or crossed, while own chapter proposal works', () => {
    const { editor, cleanup } = mount('<h1 data-chapter-heading="true" data-writing-id="one">One</h1><p>First</p><h1 data-chapter-heading="true" data-writing-id="two">Two</h1><p>Second</p>', true);
    try {
      equal(editor.state.doc.child(0).type.name, 'chapterHeading', 'actual book schema');
      const original = editor.getHTML(); const first = editor.state.doc.child(0).nodeSize; const nextHeading = first + editor.state.doc.child(1).nodeSize;
      equal(proposeRevision(editor, { from: 1, to: 2, text: 'Wrong', ...input }).reason, 'structure', 'heading edits unsupported');
      equal(proposeRevision(editor, { from: first + 1, to: nextHeading + editor.state.doc.child(2).nodeSize + 2, text: 'Wrong', ...input }).reason, 'structure', 'cross chapter unsupported');
      equal(editor.getHTML(), original, 'all headings and bodies intact');
      assert(proposeRevision(editor, { from: first + 1, to: first + 6, text: 'Own', ...input }).ok, 'own body valid');
      resolveRevisions(editor, { decision: 'reject' }); equal(editor.getHTML(), original, 'body rejection preserves book exact');
    } finally { cleanup(); }
  });
  run('clear formatting preserves both revision marks while clearing actual character formatting', () => {
    const { editor, cleanup } = mount('<p><strong><span data-wh-color="#123456">Original</span></strong></p>'); try {
      assert(proposeRevision(editor, { from: 1, to: 9, text: 'Candidate', ...input }).ok, 'proposal'); const revisions = describeRevisions(editor);
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }); editor.commands.unsetAllMarks();
      equal(describeRevisions(editor), revisions, 'revision metadata never treated as typography');
      assert(!editor.getHTML().includes('<strong>') && !editor.getHTML().includes('data-wh-color'), 'real formatting cleared');
      assert(editor.getHTML().includes('wh-revision-insertion') && editor.getHTML().includes('wh-revision-deletion'), 'both proposals remain visible');
    } finally { cleanup(); }
  });
  run('pure document projection uses the same resolution while preserving source/history and custom nodes', () => {
    const { editor, cleanup } = mount('<h1 data-chapter-heading="true" data-writing-id="one">One</h1><p>Alpha</p><p>Beta</p><h1 data-chapter-heading="true" data-writing-id="two">Two</h1><p>Second<sup data-footnote-id="n" data-footnote="Note"></sup></p>', true);
    try {
      const original = editor.state.doc; const offset = original.child(0).nodeSize;
      assert(proposeRevision(editor, { from: offset + 1, to: offset + 12, text: 'New one\nNew two', ...input }).ok, 'proposal');
      const source = editor.state.doc; const sourceJson = source.toJSON(); const historyBefore = editor.state;
      const accepted = projectRevisionDocument(source, 'accept'); const rejected = projectRevisionDocument(source, 'reject');
      equal(describeRevisionDocument(accepted).length, 0, 'accepted has no pending metadata'); equal(describeRevisionDocument(rejected).length, 0, 'rejected has no pending metadata');
      equal(rejected.toJSON(), original.toJSON(), 'pure rejection exact original custom schema');
      equal(accepted.child(0).toJSON(), original.child(0).toJSON(), 'heading metadata preserved'); equal(accepted.lastChild!.toJSON(), original.lastChild!.toJSON(), 'other chapter note preserved');
      equal(accepted.textContent, 'OneNew oneNew twoTwoSecond', 'accepted paragraph projection');
      equal(source.toJSON(), sourceJson, 'source immutable'); assert(editor.state === historyBefore, 'no editor/source/history update');
      equal(prepareResolve(editor.state, { decision: 'accept' }).transaction!.doc.toJSON(), accepted.toJSON(), 'same resolution implementation');
    } finally { cleanup(); }
  });
  run('selection resolves complete replacement ID instead of half the proposal', () => {
    const { editor, cleanup } = mount('<p>Old</p>'); try {
      assert(proposeRevision(editor, { from: 1, to: 4, text: 'New', id: 'whole', ...input }).ok, 'proposal');
      assert(resolveRevisions(editor, { from: 1, to: 2, decision: 'reject' }).ok, 'selection reject'); equal(editor.getHTML(), '<p>Old</p>', 'whole replacement rejected');
    } finally { cleanup(); }
  });
  run('notes images table attrs and formatting outside replacement stay untouched', () => {
    const html = '<p>Text<sup data-footnote-id="n1" data-footnote="A note" class="wh-footnote-ref"></sup> end</p><img src="data:image/png;base64,aGVsbG8=" alt="Original"><table><tbody><tr><td data-wh-colwidth="160"><p>Cell</p></td></tr></tbody></table><p>Tail</p>';
    const { editor, cleanup } = mount(html); try {
      const originals = editor.state.doc.toJSON().content!.slice(1);
      assert(proposeRevision(editor, { from: 1, to: 6, text: 'Changed', ...input }).ok, 'includes inline footnote');
      assert(resolveRevisions(editor, { decision: 'reject' }).ok, 'reject atom range');
      assert(editor.getHTML().includes('data-footnote-id="n1"'), 'footnote restored'); equal(editor.state.doc.toJSON().content!.slice(1), originals, 'image table identical');
    } finally { cleanup(); }
  });
  run('tracking disabled uses ordinary unmarked edits and metadata config getter updates', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      editor.commands.setTextSelection(1); editor.commands.insertContent('Normal '); equal(describeRevisions(editor).length, 0, 'untracked default');
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' }); equal(getRevisionTracking(editor).enabled, true, 'mode state');
      setRevisionTracking(editor, { enabled: false, author: 'Luis', source: 'typing' }); editor.commands.insertContent('Again '); equal(describeRevisions(editor).length, 0, 'untracked disabled');
    } finally { cleanup(); }
  });
  run('normal tracked typing groups adjacent text, deletion keeps original and resolve/undo works', () => {
    const { editor, cleanup } = mount('<p>Original 😀</p>'); try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' }); editor.commands.setTextSelection(1);
      editor.commands.insertContent('New '); editor.commands.insertContent('ñ'); equal(describeRevisions(editor).length, 1, 'one adjacent typing group');
      assert(resolveRevisions(editor, { decision: 'reject' }).ok, 'reject typed'); equal(editor.getHTML(), '<p>Original 😀</p>', 'original after reject');
      editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.setTextSelection({ from: 1, to: 9 }); editor.commands.deleteSelection();
      assert(editor.state.doc.textContent.includes('Original'), 'deleted original visible'); equal(describeRevisions(editor)[0].kind, 'deletion', 'tracked delete');
      assert(resolveRevisions(editor, { decision: 'accept' }).ok, 'accept deletion'); assert(!editor.state.doc.textContent.includes('Original'), 'original now removed');
      editor.commands.undo(); assert(describeRevisions(editor).some(group => group.kind === 'deletion'), 'undo resolution does not retrack');
    } finally { cleanup(); }
  });
  run('composition transaction and paste marks preserve Unicode and original formatting', () => {
    const { editor, cleanup } = mount('<p><strong>Original</strong></p>'); try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' });
      editor.view.dispatch(editor.state.tr.insertText('日本語 😀', 1).setMeta('composition', 1));
      assert(describeRevisions(editor)[0].proposedText.includes('日本語 😀'), 'IME Unicode tracked');
      resolveRevisions(editor, { decision: 'reject' });
      editor.view.dispatch(editor.state.tr.insertText('Pasted ñ', 1).setMeta('paste', true).setMeta('uiEvent', 'paste'));
      assert(describeRevisions(editor)[0].proposedText.includes('Pasted ñ'), 'paste tracked');
      resolveRevisions(editor, { decision: 'reject' }); equal(editor.getHTML(), '<p><strong>Original</strong></p>', 'original format preserved');
    } finally { cleanup(); }
  });
  run('remote silent refresh is not tracked and does not produce a structural warning', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' });
      editor.commands.setContent('<p>Remote</p><p>More</p>', { emitUpdate: false });
      equal(describeRevisions(editor).length, 0, 'remote not a local revision'); assert(!getRevisionTracking(editor).warning, 'no remote scope warning');
    } finally { cleanup(); }
  });
  run('recent typing never reuses an imported or previous author proposal ID', () => {
    const { editor, cleanup } = mount('<p><span data-wh-revision-id="old" data-wh-revision-kind="insertion" data-wh-revision-author="Luis" data-wh-revision-source="typing" data-wh-revision-created-at="1">Old</span></p>');
    try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' }); editor.commands.setTextSelection(4); editor.commands.insertContent(' new');
      equal(describeRevisions(editor).length, 2, 'new user input separate from old imported proposal');
    } finally { cleanup(); }
  });
  run('multiple insertion and character-mark steps share one tracked input without reconstruction', () => {
    const { editor, cleanup } = mount('<p>Original</p>'); try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' });
      editor.view.dispatch(editor.state.tr.insertText('One', 1).insertText('Two', 4).addMark(1, 7, editor.schema.marks.bold.create()));
      assert(editor.state.doc.textContent.includes('OneTwo'), 'ordinary input retained'); assert(!getRevisionTracking(editor).warning, 'multi insert tracked');
      equal(describeRevisions(editor).length, 1, 'one input group'); equal(describeRevisions(editor)[0].proposedText, 'OneTwo', 'new fragments tracked');
      resolveRevisions(editor, { decision: 'reject' }); equal(editor.getHTML(), '<p>Original</p>', 'reject preserves original');
    } finally { cleanup(); }
  });
  run('structural tracking keeps ordinary paragraphs and informs scope without blocking writing', () => {
    const { editor, cleanup } = mount('<p>Text</p>'); try {
      setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'typing' }); editor.commands.setTextSelection(3); editor.commands.splitBlock();
      equal(editor.state.doc.childCount, 2, 'normal structural edit kept'); assert(getRevisionTracking(editor).warning, 'tracking scope explained');
    } finally { cleanup(); }
  });
  return passed;
}
