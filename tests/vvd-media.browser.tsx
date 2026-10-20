import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteCodexEntry, deleteProject } from '@/db/operations';
import MediaEngine from '@/engines/media/MediaEngine';
import { importLocalMedia, updateLocalMedia } from '@/engines/media/operations';
import { LocalVoiceRecorder } from '@/engines/media/recorder';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { useLocaleStore } from '@/stores/localeStore';
import { getAllBackupStrategies, registerBackupStrategy } from '@/engines/_shared/backupRegistry';
import { flushPendingWrites } from '@/services/pendingWrites';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export function silentWav(): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + 1600); const view = new DataView(buffer);
  const text = (position: number, source: string) => [...source].forEach((character, index) => view.setUint8(position + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 1600, true);
  return buffer;
}

export async function testVvdMedia(): Promise<string[]> {
  const passed: string[] = []; const P = `media-${Date.now()}`, Q = `${P}-other`, E = `${P}-entry`;
  const root = createRoot(document.getElementById('root')!);
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'); const oldRecorder = window.MediaRecorder;
  let permissions = 0, trackStops = 0;
  const stream = { getTracks: () => [{ stop: () => { trackStops++; } }] } as unknown as MediaStream;
  class FakeRecorder {
    state = 'inactive'; mimeType = 'audio/wav'; ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void; onerror?: () => void;
    static isTypeSupported() { return false; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([silentWav()], { type: this.mimeType }) }); queueMicrotask(() => this.onstop?.()); }
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (constraints: MediaStreamConstraints) => { assert(constraints.audio === true && constraints.video === false, 'Voice recorder must never request camera'); permissions++; return stream; } } });
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  const click = async (text: string) => { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text); assert(button, `Missing ${text}`); await act(async () => { button.click(); await pause(180); }); };
  try {
    const project = { id: P, title: 'Synthetic local media', mode: 'custom' as const, type: 'standalone' as const, color: '#aaa', description: '', status: 'draft' as const, enabledEngines: ['media'], engineOrder: ['media'], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkPut([project, { ...project, id: Q }]);
    await db.codexEntries.put({ id: E, projectId: P, type: 'character', title: 'Iria', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const imported = await importLocalMedia(P, new File([silentWav()], 'Quiet sea.wav', { type: 'audio/wav' }));
    let rejected = false; try { await importLocalMedia(P, new File(['<script>evil</script>'], 'bad.html', { type: 'text/html' })); } catch { rejected = true; } assert(rejected, 'Executable formats must not enter local media');
    await updateLocalMedia(P, imported.id, { title: imported.title, notes: 'Session ambience', tags: ['coast'], linkedEntryIds: [E] });
    rejected = false; try { await updateLocalMedia(Q, imported.id, { title: 'Wrong project', notes: '', tags: [], linkedEntryIds: [] }); } catch { rejected = true; } assert(rejected, 'Media updates must be project scoped');
    const zip = await createProjectZipArchive(P); await db.localMediaAssets.where('projectId').equals(P).delete();
    await importProjectZip(new File([zip.blob], 'media.zip'), { replaceProjectIds: [P] });
    const restored = (await db.localMediaAssets.get(imported.id))!;
    assert(restored.blob.size === silentWav().byteLength && new Uint8Array(await restored.blob.arrayBuffer())[0] === 82 && restored.linkedEntryIds[0] === E, 'Real ZIP restore must reconstruct exact audio bytes and links');
    passed.push('Local media: MIME admission, project scoping, Blob storage and real binary ZIP export/restore');

    const lastStrategy = getAllBackupStrategies().at(-1)!;
    await db.projects.update(P, { title: 'Before failed restore' });
    await db.localMediaAssets.update(imported.id, { notes: 'Before failed restore' });
    registerBackupStrategy({ ...lastStrategy, async importProject(context) { await lastStrategy.importProject(context); throw new Error('Synthetic last-engine failure'); } });
    try {
      let failed = false;
      try { await importProjectZip(new File([zip.blob], 'media.zip'), { replaceProjectIds: [P] }); } catch { failed = true; }
      assert(failed && (await db.projects.get(P))?.title === 'Before failed restore' && (await db.localMediaAssets.get(imported.id))?.notes === 'Before failed restore', 'Last-engine failure must roll back project replacement and earlier binary media writes together');
    } finally { registerBackupStrategy(lastStrategy); }
    passed.push('Binary ZIP atomicity: a last-engine failure rolls back project clearing and all earlier media writes');

    useLocaleStore.setState({ locale: 'en' });
    await act(async () => { root.render(<StrictMode><MemoryRouter><MediaEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(150); });
    for (let attempt = 0; attempt < 100 && !document.querySelector('audio'); attempt++) await act(async () => { await pause(); });
    const player = document.querySelector<HTMLAudioElement>('audio')!;
    assert(player && player.src.startsWith('blob:') && permissions === 0, 'Mount must use local Blob source and never request microphone');
    for (let attempt = 0; attempt < 100 && !Number.isFinite(player.duration); attempt++) await pause();
    assert(Math.abs(player.duration - .1) < .01, 'Real audio decoder should read the imported WAV');
    passed.push('Local media UI: actual offline audio decoder, native playback control and no microphone on mount');
    await click('Record voice note'); assert(permissions === 1, 'Record action requests microphone exactly once');
    await click('Pause recording'); assert(document.body.textContent?.includes('Recording paused'), 'Pause visible');
    await click('Resume recording'); await click('Stop recording');
    assert(trackStops > 0 && document.body.textContent?.includes('Recorded voice note'), 'Stop must release hardware and preserve preview');
    await click('Save recording');
    assert(await db.localMediaAssets.where('projectId').equals(P).count() === 2, 'Voice note save must persist audio bytes locally');
    await act(async () => { useLocaleStore.setState({ locale: 'es' }); await pause(); });
    assert(document.body.textContent?.includes('Grabar nota de voz'), 'Spanish controls must render');
    passed.push('Voice notes UI: explicit permission, pause/resume, release tracks, preview/save and bilingual controls (synthetic recorder, no real microphone)');

    await click('Grabar nota de voz'); await click('Detener grabación');
    assert((await flushPendingWrites()).ok && await db.localMediaAssets.where('projectId').equals(P).count() === 3, 'App close flush must persist preview before leaving');
    await flushPendingWrites();
    assert(await db.localMediaAssets.where('projectId').equals(P).count() === 3, 'Repeated flush must not duplicate preview');
    await click('Guardar grabación'); await click('Grabar nota de voz');
    await act(async () => { root.unmount(); await pause(); });
    for (let attempt = 0; attempt < 50 && await db.localMediaAssets.where('projectId').equals(P).count() < 4; attempt++) await pause();
    assert(await db.localMediaAssets.where('projectId').equals(P).count() === 4, 'Navigating away during active recording must save it once');
    passed.push('Voice note recovery: close flush preserves preview once; navigation saves active recording and releases tracks');
    let resolve!: (stream: MediaStream) => void;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise<MediaStream>(done => { resolve = done; }) } });
    const pending = new LocalVoiceRecorder(); const start = pending.start(); pending.dispose(); const before = trackStops; resolve(stream); await start;
    assert(trackStops === before + 1, 'Permission completing after unmount must immediately release microphone');
    passed.push('Voice notes lifecycle: pending-permission cancellation releases hardware without recording');
    await deleteCodexEntry(E);
    assert(!(await db.localMediaAssets.get(imported.id))!.linkedEntryIds.length, 'Deleting linked entry must unlink audio while preserving bytes');
    await deleteProject(P);
    assert(await db.localMediaAssets.where('projectId').equals(P).count() === 0 && await db.projects.get(Q), 'Project deletion must remove media only in that project');
    passed.push('Local media lifecycle: Codex unlink and scoped project deletion');
    return passed;
  } finally {
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia); else Reflect.deleteProperty(navigator, 'mediaDevices');
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: oldRecorder });
    await db.localMediaAssets.where('projectId').equals(P).delete(); await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.bulkDelete([P, Q]);
  }
}
