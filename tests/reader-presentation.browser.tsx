import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { defaultChapterPresentation, defaultReaderPresentation, readerInk, safeReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import ReaderPresentationModal from '@/engines/writings/components/ReaderPresentationModal';
import ReadingView from '@/engines/writings/components/ReadingView';
import { importLocalMedia } from '@/engines/media/operations';
import { silentWav } from './vvd-media.browser';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export async function testReaderPresentation(): Promise<string[]> {
  const P = `reader-${Date.now()}`, Q = `${P}-other`, passed: string[] = []; let clone: string | undefined;
  const project: Project = { id: P, title: 'Synthetic coast </script><script>window.__injected=1</script>', description: '', mode: 'custom', type: 'standalone', status: 'draft', enabledEngines: ['writings', 'media'], engineOrder: ['writings', 'media'], color: '#aaa', createdAt: 1, updatedAt: 1 };
  const first: Writing = { id: `${P}-first`, projectId: P, title: 'The coast', status: 'draft', content: `<p>${'The tide carried the old map home. '.repeat(500)}</p>`, wordCount: 3500, tags: [], createdAt: 1, updatedAt: 1 };
  const second = { ...first, id: `${P}-second`, title: 'The mountain', content: '<p>A second chapter.</p>', wordCount: 3 };
  const root = createRoot(document.getElementById('root')!); const frames: HTMLIFrameElement[] = [];
  const wait = async (test: () => boolean) => { for (let i = 0; i < 120; i++) { if (test()) return; await act(async () => { await pause(); }); } throw Error('Reader did not settle'); };
  const select = async (label: string, value: string) => { const node = [...document.querySelectorAll<HTMLSelectElement>('select')].find(node => node.closest('label')?.textContent?.startsWith(label)); assert(node, `Missing ${label}`); await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); await pause(); }); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.bulkPut([project, { ...project, id: Q }]); await db.writings.bulkPut([first, second]);
    const base = defaultReaderPresentation(); const local = structuredClone(base); local.cover.showAtStart = true; local.cover.color = '#f1e6ce'; local.chapters[first.id] = { ...defaultChapterPresentation(), background: '#ffffff', font: 'mono', mode: 'pages' };
    await saveReaderPresentation(P, local, base);
    const remote = structuredClone(base); remote.chapters[second.id] = { ...defaultChapterPresentation(), background: '#161a1c', font: 'sans' }; await saveReaderPresentation(P, remote, base);
    let current = (await db.projects.get(P))!;
    assert(current.readerPresentation?.chapters[first.id].font === 'mono' && current.readerPresentation.chapters[second.id].font === 'sans', 'Independent chapters must merge');
    let rejected = false; try { await saveReaderPresentation(P, { ...base, cover: { ...base.cover, color: '#001122' } }, base); } catch { rejected = true; }
    assert(rejected && readerInk('#ffffff') === '#000000' && readerInk('#161a1c') === '#ffffff' && safeReaderPresentation({ chapters: { bad: null } } as never).chapters.bad.mode === 'flow', 'Conflicting cover must reject, imported metadata normalize and ink stay readable');
    assert((await db.writings.get(first.id))?.content === first.content, 'Presentation must never edit prose');
    passed.push('Reader settings: independent chapter merge, same-field conflict refusal, defensive import normalization and automatic readable ink');

    let closed = 0; await act(async () => { root.render(<ReaderPresentationModal project={current} writings={[first, second]} initialWritingId={first.id} onClose={() => { closed++; }} />); await pause(); });
    await select('Cover', 'paperback');
    const angle = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(angle, '40'); angle.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    assert(document.querySelector<HTMLElement>('.wh-reader-book')?.style.transform.includes('40deg') && document.querySelector('[data-cover-style="paperback"]'), 'Real cover controls must change 3D geometry/rotation');
    await act(async () => { document.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(120); });
    assert(closed === 1 && (await db.projects.get(P))!.readerPresentation!.cover.style === 'paperback', 'Actual settings UI persists');
    passed.push('Reader studio UI: hardcover/paperback geometry, keyboard range rotation and saved presentation');

    current = (await db.projects.get(P))!; let exits = 0;
    await act(async () => { root.render(<ReadingView pieces={[first, second]} onClose={() => { exits++; }} onOpenInEditor={() => undefined} />); await pause(180); });
    await wait(() => Boolean(document.querySelector('.wh-reader-pages')));
    assert(document.querySelector(`[data-piece-id="${first.id}"]`)?.classList.contains('wh-reader-themed') && document.querySelector('.wh-reader-cover'), 'Reader integrates theme, pages and cover');
    const studio = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'Reader presentation')!;
    await act(async () => { studio.click(); await pause(); });
    await select('Font', 'sans');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await pause(); });
    assert(exits === 0 && document.querySelector('form'), 'Reader shortcuts must not steal settings input');
    passed.push('Integrated reader: chapter theme/pages/3D cover and modal keyboard isolation without manuscript mutation');

    const own = await importLocalMedia(P, new File([silentWav()], 'Local sea.wav', { type: 'audio/wav' }));
    const foreign = await importLocalMedia(Q, new File([silentWav()], 'FOREIGN HIDDEN.wav', { type: 'audio/wav' }));
    const withAudio = { ...first, content: first.content + `<figure data-wh-media-block="true" data-project-id="${P}" data-asset-id="${own.id}"><figcaption>Local sea</figcaption></figure><figure data-wh-media-block="true" data-project-id="${Q}" data-asset-id="${foreign.id}"><figcaption>FOREIGN HIDDEN.wav</figcaption></figure>` };
    const artifact = await buildReaderHtml(current, [withAudio, second], current.readerPresentation!, 'en');
    assert(!artifact.html.includes(foreign.title) && !artifact.html.includes('blob:') && artifact.html.includes('media-src data:'), 'Reader export must be local and scoped');
    const frame = document.createElement('iframe'); frame.style.width = '1200px'; frame.style.height = '900px'; document.body.append(frame); frames.push(frame);
    const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); }); frame.srcdoc = artifact.html; await loaded; await pause(200);
    const doc = frame.contentDocument!;
    assert(!('__injected' in frame.contentWindow!) && doc.querySelectorAll('audio').length === 1 && doc.querySelector('audio')!.src.startsWith('data:audio/wav;base64,'), 'Real reader artifact rejects title script and embeds exact admitted audio');
    const slider = doc.querySelector<HTMLInputElement>('[data-cover-angle]')!; slider.value = '25'; slider.dispatchEvent(new Event('input', { bubbles: true })); assert(doc.querySelector<HTMLElement>('.wh-reader-book')!.style.transform.includes('25deg'), 'Exported 3D controls execute offline');
    const prose = doc.querySelector<HTMLElement>('.wh-reader-pages .ProseMirror')!; assert(prose.scrollWidth > prose.clientWidth, 'Horizontal reader should contain actual multiple columns');
    doc.querySelector<HTMLButtonElement>('[data-reader-turn="1"]')!.click(); assert(prose.scrollLeft > 0, 'Exported page controls actually advance');
    passed.push('Standalone HTML reader: executable cover/paging, actual columns, self-contained audio, no foreign bytes and inert user HTML');

    clone = await importProjectData(await exportProjectData(P)); const cloned = (await db.projects.get(clone))!; const chapter = (await db.writings.where('projectId').equals(clone).toArray()).find(writing => writing.title === first.title)!;
    assert(cloned.readerPresentation?.chapters[chapter.id]?.mode === 'pages' && !cloned.readerPresentation.chapters[first.id] && cloned.readerPresentation.cover.style === 'paperback', 'JSON clone must remap chapter presentation pointers');
    passed.push('Reader portability: chapter styles and cover survive an actual project clone without source IDs');
    return passed;
  } finally { for (const frame of frames) frame.remove(); await act(async () => root.unmount()); for (const id of [P, Q, clone].filter((id): id is string => Boolean(id))) await deleteProject(id); }
}
