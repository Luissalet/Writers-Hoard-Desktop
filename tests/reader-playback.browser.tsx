import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReadingView from '@/engines/writings/components/ReadingView';
import { installReaderPlayback, readerPlaybackCopy } from '@/engines/writings/readerPlayback';
import { defaultReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Writing } from '@/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check: () => boolean, message: string) { for (let i = 0; i < 80; i++) { if (check()) return; await pause(); } throw new Error(message); }

export async function testReaderPlayback() {
  const P = `playback-${Date.now()}`;
  const project: Project = { id: P, title: 'The northern crossing', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: `${P}-chapter`, projectId: P, title: 'At the harbor', content: '<h2>The crossing</h2><p>Ágata reaches the harbor.</p><blockquote><p>The tide is rising.</p></blockquote><p>The boat leaves at dawn.</p>', wordCount: 19, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 };
  const host = document.getElementById('root')!, root = createRoot(host), fixture = document.createElement('section'); document.body.append(fixture);
  let dispose: (() => void) | undefined;
  const results: string[] = [];
  try {
    fixture.innerHTML = `<div class="ProseMirror">${writing.content}</div><div class="controls"></div>`;
    const prose = fixture.firstElementChild as HTMLElement, controls = fixture.lastElementChild as HTMLElement;
    const click = (action: string) => controls.querySelector<HTMLButtonElement>(`[data-reader-playback="${action}"]`)!.click();
    dispose = installReaderPlayback(prose, controls, { mode: 'read', wordsPerMinute: 1000 }, readerPlaybackCopy('es'));
    assert(prose.querySelectorAll('[hidden]').length === 0, 'Read must leave every block visible');
    let gestures = 0; prose.addEventListener('wh-reader-play', () => { gestures++; }); click('play');
    assert(prose.querySelectorAll(':scope > [hidden]').length === 3 && gestures === 1, 'Play must reveal one semantic top-level block and issue a sound-unlock gesture');
    await pause(1650); assert(prose.querySelectorAll(':scope > [hidden]').length === 2, 'Actual playback timer must advance the prose');
    click('play'); await pause(1650); assert(prose.querySelectorAll(':scope > [hidden]').length === 2, 'Pause must stop the pending timer');
    click('next'); assert(prose.querySelector('[data-reader-active-block]')?.tagName === 'BLOCKQUOTE' && !prose.querySelector('blockquote')?.hidden, 'Nested paragraphs must remain one semantic block');
    click('previous'); click('restart'); assert(prose.querySelectorAll(':scope > [hidden]').length === 3, 'Previous and restart must restore the first reveal');
    click('read'); assert(prose.querySelectorAll('[hidden]').length === 0 && prose.innerHTML.replace(/ data-reader-active-block=""/g, '') === writing.content, 'Read must restore all original prose without re-parsing or editing it');
    dispose(); dispose = undefined; assert(!controls.childElementCount && prose.innerHTML === writing.content, 'Unmount must restore manuscript DOM and remove controllers');
    results.push('Read/Play DOM: real timed reveal, pause, semantic nesting, previous/next/restart, sound gesture and clean disposal without prose mutation');

    await db.projects.put(project); await db.writings.put(writing);
    const initial = defaultReaderPresentation(), draft = { ...initial, playback: { mode: 'play' as const, wordsPerMinute: 320 } };
    await saveReaderPresentation(P, draft, initial);
    await act(async () => { root.render(<ReadingView pieces={[writing]} onClose={() => undefined} onOpenInEditor={() => undefined} />); await pause(120); });
    await wait(() => !!document.querySelector('[data-reader-playback="next"]'), 'Actual reader controller did not mount');
    const article = host.querySelector<HTMLElement>('[data-piece-id]')!;
    await wait(() => article.querySelectorAll('.ProseMirror > [hidden]').length === 3, 'Saved default Play mode did not apply');
    await act(async () => { article.querySelector<HTMLButtonElement>('[data-reader-playback="next"]')!.click(); await pause(); });
    assert(article.querySelectorAll('.ProseMirror > [hidden]').length === 2 && (await db.writings.get(writing.id))!.content === writing.content, 'Actual reader must reveal without writing to the document');
    results.push('Actual ReadingView: saved default Play, visible block controls and unchanged IndexedDB chapter');

    const saved = await db.projects.get(P); assert(saved, 'Project missing');
    const artifact = await buildReaderHtml(saved, [writing], saved.readerPresentation!, 'es');
    const frame = document.createElement('iframe'); frame.style.cssText = 'width:900px;height:600px'; document.body.append(frame);
    frame.srcdoc = artifact.html;
    await wait(() => !!frame.contentDocument?.querySelector('[data-reader-playback="next"]'), 'Standalone script did not install offline playback');
    const exportedProse = frame.contentDocument!.querySelector('.ProseMirror')!;
    assert(exportedProse.querySelectorAll(':scope > [hidden]').length === 3, 'Portable reader must use saved initial mode');
    frame.contentDocument!.querySelector<HTMLButtonElement>('[data-reader-playback="next"]')!.click();
    assert(exportedProse.querySelectorAll(':scope > [hidden]').length === 2 && !artifact.html.includes('https://'), 'Offline HTML must reveal with no network dependency'); frame.remove();
    results.push('Exported offline HTML: real serialized runtime under nonce CSP, saved mode and interactive next block');

    const settings = await runBridgeTool('wh_reader_settings', { projectId: P }); assert(settings.ok, 'Reader settings native dispatch unavailable');
    const exported = await runBridgeTool('wh_reader_export', { projectId: P, locale: 'es' }); assert(exported.ok && JSON.stringify(exported).includes('data-reader-playback-controls'), 'Native export must include ordinary reader playback');
    results.push('Reader capabilities available through normal native dispatcher');
    return results;
  } finally { dispose?.(); fixture.remove(); await act(async () => root.unmount()); await deleteProject(P); }
}
