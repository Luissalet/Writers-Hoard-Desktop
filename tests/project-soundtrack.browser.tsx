import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectSoundtrack from '@/components/project/workspace/ProjectSoundtrack';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { importLocalMedia } from '@/engines/media/operations';
import { silentWav } from './vvd-media.browser';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 45));
export async function testProjectSoundtrack() {
  const P = `project-sound-${Date.now()}`, Q = `${P}-other`, host = document.getElementById('root')!, root = createRoot(host);
  const render = async (view: string) => { await act(async () => { root.render(<><ProjectSoundtrack projectId={P} locale="en" /><section>{view}</section></>); await pause(); }); };
  const wait = async (condition: () => boolean) => { for (let i = 0; i < 100 && !condition(); i++) await act(async () => { await pause(); }); assert(condition(), 'Local project soundtrack did not settle'); };
  try {
    await db.projects.bulkPut([P,Q].map(id => ({ id, title: 'Synthetic', description: '', mode: 'custom' as const, type: 'standalone' as const, status: 'draft' as const, color: '#aaa', createdAt: 1, updatedAt: 1 })));
    const own = await importLocalMedia(P, new File([silentWav()], 'Own local ambience.wav', { type: 'audio/wav' }));
    const foreign = await importLocalMedia(Q, new File([silentWav()], 'PRIVATE FOREIGN AUDIO.wav', { type: 'audio/wav' }));
    await render('Codex'); await wait(() => Boolean(host.querySelector(`option[value="${own.id}"]`)));
    assert(!host.textContent?.includes(foreign.title) && !host.querySelector('audio'), 'Opening workspace must neither expose other projects nor create an autoplay source');
    await act(async () => { host.querySelector('details')!.open = true; const select = host.querySelector('select')!; select.value = own.id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    await wait(() => Number.isFinite(host.querySelector('audio')?.duration)); const audio = host.querySelector('audio')!, source = audio.src;
    assert(audio.paused && audio.loop && Math.abs(audio.duration - .1) < .01 && source.startsWith('blob:'), 'Selected file must use real local decoding and remain paused');
    await render('Map tool'); assert(host.querySelector('audio') === audio && audio.src === source, 'Tool navigation must keep the same player and source');
    host.querySelector('details')!.open = false; assert(host.querySelector('audio') === audio && audio.src === source, 'Collapsing controls must preserve playback identity');
    await act(async () => { await db.localMediaAssets.update(own.id, { title: 'Renamed ambience.wav' }); await pause(); });
    await wait(() => host.textContent?.includes('Renamed ambience.wav') === true); assert(host.querySelector('audio') === audio && audio.src === source, 'Metadata refresh must not restart audio');
    await act(async () => { await db.localMediaAssets.delete(own.id); await pause(); }); await wait(() => !host.querySelector('audio'));
    assert(!audio.getAttribute('src'), 'Deleted file must release the active source');
    return ['Project ambience: current scoped audio, no autoplay, native WAV decoding, stable playback across tool changes/disclosure/metadata and deletion cleanup'];
  } finally { await act(async () => root.unmount()); await deleteProject(P); await deleteProject(Q); }
}
