import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { CodexEntry, Project, Writing } from '@/types';
import { saveWorldEra, readWorldDocument, saveEraDocument, getEraProject } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { searchProjectContent } from '@/services/projectSearchIndex';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import type { EraRow } from '@/services/worldEras/types';
import '@/engines/codex';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { importLocalMedia } from '@/engines/media/operations';
import { defaultChapterPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
export async function testWorldEraConsumers() {
  const P = `era-consumers-${Date.now()}`, eraId = 'later', scope = { projectId: P, eraId }, results: string[] = [];
  const project: Project = { id: P, title: 'Synthetic era consumers', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['codex', 'writings'], createdAt: 1, updatedAt: 1 };
  const entry: CodexEntry = { id: `${P}-entry`, projectId: P, type: 'location', title: 'Shared harbor', content: '<p>Base harbor prose.</p>', fields: { stores: '2', total: '' }, propertyDefinitions: [{ id: 'stores', key: 'stores', label: 'Stores', kind: 'number' }, { id: 'total', key: 'total', label: 'Total', kind: 'number', formula: '=@[Stores]*3' }], tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const block = `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${entry.id}"></aside>`;
  const writing: Writing = { id: `${P}-chapter`, projectId: P, title: 'Harbor chapter', content: `<p>The journey.</p>${block}`, status: 'draft', wordCount: 2, tags: [], createdAt: 1, updatedAt: 1 };
  const host = document.createElement('div'); document.body.append(host); let dispose: (() => void) | undefined;
  const call = async (name: string, args: Record<string, unknown>) => { const response = await runBridgeTool(name, { projectId: P, eraId, ...args }); assert(response.ok, `${name}: ${JSON.stringify(response)}`); return response.result as Record<string, unknown>; };
  try {
    await db.projects.put(project); await db.codexEntries.put(entry); await db.writings.put(writing);
    await saveWorldEra(P, { id: eraId, name: 'Later age', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const read = (await readWorldDocument(scope, 'codex', entry.id))!;
    await saveEraDocument(scope, 'codex', { root: { ...entry, title: 'Later harbor', content: '<p>Futureonlytoken.</p>', fields: { stores: '5', total: '' } } as unknown as EraRow, children: {} }, read.version);
    const effective = await call('wh_get_codex_entry', { id: entry.id }); assert((effective.fields as Record<string, string>).total === '15' && effective.title === 'Later harbor', 'Ordinary Codex get must project the selected era');
    const updated = await call('wh_update_codex_entry', { id: entry.id, fields: { stores: '7' } });
    assert((await db.codexEntries.get(entry.id))?.fields.stores === '2', 'Normal Codex update leaked into Base');
    const created = await call('wh_create_codex_entry', { title: 'Era-only port', type: 'location' }); assert(!await db.codexEntries.get(String(created.id)), 'Era-only creation wrote Base');
    await call('wh_append_writing', { id: writing.id, content: 'Later manuscript token.' });
    const chapter = await call('wh_get_writing', { id: writing.id }); assert(String(chapter.content).includes('Later manuscript token') && (await db.writings.get(writing.id))?.content === writing.content, 'Ordinary manuscript append escaped its era');
    results.push('Ordinary MCP Codex and manuscript CRUD use explicit era, preserve Base and expose calculated values');

    assert((await searchProjectContent('futureonlytoken', P, 20, eraId)).some(hit => hit.id === entry.id), 'Era prose not searchable');
    assert(!(await searchProjectContent('futureonlytoken', P, 20)).length, 'Era prose leaked into Base index');
    assert((await searchEntities('Later harbor', ['codex'], P, eraId)).some(hit => hit.id === entry.id) && !(await searchEntities('Shared harbor', ['codex'], P, eraId)).length, 'Title search mixed Base and effective names');
    await call('wh_update_codex_entry', { id: entry.id, content: 'Changed future token.' }); await pause();
    assert(!(await searchProjectContent('futureonlytoken', P, 20, eraId)).length && (await searchProjectContent('Changed future token', P, 20, eraId)).length === 1, 'Era mutation did not invalidate its text cache');
    results.push('Title/body search separates Base and era, includes era-only documents and invalidates after edits');

    host.innerHTML = block; dispose = hydrateCodexBlocks(host, P, 'Unavailable', eraId);
    for (let i = 0; i < 60 && !host.textContent?.includes('Later harbor'); i++) await pause();
    assert(host.textContent?.includes('Later harbor') && host.textContent.includes('21'), 'Live reader reference did not use effective calculated properties');
    const effectiveProject = await getEraProject(scope), effectiveWriting = (await readWorldDocument(scope, 'writings', writing.id))!.document.root as unknown as Writing;
    const reader = await buildReaderHtml(effectiveProject, [effectiveWriting], defaultReaderPresentation(), 'en', scope);
    assert(reader.html.includes('Later harbor') && reader.html.includes('<dd>21</dd>') && !reader.html.includes('Base harbor prose'), 'Portable reader resolved Base through an era reference');
    const wiki = buildWorldWiki(await loadWorldWikiData(P, { eraId }), { eraId });
    assert(wiki.html.includes('Later harbor') && !wiki.html.includes('Shared harbor') && wiki.html.includes('Era-only port'), 'Wiki snapshot used Base or lost era-only content');
    results.push('Live Codex blocks, standalone reader and wiki export resolve the same era and live formulas');
    await undoAuditEntry({ entry: { ...(updated.__audit as object), kind: 'update', tool: 'wh_update_codex_entry', eraId } });
    assert((await readWorldDocument(scope, 'codex', entry.id))?.document.root.fields && (await db.codexEntries.get(entry.id))?.fields.stores === '2', 'Undo of an era edit touched Base');
    const undone = await call('wh_get_codex_entry', { id: entry.id }); assert((undone.fields as Record<string, string>).total === '15', 'Era Undo did not restore the recorded field values');
    results.push('MCP change Undo restores the selected era instead of resolving its logical ID to Base');
    const bytes = new Uint8Array(52), wave = new DataView(bytes.buffer);
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) [...text].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
    wave.setUint32(4, 44, true); wave.setUint32(16, 16, true); wave.setUint16(20, 1, true); wave.setUint16(22, 1, true); wave.setUint32(24, 8000, true); wave.setUint32(28, 16000, true); wave.setUint16(32, 2, true); wave.setUint16(34, 16, true); wave.setUint32(40, 8, true);
    const audio = await importLocalMedia(P, new File([bytes], 'Era-only audio.wav', { type: 'audio/wav' }), eraId);
    const mediaBlock = `<figure data-wh-media-block="true" data-project-id="${P}" data-asset-id="${audio.id}"></figure>`;
    const currentEntry = (await readWorldDocument(scope, 'codex', entry.id))!;
    await saveEraDocument(scope, 'codex', { ...currentEntry.document, root: { ...currentEntry.document.root, content: `${currentEntry.document.root.content}${mediaBlock}` } }, currentEntry.version);
    const wikiData = await loadWorldWikiData(P, { eraId });
    assert(wikiData.media?.some(asset => asset.id === audio.id && asset.dataUrl.includes('base64,')), 'Wiki lost an era-only binary asset or failed its asset-store transaction');
    assert(!(await loadWorldWikiData(P)).media?.some(asset => asset.id === audio.id), 'Era audio leaked into Base wiki');
    const initialPresentation = defaultReaderPresentation(), presentation = { ...initialPresentation, chapters: { [writing.id]: { ...defaultChapterPresentation(), audio: { assetId: audio.id, volume: .5, loop: false } } } };
    await saveReaderPresentation(P, presentation, initialPresentation, eraId);
    const scopedReader = await buildReaderHtml(await getEraProject(scope), [{ ...effectiveWriting, content: mediaBlock }], presentation, 'en', scope);
    assert(scopedReader.html.includes('Era-only audio.wav') && scopedReader.html.includes('data:audio/wav;base64,'), 'Portable Reader lost era-only media or soundtrack');
    assert(!await db.localMediaAssets.get(audio.id), 'An era export or presentation update copied audio into Base');
    results.push('Era-only binary assets survive wiki, Reader and soundtrack validation without Base copies');
    return results;
  } finally { dispose?.(); host.remove(); await deleteProject(P); }
}
