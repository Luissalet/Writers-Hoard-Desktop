import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { db } from '@/db';
import { exportProjectData, importProjectData, deleteProject } from '@/db/operations';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { importLocalMedia } from '@/engines/media/operations';
import { hydrateLocalMediaBlocks } from '@/engines/media/readingBlocks';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { silentWav } from './vvd-media.browser';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export async function testMediaBlocks(): Promise<string[]> {
  const passed: string[] = [], P = `media-blocks-${Date.now()}`, Q = `${P}-other`;
  const root = createRoot(document.getElementById('root')!); let editor: Editor | null = null, edits = 0, clone: string | undefined;
  const ready = (value: Editor | null) => { editor = value; }; const changed = () => { edits++; };
  const project = { id: P, title: 'Synthetic media manuscript', type: 'standalone' as const, mode: 'custom' as const, description: '', color: '#aaa', status: 'draft' as const, enabledEngines: ['media', 'codex', 'writings'], engineOrder: ['media', 'codex', 'writings'], createdAt: 1, updatedAt: 1 };
  const render = async (projectId = P) => { await act(async () => { root.render(<MemoryRouter><TiptapEditor referenceContext={{ projectId, scopeId: 'chapter' }} content="<p>At the coast.</p>" onChange={changed} onEditorReady={ready} /></MemoryRouter>); await pause(180); }); };
  const wait = async (test: () => boolean) => { for (let i = 0; i < 100; i++) { if (test()) return; await act(async () => { await pause(); }); } throw Error('Media block did not settle'); };
  try {
    useLocaleStore.setState({ locale: 'en' });
    await db.projects.bulkPut([project, { ...project, id: Q }]);
    const asset = await importLocalMedia(P, new File([silentWav()], 'Synthetic waves.wav', { type: 'audio/wav' }));
    const foreign = await importLocalMedia(Q, new File([silentWav()], 'FOREIGN PRIVATE AUDIO.wav', { type: 'audio/wav' }));
    await render(); await wait(() => Boolean(editor));
    await act(async () => { document.querySelector<HTMLElement>('[data-editor-document-tools] > summary')!.click(); await pause(); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[data-media-block-controls] button')][0].click(); await pause(); });
    const pick = [...document.querySelectorAll<HTMLButtonElement>('[data-media-block-controls] li button')].find(button => button.textContent === asset.title)!;
    assert(pick && !document.body.textContent?.includes(foreign.title), 'Picker exposes only this project assets');
    await act(async () => { pick.click(); await pause(100); }); await wait(() => Boolean(document.querySelector('audio')));
    const instance = editor as unknown as Editor; const html = instance.getHTML();
    assert(html.includes('data-wh-media-block="true"') && html.includes(asset.id) && !html.includes('blob:') && !html.includes('base64'), 'Saved prose stores only scoped pointers and a meaningful fallback');
    const audio = document.querySelector<HTMLAudioElement>('audio')!; await wait(() => Number.isFinite(audio.duration)); assert(Math.abs(audio.duration - .1) < .01, 'Actual editor player decodes local WAV');
    await act(async () => { instance.commands.undo(); await pause(); }); assert(!document.querySelector('audio'), 'Undo removes attachment');
    await act(async () => { instance.commands.redo(); await pause(); }); await wait(() => Boolean(document.querySelector('audio')));
    passed.push('Embedded media authoring: scoped collapsed picker, real decoder, pointer-only persistence and native undo/redo');

    const before = edits; await act(async () => { await db.localMediaAssets.update(asset.id, { title: 'Updated current audio' }); await pause(100); });
    await wait(() => document.querySelector('[data-local-media-view] figcaption')?.textContent === 'Updated current audio');
    assert(edits === before && instance.getHTML() === html, 'Source metadata refresh never edits host prose');
    await act(async () => { instance.commands.insertLocalMediaBlock({ projectId: P, assetId: foreign.id, label: 'Forged title' }); await pause(100); });
    assert(document.querySelectorAll('audio').length === 1 && !document.body.textContent?.includes(foreign.title), 'Forged same-project pointer never reads a foreign asset');
    await act(async () => { instance.commands.undo(); await pause(); });
    await render(Q); await wait(() => !document.querySelector('audio'));
    passed.push('Embedded media lifecycle: metadata refresh leaves prose unchanged; forged IDs and changing context cannot reveal another project');

    const reader = document.createElement('div'); reader.innerHTML = html; document.body.append(reader);
    const dispose = hydrateLocalMediaBlocks(reader, P, 'Unavailable'); await wait(() => Boolean(reader.querySelector('audio')));
    const readingPlayer = reader.querySelector<HTMLAudioElement>('audio')!; await wait(() => Number.isFinite(readingPlayer.duration)); assert(Math.abs(readingPlayer.duration - .1) < .01 && reader.querySelector('figcaption')?.textContent === 'Updated current audio', 'Reading view hydrates a current local player');
    dispose(); assert(!reader.querySelector('audio') && !readingPlayer.getAttribute('src'), 'Unmount releases audio source'); reader.remove();
    passed.push('Read mode: current local attachment playback and explicit Blob/player cleanup');

    await db.codexEntries.put({ id: 'entry', projectId: P, title: 'Coast', type: 'location', fields: {}, content: html, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const data = await loadWorldWikiData(P); const wiki = buildWorldWiki(data).html;
    const doc = new DOMParser().parseFromString(wiki, 'text/html'); assert(doc.querySelector('audio')?.src.startsWith('data:audio/wav;base64,') && wiki.includes('media-src data:') && !wiki.includes('blob:'), 'Wiki must embed admitted bytes with offline CSP');
    const omitted = buildWorldWiki(data, { includeMedia: false }).html; assert(!omitted.includes('Updated current audio') && !omitted.includes('data:audio'), 'Omitted media bytes and fallback titles are physically absent');
    assert((await loadWorldWikiData(P, { excludedEntryIds: ['entry'] })).media?.length === 0, 'Loader never reads media belonging only to excluded documents');
    passed.push('Offline wiki: selected local bytes are self-contained; omitted media/documents leak neither bytes nor filenames');

    await db.writings.put({ id: 'chapter', projectId: P, title: 'Chapter', status: 'draft', content: html, wordCount: 3, tags: [], createdAt: 1, updatedAt: 1 });
    const exported = await exportProjectData(P); clone = await importProjectData(JSON.parse(JSON.stringify(exported)));
    const clonedAsset = (await db.localMediaAssets.where('projectId').equals(clone).toArray())[0]; const clonedChapter = (await db.writings.where('projectId').equals(clone).toArray())[0];
    assert(clonedAsset.id !== asset.id && clonedAsset.blob.size === asset.blob.size && clonedChapter.content.includes(clonedAsset.id) && clonedChapter.content.includes(`data-project-id="${clone}"`) && !clonedChapter.content.includes(asset.id), 'Actual JSON clone must carry bytes and remap embedded references');
    passed.push('Project JSON portability: exact local bytes and embedded chapter references clone into their own project');
    return passed;
  } finally { await act(async () => root.unmount()); for (const id of [P, Q, clone].filter((id): id is string => Boolean(id))) await deleteProject(id); }
}
