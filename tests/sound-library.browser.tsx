// The built-in sound library (made on this device: ambience, weather,
// effects) and paragraph cues that play over a passage: real WAV files that
// decode, added once to the project, the picker, the cue range and the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import SoundLibraryPicker from '@/engines/media/SoundLibraryPicker';
import { SOUND_LIBRARY, addLibrarySound, renderLibrarySound, wavBlob } from '@/engines/media/soundLibrary';
import ReaderAudioSettings from '@/engines/writings/components/ReaderAudioSettings';
import { safeReaderPresentation } from '@/engines/writings/readerPresentation';
import { readerParagraphs } from '@/engines/writings/readerSoundtrack';
import type { ChapterPresentation, ReaderPresentation } from '@/engines/writings/readerPresentationTypes';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testSoundLibrary(): Promise<string[]> {
  const passed: string[] = [];
  const context = new OfflineAudioContext(1, 22050, 22050);
  for (const sound of SOUND_LIBRARY) {
    const samples = renderLibrarySound(sound.id);
    let peak = 0, energy = 0; for (const value of samples) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    assert(samples.length === Math.floor(sound.seconds * 22050) && peak > 0.5 && peak <= 0.81 && Math.sqrt(energy / samples.length) > 0.01, `${sound.id}: peak ${peak}`);
    assert(renderLibrarySound(sound.id)[1000] === samples[1000], `${sound.id} is the same every time`);
  }
  const blob = wavBlob(renderLibrarySound('rain'));
  const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  assert(head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WAVE' && Math.abs(decoded.duration - 12) < 0.01, `WAV: ${head} ${decoded.duration}`);
  passed.push(`Library: ${SOUND_LIBRARY.length} sounds (${SOUND_LIBRARY.map(sound => sound.es).join(', ')}), each audible, the same every time, written as a WAV the browser decodes (Lluvia: 12 s)`);

  const P = 'sound-library';
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await db.projects.put({ id: P, title: 'Puerto Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'media'], createdAt: 1, updatedAt: 1 } as Project);
    const first = await addLibrarySound(P, 'fire', 'es'), again = await addLibrarySound(P, 'fire', 'es');
    assert(first.id === again.id && first.title === 'Hoguera' && first.mime === 'audio/wav' && first.kind === 'audio' && first.tags.includes('library:fire'), 'Added once');
    await act(async () => { root = createRoot(host); root.render(<SoundLibraryPicker projectId={P} locale="es" />); await pause(100); });
    const items = () => [...document.querySelectorAll('[data-testid^="sound-library-item-"]')].map(item => item.getAttribute('data-testid')!.replace('sound-library-item-', ''));
    const category = document.querySelector('[data-testid="sound-library-category"]') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(category, 'weather'); category.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); });
    assert(items().join() === 'rain,wind,thunder', `Weather: ${items()}`);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(category, ''); category.dispatchEvent(new Event('change', { bubbles: true })); await pause(30); });
    const search = document.querySelector('[data-testid="sound-library-search"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'olas'); search.dispatchEvent(new Event('input', { bubbles: true })); await pause(60); });
    assert(items().join() === 'sea', `Search: ${items()}`);
    await act(async () => { (document.querySelector('[data-testid="sound-library-add-sea"]') as HTMLButtonElement).click(); await pause(400); });
    assert(/Añadido/.test(document.querySelector('[data-testid="sound-library-add-sea"]')?.textContent ?? '') && (await db.localMediaAssets.where('projectId').equals(P).toArray()).some(asset => asset.title === 'Olas del mar'), 'Sea added');
    passed.push('Picker: "Biblioteca de sonidos" filters by Clima (Lluvia, Viento, Trueno) and by search ("olas" → Olas del mar); "Añadir al proyecto" adds it to the project\'s sounds (once)');

    // A cue over a passage.
    const writing = { id: 'sl-w', projectId: P, title: 'Tormenta', status: 'draft', content: '<p>Uno.</p><p>Dos.</p><p>Tres.</p><p>Cuatro.</p>', wordCount: 4, tags: [], createdAt: 1, updatedAt: 1 } as Writing;
    const fingerprint = readerParagraphs(writing.content)[0].fingerprint;
    let chapter: ChapterPresentation = { font: 'inherit', background: '', imageLayout: 'none', mode: 'flow', paragraphAudio: [{ paragraphIndex: 0, fingerprint, excerpt: 'Uno.', track: { assetId: first.id, volume: 0.6, loop: true } }] };
    await act(async () => { root!.render(<ReaderAudioSettings projectId={P} writing={writing} chapter={chapter} change={value => { chapter = { ...chapter, ...value }; }} locale="es" />); await pause(200); });
    const through = document.querySelector('[data-testid="cue-through-0"]') as HTMLSelectElement;
    assert(through && [...through.options].map(option => option.value).join() === ',1,2,3', `Range options: ${through && [...through.options].map(option => option.value)}`);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(through, '2'); through.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); });
    assert(chapter.paragraphAudio?.[0].through === 2, `Through: ${JSON.stringify(chapter.paragraphAudio)}`);
    const kept = safeReaderPresentation({ revision: 1, chapters: { 'sl-w': chapter } } as unknown as ReaderPresentation);
    const bad = safeReaderPresentation({ revision: 1, chapters: { 'sl-w': { ...chapter, paragraphAudio: [{ ...chapter.paragraphAudio![0], through: 0 }] } } } as unknown as ReaderPresentation);
    assert(kept.chapters['sl-w'].paragraphAudio?.[0].through === 2 && bad.chapters['sl-w'].paragraphAudio?.[0].through === undefined, 'Range kept when valid');
    assert(!!document.querySelector('[data-testid="sound-library"]'), 'The library is offered in the chapter sound settings too');
    passed.push('Cue range: a cue on paragraph 1 can "Sonar hasta el párrafo 3" (an ambience over a passage) or only on its paragraph (an effect); the range is kept, an impossible one dropped; the library is offered there too');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  try {
    const listed = await runBridgeTool('wh_sound_library', {});
    assert(listed.ok && (listed.result as { sounds: { id: string }[] }).sounds.length === SOUND_LIBRARY.length, 'Bridge list');
    const added = await runBridgeTool('wh_sound_library', { projectId: P, add: 'bell', locale: 'es' });
    const assetId = (added.result as { added: { assetId: string } }).added.assetId;
    assert(added.ok && (await db.localMediaAssets.get(assetId))?.title === 'Campana', `Bridge add: ${JSON.stringify(added).slice(0, 200)}`);
    const bad = await runBridgeTool('wh_sound_library', { projectId: P, add: 'dragon' });
    assert(!bad.ok && /Sounds: rain, wind/.test(JSON.stringify(bad)), 'Unknown sound refused');
    passed.push('Bridge: wh_sound_library lists the 12 sounds and add:"bell" puts Campana among the project\'s sounds, returning its assetId; an unknown id is refused with the list');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
