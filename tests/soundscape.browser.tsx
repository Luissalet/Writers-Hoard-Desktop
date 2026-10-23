// Soundscapes: a named mix with scenes, loops that play together at their
// levels, a one-shot fired by hand, the live scene switched while listening,
// stop; kept with the project; built through the bridge, with undo.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import SoundscapePanel from '@/engines/soundscape/SoundscapePanel';
import { addLibrarySound } from '@/engines/media/soundLibrary';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const setValue = async (element: Element | null, value: string) => { assert(element, 'control'); const control = element as HTMLInputElement | HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(150); }); };
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(200); }); };

export async function testSoundscape(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [], P = 'soundscape-test', host = document.getElementById('root')!, root = createRoot(host);
  try {
    await db.projects.put({ id: P, title: 'Puerto', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } as Project);
    const rain = await addLibrarySound(P, 'rain', 'es'), sea = await addLibrarySound(P, 'sea', 'es'), bell = await addLibrarySound(P, 'bell', 'es');
    await act(async () => { root.render(<SoundscapePanel projectId={P} locale="es" />); await pause(300); });
    await setValue(host.querySelector('[data-testid="soundscape-name"]'), 'Tormenta en el puerto');
    await click(host.querySelector('[data-testid="soundscape-create"]'), 'create');
    await until(() => !!host.querySelector('[data-testid="soundscape-add-strip"]'), 'created');
    for (const asset of [rain, sea, bell]) { await setValue(host.querySelector('[data-testid="soundscape-add-strip"]'), asset.id); await until(async () => ((await db.projects.get(P))?.soundscapes?.items[0].scenes[0].strips.length ?? 0) >= [rain, sea, bell].indexOf(asset) + 1, `strip ${asset.title}`); }
    const strips = () => [...host.querySelectorAll('[data-testid="soundscape-strip"]')];
    assert(strips().length === 3, 'Three strips');
    await setValue(strips()[2].querySelector('[data-testid="soundscape-strip-kind"]'), 'oneshot');
    await setValue(strips()[0].querySelector('[data-testid="soundscape-strip-gain"]'), '0.4');
    await until(async () => { const scene = (await db.projects.get(P))!.soundscapes!.items[0].scenes[0]; return scene.strips[2].kind === 'oneshot' && scene.strips[0].gain === 0.4; }, 'kind and level saved');
    await click(host.querySelector('[data-testid="soundscape-listen"]'), 'listen');
    await until(() => /2 capas sonando/.test(host.querySelector('[data-testid="soundscape-layers"]')?.textContent ?? ''), 'two loops playing');
    await click(strips()[2].querySelector('[data-testid="soundscape-fire"]'), 'fire the bell');
    await click(host.querySelector('[data-testid="soundscape-add-scene"]'), 'second scene');
    await until(() => !!host.querySelector('[data-testid="soundscape-scene-Escena 2"]'), 'scene 2');
    await setValue(host.querySelector('[data-testid="soundscape-add-strip"]'), sea.id);
    await click(host.querySelector('[data-testid="soundscape-scene-Escena 1"]'), 'back to scene 1');
    await until(() => /2 capas sonando/.test(host.querySelector('[data-testid="soundscape-layers"]')?.textContent ?? ''), 'scene 1 live');
    await click(host.querySelector('[data-testid="soundscape-scene-Escena 2"]'), 'scene 2 live');
    await until(() => /1 capas sonando/.test(host.querySelector('[data-testid="soundscape-layers"]')?.textContent ?? ''), 'crossfaded to scene 2');
    await click(host.querySelector('[data-testid="soundscape-stop"]'), 'stop');
    assert(!host.querySelector('[data-testid="soundscape-stop"]') && host.querySelector('[data-testid="soundscape-listen"]'), 'Stopped');
    const stored = (await db.projects.get(P))!.soundscapes!.items[0];
    assert(stored.name === 'Tormenta en el puerto' && stored.scenes.length === 2 && stored.liveSceneId === stored.scenes[1].id, 'Saved with the live scene');
    passed.push('Mixer: "Tormenta en el puerto" with rain and sea looping (rain at 0.4) and a bell as a one-shot fired by hand; "Escuchar" plays two layers, a second scene with the sea takes over when chosen (1 layer), "Detener" stops; saved with the project');
    await act(async () => { root.unmount(); await pause(); });
    const read = await runBridgeTool('wh_soundscape', { projectId: P });
    assert(read.ok && (read.result as { soundscapes: { scenes: { strips: { sound: string }[] }[] }[] }).soundscapes[0].scenes[0].strips[0].sound === 'Lluvia', 'Read with sound names');
    const made = await runBridgeTool('wh_soundscape', { projectId: P, action: 'create', name: 'Taberna de noche', sceneName: 'Dentro' });
    assert(made.ok, `create: ${JSON.stringify(made)}`);
    const soundscapeId = (made.result as { soundscapeId: string }).soundscapeId;
    const strip = await runBridgeTool('wh_soundscape', { projectId: P, action: 'add-strip', soundscapeId, librarySound: 'tavern', gain: 0.6 });
    assert(strip.ok && (await db.localMediaAssets.get((strip.result as { assetId: string }).assetId))?.title === 'Taberna', 'A library sound added on the way');
    const loud = await runBridgeTool('wh_soundscape', { projectId: P, action: 'set', soundscapeId, master: 0.3 });
    assert(loud.ok, 'master');
    await undoAuditEntry({ entry: { ...(loud.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_soundscape', kind: 'update' } });
    assert((await db.projects.get(P))!.soundscapes!.items.find(item => item.id === soundscapeId)!.master === 0.8, 'Undo puts the master back');
    const bad = await runBridgeTool('wh_soundscape', { projectId: P, action: 'add-strip', soundscapeId, librarySound: 'dragon' });
    assert(!bad.ok, 'Unknown library sound refused');
    passed.push('Bridge: wh_soundscape reads the mixes with sound names, creates "Taberna de noche", adds the library tavern on the way, sets the master (undo puts it back) and refuses an unknown sound');
  } finally {
    await act(async () => { try { root.unmount(); } catch { /* unmounted */ } await pause(); });
    await db.localMediaAssets.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
