import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { getWriting } from '@/engines/writings/operations';
import { loadPersonalWords } from '@/services/proofing/dictionary';
import { projectSettingKeys } from '@/db/operations';
import type { Writing } from '@/types';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testEditorialTools(): Promise<string[]> {
  const projectId = 'editorial-tools-' + crypto.randomUUID(); const foreign = projectId + '-foreign'; const id = projectId + '-writing'; const sourceId = projectId + '-source'; const now = Date.now(); const passed: string[] = [];
  const original = '<h2>Árbol y café</h2><p><strong>publicacion</strong> con imagen y nota.</p>';
  await db.projects.add({ id: projectId, title: 'QA editorial', mode: 'reporter', type: 'standalone', color: '#445566', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  await db.writings.add({ id, projectId, title: 'QA documento', content: original, wordCount: 10, tags: [], status: 'draft', createdAt: now, updatedAt: now } as Writing);
  await db.citations.add({ id: sourceId, projectId, title: 'Entrevista <literal>', authors: ['Ana'], accessedAt: '2026-10-12', writingIds: [id], tags: [], publishedAt: '2025', url: 'https://example.org/evidence', createdAt: now, updatedAt: now, researchEvidence: [{ id: 'excerpt-1', statement: 'Testimonio.', kind: 'attribution', quote: 'Texto de la entrevista.', locator: 'p. 7', status: 'reviewed', notes: '', createdAt: now, updatedAt: now }] });
  const call = async (name: string, args: Record<string, unknown>) => { const reply = await runBridgeTool(name, args); assert(reply.ok, `${name}: ${reply.error}`); return reply.result as Record<string, unknown>; };
  try {
    const context = await call('wh_get_writing_editorial', { id }); assert(Array.isArray(context.references) && context.references.length === 1, 'Project sources missing');
    assert(!(await runBridgeTool('wh_get_writing_editorial', { id, __scopeProjectId: foreign })).ok, 'Foreign project scope accepted');
    passed.push('Editorial reads include actual project sources and preserve existing scope');
    const style = { id: 'voice', name: 'Ensayo', format: { fontFamily: 'Georgia', fontSize: 96, lineHeight: 4, indent: 9.5 }, italic: true };
    await call('wh_edit_writing_editorial', { id, operation: { kind: 'upsertStyle', style }, expectedUpdatedAt: now });
    const beforeApply = (await getWriting(id))!;
    const ranges = (await call('wh_get_writing_document', { id })).blocks as { from: number; to: number }[];
    const applied = await call('wh_edit_writing_editorial', { id, operation: { kind: 'applyStyle', id: 'voice', from: ranges[0].from, to: ranges[0].to }, expectedUpdatedAt: beforeApply.updatedAt });
    assert((await getWriting(id))?.content.includes('data-wh-size="96"'), 'Native dimensions lost');
    assert((await undoAuditEntry({ entry: { ...(applied.__audit as Record<string, unknown>), kind: 'update' } })).undone, 'Normal editorial undo failed');
    assert((await getWriting(id))?.content === beforeApply.content, 'Undo changed hidden metadata');
    passed.push('Style operations, large dimensions and ordinary audit undo use one chapter contract');
    const stale = await runBridgeTool('wh_edit_writing_editorial', { id, expectedUpdatedAt: now, operation: { kind: 'removeStyle', id: 'voice' } }); assert(!stale.ok && stale.code === 'conflict', 'Stale operation accepted');
    passed.push('Stale chapter revision is detected before mutation');
    await call('wh_edit_writing_editorial', { id, operation: { kind: 'setSection', section: { id: 'section', start: 'nextPage', pageWidth: 792, pageHeight: 612, marginTop: 36, marginRight: 48, marginBottom: 36, marginLeft: 48, header: 'Ensayo <literal>', footer: 'Notas' } } });
    let current = await call('wh_get_writing_editorial', { id }); assert((current.sections as { pageWidth: number }[])[0].pageWidth === 792, 'Page configuration lost');
    const rich = await call('wh_get_writing_document', { id }); const json = rich.document as { content: { type: string; content?: { text?: string }[] }[] }; assert(json.content.some(node => node.type === 'editorialSection'), 'Rich schema removed the section');
    passed.push('Sections survive shared rich-document inspection');
    const badEvidence = await runBridgeTool('wh_edit_writing_editorial', { id, operation: { kind: 'insertCitation', sourceId, evidenceId: 'foreign-excerpt' } }); assert(!badEvidence.ok, 'False source excerpt attribution accepted');
    // Use a current inline position rather than an earlier paragraph offset.
    await call('wh_get_writing_document', { id });
    const heading = await call('wh_get_writing_headings', { id }); const first = (heading.headings as { from: number; to: number }[])[0];
    await call('wh_edit_writing_editorial', { id, operation: { kind: 'insertCitation', sourceId, evidenceId: 'excerpt-1', label: 'Ana (2025)', locator: 'p. 7', range: { from: first.to + 1, to: first.to + 1 } } });
    current = await call('wh_get_writing_editorial', { id }); assert((current.citations as { sourceId: string }[])[0].sourceId === sourceId, 'Source association missing');
    await db.citations.update(sourceId, { title: 'Entrevista corregida', updatedAt: now + 10000 });
    await call('wh_edit_writing_editorial', { id, operation: { kind: 'refreshReferences' } }); await call('wh_edit_writing_editorial', { id, operation: { kind: 'bibliography' } });
    assert((await getWriting(id))?.content.includes('Entrevista corregida'), 'Bibliography is not updated from source');
    passed.push('Citations validate real excerpts and explicit refresh updates bibliography');
    const latest = (await getWriting(id))!; const html = String((await call('wh_get_writing_document', { id })).html); const offset = html.indexOf('publicacion'); assert(offset >= 0, 'Language fixture disappeared');
    const factory = (await import('@/services/aiBridge/tools/editorialDocument')).createWritingEditor(latest.content); let wordPos = -1;
    factory.state.doc.descendants((node, pos) => { if (node.isText && node.text?.includes('publicacion')) wordPos = pos + node.text.indexOf('publicacion'); }); factory.destroy();
    await call('wh_apply_writing_language_suggestion', { id, expectedUpdatedAt: latest.updatedAt, finding: { from: wordPos, to: wordPos + 11, original: 'publicacion' }, replacement: 'publicación' });
    const corrected = document.createElement('div'); corrected.innerHTML = (await getWriting(id))!.content;
    assert([...corrected.querySelectorAll('strong')].some(node => node.textContent?.includes('publicación')), 'Correction lost character formatting');
    await call('wh_manage_writing_dictionary', { id, word: 'Faustus', action: 'add' }); assert((await loadPersonalWords(projectId)).includes('Faustus'), 'Personal dictionary not persisted');
    assert(projectSettingKeys(projectId).includes(`proofing:es-ES:${projectId}`), 'Dictionary not included in project ownership/export');
    await call('wh_manage_writing_dictionary', { id, word: 'Faustus', action: 'remove' }); assert(!(await loadPersonalWords(projectId)).includes('Faustus'), 'Dictionary removal failed');
    passed.push('Language corrections preserve formatting and project dictionaries persist with ownership');
    return passed;
  } finally { await db.writingSnapshots.where('writingId').equals(id).delete(); await db.citations.delete(sourceId); await db.writings.delete(id); await db.projects.delete(projectId); await db.settings.where('key').equals(`proofing:es-ES:${projectId}`).delete(); }
}
