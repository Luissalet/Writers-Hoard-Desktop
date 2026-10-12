import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { createAdvancedExtensions } from '@/components/editor/advanced';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { createEditorialExtensions, insertEditorialCitation } from '@/engines/writings/editorial';
import { createRevisionExtensions, proposeRevision, describeRevisions, setRevisionTracking } from '@/engines/writings/revisions';
import { checkDocument, applySuggestion, proofingTextSegments, type ProofingFinding } from '@/engines/writings/proofing';
import { loadPersonalWords, editPersonalWord } from '@/services/proofing/dictionary';
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
const equal = (a: unknown, b: unknown, label: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
function mount(content: string) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: [StarterKit, Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...createEditorialExtensions()], content });
  return { editor, cleanup: () => { editor.destroy(); host.remove(); } };
}
export async function testProofingCore(): Promise<string[]> {
  const passed: string[] = []; const run = async (name: string, fn: () => Promise<void>) => { await fn(); passed.push(name); };
  await run('real Spanish worker loads pinned dictionary and morphology without English a-an rules', async () => {
    const { editor, cleanup } = mount('<p>Los niños guardaron las fotografías. Volverá al árbol. La idea era una oportunidad.</p>'); try {
      const result = await checkDocument(editor, { language: 'es-ES' }); equal(result.status.spelling, 'ready', 'worker ready'); equal(result.findings, [], 'Spanish morphology correct');
    } finally { cleanup(); }
  });
  await run('UTF16 Unicode positions across character marks locate the exact accented suggestion', async () => {
    const { editor, cleanup } = mount('<p>👩‍🚀 La <strong>publi</strong><em>cacion</em> aparece.</p>'); try {
      const result = await checkDocument(editor, { language: 'es-ES' }); const finding = result.findings.find(f => f.original === 'publicacion'); assert(finding, 'whole word across marks'); assert(finding.suggestions.includes('publicación'), 'accent suggestion'); equal(editor.state.doc.textBetween(finding.from, finding.to), finding.original, 'exact Unicode anchor');
    } finally { cleanup(); }
  });
  await run('decomposed Unicode keeps original offsets while dictionary checking uses NFC', async () => {
    const { editor, cleanup } = mount('<p>El niño vio el árbol.</p>'); try { equal((await checkDocument(editor, { language: 'es-ES' })).findings, [], 'NFD valid'); } finally { cleanup(); }
  });
  await run('personal words are project-scoped request values and do not leak into other checks', async () => {
    const { editor, cleanup } = mount('<p>Xochitl trabaja.</p>'); try {
      assert((await checkDocument(editor, { language: 'es-ES' })).findings.some(f => f.original === 'Xochitl'), 'unknown baseline'); equal((await checkDocument(editor, { language: 'es-ES', personalWords: ['Xochitl'] })).findings.length, 0, 'personal accepted'); assert((await checkDocument(editor, { language: 'es-ES' })).findings.some(f => f.original === 'Xochitl'), 'other project unaffected');
    } finally { cleanup(); }
  });
  await run('URLs dates emails footnotes images and citations are excluded but table prose is checked', async () => {
    const { editor, cleanup } = mount('<p>https://example.invalid/zzzzz 12/10/2026 test@zzzzz.invalid <sup data-footnote-id="n" data-footnote="zzzzzzz"></sup></p><img src="data:image/png;base64,AA=="><table><tbody><tr><td><p>publicacion</p></td></tr></tbody></table><p></p>'); try {
      insertEditorialCitation(editor, { id: 'c', sourceId: 's', label: 'zzzzzzz' }, { from: 1, to: 1 }); const result = await checkDocument(editor, { language: 'es-ES' }); equal(result.findings.map(f => f.original), ['publicacion'], 'only table typo');
    } finally { cleanup(); }
  });
  await run('pending deleted proposal text is skipped and the visible candidate remains checked', async () => {
    const { editor, cleanup } = mount('<p>zzzzzzz</p>'); try {
      proposeRevision(editor, { from: 1, to: 8, text: 'publicacion', author: 'Luis', source: 'test' }); const result = await checkDocument(editor, { language: 'es-ES' }); equal(result.findings.map(f => f.original), ['publicacion'], 'candidate only');
    } finally { cleanup(); }
  });
  await run('apply correction preserves bold color link and one undo restores the original HTML', async () => {
    const { editor, cleanup } = mount('<p><a href="https://example.invalid"><strong><span data-wh-color="#123456">publicacion</span></strong></a> final.</p>'); try {
      const original = editor.getHTML(); const report = await checkDocument(editor, { language: 'es-ES' }); const finding = report.findings[0]; assert(applySuggestion(editor, finding, 'publicación', { expectedDoc: report.document }).ok, 'apply'); const html = editor.getHTML(); assert(html.includes('<strong>') && html.includes('data-wh-color="#123456"') && html.includes('<a '), 'character marks'); editor.commands.undo(); equal(editor.getHTML(), original, 'single undo exact');
    } finally { cleanup(); }
  });
  await run('the minimal correction preserves different character marks within one word', async () => {
    const { editor, cleanup } = mount('<p><strong>publi</strong><em>cacion</em></p>'); try {
      const before = editor.getHTML(); const report = await checkDocument(editor, { language: 'es-ES' }); assert(applySuggestion(editor, report.findings[0], 'publicación').ok, 'apply split word'); assert(editor.getHTML().includes('<strong>publi</strong><em>cación</em>'), 'each character format retained'); editor.commands.undo(); equal(editor.getHTML(), before, 'undo split word');
    } finally { cleanup(); }
  });
  await run('a correction within a pending insertion preserves its original proposal group', async () => {
    const { editor, cleanup } = mount('<p>Texto</p>'); try {
      proposeRevision(editor, { from: 1, to: 6, text: 'publicacion', author: 'Luis', source: 'test' }); const before = describeRevisions(editor)[0]; const report = await checkDocument(editor, { language: 'es-ES' }); assert(applySuggestion(editor, report.findings[0], 'publicación').ok, 'candidate corrected'); const after = describeRevisions(editor)[0]; equal(after.id, before.id, 'same revision'); equal(after.originalText, 'Texto', 'original retained'); equal(after.proposedText, 'publicación', 'candidate corrected');
    } finally { cleanup(); }
  });
  await run('project personal words persist in real IndexedDB and concurrent settings additions survive', async () => {
    const project = 'private-proofing-' + crypto.randomUUID(); await Promise.all([editPersonalWord('Xochitl', 'add', project), editPersonalWord('Eigenbrod', 'add', project)]);
    const persisted = await loadPersonalWords(project); assert(persisted.includes('Xochitl') && persisted.includes('Eigenbrod'), 'both atomic additions'); await editPersonalWord('Xochitl', 'remove', project); equal(await loadPersonalWords(project), ['Eigenbrod'], 'remove'); equal(await loadPersonalWords(project + '-other'), [], 'project isolation');
  });
  await run('stale document and changed source text cannot overwrite the current prose', async () => {
    const { editor, cleanup } = mount('<p>publicacion</p>'); try {
      const report = await checkDocument(editor, { language: 'es-ES' }); editor.commands.insertContentAt(1, 'Nueva '); const current = editor.getHTML(); assert(!applySuggestion(editor, report.findings[0], 'publicación', { expectedDoc: report.document }).ok, 'snapshot stale'); assert(!applySuggestion(editor, report.findings[0], 'publicación').ok, 'old range stale'); equal(editor.getHTML(), current, 'current untouched');
    } finally { cleanup(); }
  });
  await run('ordinary correction is recorded by enabled tracking with undo and candidate markers intact', async () => {
    const { editor, cleanup } = mount('<p>publicacion</p>'); try {
      const report = await checkDocument(editor, { language: 'es-ES' }); setRevisionTracking(editor, { enabled: true, author: 'Luis', source: 'manual' }); assert(applySuggestion(editor, report.findings[0], 'publicación').ok, 'tracked correction'); const revisions = describeRevisions(editor); equal(revisions.length, 1, 'one replacement'); equal(revisions[0].originalText, 'o', 'changed original retained'); equal(revisions[0].proposedText, 'ó', 'changed candidate');
      editor.commands.undo(); equal(editor.state.doc.textContent, 'publicacion', 'undo tracked correction');
    } finally { cleanup(); }
  });
  await run('local grammar offsets map to exact Unicode document text and unavailable service is explicit', async () => {
    const { editor, cleanup } = mount('<p>😀 Quiero mas información.</p>'); try {
      const report = await checkDocument(editor, { language: 'es-ES', grammarCheck: async text => ({ ok: true, matches: [{ offset: text.indexOf('mas'), length: 3, message: 'Tilde diacrítica.', replacements: [{ value: 'más' }], rule: { id: 'MAS', issueType: 'misspelling', category: { id: 'DIACRITICS', name: 'Tilde' } } }] }) }); const finding = report.findings.find(f => f.category === 'grammar'); assert(finding, 'contextual spelling remains grammar'); equal(editor.state.doc.textBetween(finding.from, finding.to), 'mas', 'offset');
      const unavailable = await checkDocument(editor, { language: 'es-ES', grammarCheck: async () => ({ ok: false, error: 'Java unavailable' }) }); equal(unavailable.status.grammar, 'unavailable', 'explicit grammar status'); equal(unavailable.status.spelling, 'ready', 'spell remains');
    } finally { cleanup(); }
  });
  await run('scope checks only selected prose and forged atom or deleted ranges are rejected', async () => {
    const { editor, cleanup } = mount('<p>publicacion</p><p>arbol<sup data-footnote-id="n" data-footnote="note"></sup></p>'); try {
      const firstSize = editor.state.doc.firstChild!.nodeSize; const result = await checkDocument(editor, { language: 'es-ES', scope: { from: firstSize, to: editor.state.doc.content.size } }); equal(result.findings.map(f => f.original), ['arbol'], 'scoped');
      const fake: ProofingFinding = { id: 'fake', from: firstSize + 1, to: editor.state.doc.content.size - 1, original: 'arbol', suggestions: [], category: 'spelling', rule: 'fake', message: '' }; const before = editor.getHTML(); assert(!applySuggestion(editor, fake, 'árbol').ok, 'atom refused'); equal(editor.getHTML(), before, 'source unchanged'); assert(proofingTextSegments(editor.state.doc).every(segment => !segment.text.includes('note')), 'notes skipped');
    } finally { cleanup(); }
  });
  return passed;
}
