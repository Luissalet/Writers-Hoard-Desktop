import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { defaultChapterPresentation, defaultReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import { installReaderSoundtrack, paragraphFingerprint, readerParagraphs } from '@/engines/writings/readerSoundtrack';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import ReaderAudioSettings from '@/engines/writings/components/ReaderAudioSettings';
import { importLocalMedia } from '@/engines/media/operations';
import { silentWav } from './vvd-media.browser';
import { deleteWritingRestorable } from '@/engines/writings/operations';
import { restoreArchivedDocument } from '@/services/documentArchive/store';
import type { ChapterPresentation } from '@/engines/writings/readerPresentationTypes';
import type { Project, Writing } from '@/types';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 45) => new Promise(resolve => setTimeout(resolve, ms));
export async function testReaderSoundtrack(): Promise<string[]> {
  const P = `soundtrack-${Date.now()}`, Q = `${P}-other`; let clone: string | undefined; const passed: string[] = [];
  const project: Project = { id: P, title: 'Synthetic soundtrack', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#aaa', createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: `${P}-chapter`, projectId: P, title: 'The coast', content: '<p>First local paragraph.</p><p>Second local paragraph.</p>', wordCount: 6, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 };
  const host = document.getElementById('root')!, root = createRoot(host), elements: Element[] = []; let dispose: (() => void) | undefined;
  try {
    await db.projects.bulkPut([project, { ...project, id: Q }]); await db.writings.add(writing);
    const asset = await importLocalMedia(P, new File([silentWav()], 'Local track.wav', { type: 'audio/wav' }));
    const foreign = await importLocalMedia(Q, new File([silentWav()], 'FOREIGN SECRET.wav', { type: 'audio/wav' }));
    const paragraphs = readerParagraphs(writing.content), track = { assetId: asset.id, volume: .4, loop: true };
    const chapter = { ...defaultChapterPresentation(), audio: track, paragraphAudio: [{ ...paragraphs[0], track: { ...track, loop: false } }] };
    const base = defaultReaderPresentation(); const settings = { ...base, chapters: { [writing.id]: chapter } }; await saveReaderPresentation(P, settings, base);
    let rejected = false; try { await saveReaderPresentation(P, { ...settings, chapters: { [writing.id]: { ...chapter, audio: { ...track, assetId: foreign.id } } } }, settings); } catch { rejected = true; }
    assert(rejected && (await db.writings.get(writing.id))!.content === writing.content, 'Audio settings refuse foreign files and never mutate prose');
    passed.push('Soundtrack metadata: scoped audio validation, paragraph fingerprints and unchanged manuscript');

    let changed: Partial<ChapterPresentation> | undefined;
    await act(async () => { root.render(<ReaderAudioSettings projectId={P} writing={writing} chapter={defaultChapterPresentation()} change={value => { changed = value; }} locale="en" />); await pause(120); });
    for (let attempt = 0; attempt < 100 && ![...host.querySelectorAll('option')].some(option => option.value === asset.id); attempt++) await act(async () => { await pause(); });
    host.querySelector('details')!.open = true;
    assert(!host.textContent?.includes(foreign.title), 'Audio picker leaks foreign title');
    const selects = [...host.querySelectorAll('select')];
    await act(async () => { selects[0].value = asset.id; selects[0].dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    assert(changed?.audio?.assetId === asset.id, 'Chapter picker did not assign actual local audio');
    await act(async () => { selects[2].value = asset.id; selects[2].dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Assign track')!.click(); await pause(); });
    assert(changed?.paragraphAudio?.[0].fingerprint === paragraphs[0].fingerprint, 'Paragraph picker must bind to the current exact paragraph');
    passed.push('Soundtrack settings UI: local chapter/paragraph pickers and exact current-text cue assignment');

    const viewport = document.createElement('div'), toggle = document.createElement('button'), status = document.createElement('span');
    viewport.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:300px;overflow:auto;background:white';
    viewport.innerHTML = `<article data-piece-id="${writing.id}"><div class="ProseMirror"><p style="height:350px;margin:0">First local paragraph.</p><p style="height:350px;margin:0">Second local paragraph.</p></div></article>`;
    document.body.append(viewport, toggle, status); elements.push(viewport, toggle, status);
    const OriginalAudio = window.Audio; const channels: HTMLAudioElement[] = [], plays: number[] = [], stops: number[] = [];
    window.Audio = function () { const audio = new OriginalAudio(), index = channels.length; channels.push(audio); audio.play = () => { plays[index] = (plays[index] ?? 0) + 1; return Promise.resolve(); }; audio.pause = () => { stops[index] = (stops[index] ?? 0) + 1; }; audio.load = () => undefined; return audio; } as typeof Audio;
    try {
      dispose = installReaderSoundtrack(viewport, toggle, status, [{ id: writing.id, audio: track, cues: chapter.paragraphAudio }], { [asset.id]: 'data:audio/wav;base64,UklGRg==' }, { enable: 'Enable', disable: 'Mute', blocked: 'Blocked', unavailable: 'Missing' });
      assert(!plays.some(Boolean), 'Mount must never autoplay'); toggle.click(); await pause();
      assert(plays[0] === 1 && plays[1] === 1 && channels[0].loop && !channels[1].loop && channels[0].volume === .4, 'Real toggle starts separate configured chapter and paragraph channels');
      viewport.scrollTop = 380; viewport.dispatchEvent(new Event('scroll')); for (let attempt = 0; attempt < 60 && channels[1].getAttribute('src'); attempt++) await pause();
      assert(!channels[1].getAttribute('src') && plays[0] === 1, `Leaving cue stops it without restarting chapter (${JSON.stringify({ plays, scroll: viewport.scrollTop, src: channels[1].getAttribute('src'), rects: [...viewport.querySelectorAll('p')].map(node => [node.getBoundingClientRect().top, node.getBoundingClientRect().bottom]) })})`);
      viewport.querySelector('p')!.textContent = 'Edited paragraph.'; viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll')); await pause();
      assert(plays[1] === 1 && paragraphFingerprint('Edited paragraph.') !== paragraphs[0].fingerprint, 'Edited prose must not trigger stale cue');
      toggle.click(); assert(channels.every(audio => !audio.getAttribute('src')), 'Disable releases both sources');
      dispose(); dispose = undefined; assert(stops.every(count => count > 0), 'Unmount must pause every audio channel');
    } finally { window.Audio = OriginalAudio; dispose?.(); dispose = undefined; }
    passed.push('Actual DOM playback runtime: explicit activation, independent channels, scroll transitions, stale-cue refusal and cleanup');

    const current = (await db.projects.get(P))!; const artifact = await buildReaderHtml(current, [writing], current.readerPresentation!, 'en');
    assert(artifact.html.includes('data-reader-sound-toggle') && artifact.html.includes('data:audio/wav;base64,') && !artifact.html.includes(foreign.title) && !artifact.html.includes('blob:'), 'Offline reader must carry only owned audio bytes');
    const frame = document.createElement('iframe'); document.body.append(frame); elements.push(frame); const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); }); frame.srcdoc = artifact.html; await loaded; await pause(100);
    const exportedToggle = frame.contentDocument!.querySelector<HTMLButtonElement>('[data-reader-sound-toggle]')!;
    assert(exportedToggle.textContent === 'Enable ambience' && exportedToggle.getAttribute('aria-pressed') === 'false', 'Serialized runtime must execute with audio initially silent');
    exportedToggle.click(); assert(exportedToggle.getAttribute('aria-pressed') === 'true', 'Offline exported toggle must run real installed controller');
    exportedToggle.click();
    passed.push('Standalone reader soundtrack: executable serialized runtime, opt-in state and self-contained scoped audio bytes');

    clone = await importProjectData(await exportProjectData(P)); const cloned = (await db.projects.get(clone))!; const copiedWriting = (await db.writings.where('projectId').equals(clone).toArray())[0];
    const copiedAudio = (await db.localMediaAssets.where('projectId').equals(clone).toArray())[0];
    assert(cloned.readerPresentation?.chapters[copiedWriting.id].audio?.assetId === copiedAudio.id && cloned.readerPresentation.chapters[copiedWriting.id].paragraphAudio?.[0].track.assetId === copiedAudio.id && copiedAudio.id !== asset.id, 'Clone must remap chapter and paragraph soundtracks');
    passed.push('Soundtrack portability: actual clone remaps both cue kinds and carries the original binary audio');
    const beforeArchive = (await db.projects.get(P))!.readerPresentation!;
    await deleteWritingRestorable(writing.id);
    const afterArchive = structuredClone(beforeArchive); afterArchive.cover.color = '#223344';
    await saveReaderPresentation(P, afterArchive, beforeArchive);
    assert((await db.projects.get(P))!.readerPresentation!.chapters[writing.id].audio?.assetId === asset.id, 'Unchanged archived chapter settings must survive unrelated cover saves');
    const archived = await db.documentArchives.where('projectId').equals(P).first(); assert(archived, 'Deleted chapter must have durable archive');
    await restoreArchivedDocument(P, archived.id);
    await db.localMediaAssets.delete(asset.id);
    const beforeMissingAudio = (await db.projects.get(P))!.readerPresentation!, changedStyle = structuredClone(beforeMissingAudio); changedStyle.chapters[writing.id].font = 'sans';
    await saveReaderPresentation(P, changedStyle, beforeMissingAudio);
    assert((await db.projects.get(P))!.readerPresentation!.chapters[writing.id].font === 'sans', 'Unavailable unchanged audio must not lock independent font settings');
    passed.push('Reader settings recovery: archived chapter restoration retains presentation and missing unchanged audio does not lock unrelated changes');
    return passed;
  } finally { dispose?.(); elements.forEach(element => element.remove()); await act(async () => root.unmount()); for (const id of [P, Q, clone].filter((id): id is string => Boolean(id))) await deleteProject(id); }
}
