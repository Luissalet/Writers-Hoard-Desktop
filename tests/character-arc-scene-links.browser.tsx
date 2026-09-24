import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { updateProject } from '@/db/operations';
import CharacterArcEngine from '@/engines/character-arc/components/CharacterArcEngine';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import { arcBeatLinks, arcBeatPath } from '@/engines/character-arc/beatLinks';
import { getArcBeatsForScene } from '@/engines/character-arc/operations';
import { installNavigator } from '@/engines/_shared/anchoring';
import { useLocaleStore } from '@/stores/localeStore';
import type { ArcBeat, CharacterArc } from '@/engines/character-arc/types';
import type { Scene } from '@/engines/dialog-scene/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Arc beats ⇄ scenes: link resolution, the scene editor's arc strip, the `?beat=` deep link and beat reordering. */
export async function testCharacterArcSceneLinksBrowser(): Promise<string[]> {
  const passed: string[] = [];
  const priorLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const projectId = `arc-links-${Date.now()}`;
  const now = Date.now();
  const scene: Scene = { id: `${projectId}-scene`, projectId, title: 'The bridge', order: 0, sceneNumber: 3, tags: [], createdAt: now, updatedAt: now };
  const otherScene: Scene = { ...scene, id: `${projectId}-scene-2`, title: 'The harbour', order: 1, sceneNumber: 4 };
  const arc: CharacterArc = { id: `${projectId}-arc`, projectId, title: 'Anna learns to trust', ghost: '', lie: 'Alone is safe', truth: '', want: '', need: '', summary: '', status: 'planning', createdAt: now, updatedAt: now };
  const otherArc: CharacterArc = { ...arc, id: `${projectId}-arc-2`, title: 'Ivan falls', lie: '' };
  const beat = (id: string, fields: Partial<ArcBeat>): ArcBeat => ({ id: `${projectId}-${id}`, arcId: arc.id, projectId, order: 0, stage: 'growth', title: id, description: '', status: 'planning', createdAt: now, updatedAt: now, ...fields });
  const crossing = beat('crossing', { title: 'She crosses alone', stage: 'flaw', order: 0, linkedSceneId: scene.id, linkedBeatId: `${projectId}-outline-beat` });
  const doubt = beat('doubt', { title: 'She doubts', stage: 'flaw', order: 1 });
  const reaches = beat('reaches', { title: 'She reaches out', stage: 'growth', order: 2, linkedSceneId: scene.id });
  const elsewhere = beat('elsewhere', { title: 'Somewhere else', order: 3, linkedSceneId: otherScene.id });
  const ivan = beat('ivan', { arcId: otherArc.id, title: 'Ivan lies', stage: 'denial', linkedSceneId: scene.id });

  await db.projects.add({ id: projectId, title: 'Arc links', description: '', type: 'standalone', status: 'draft', mode: 'custom', color: '#c4973b', enabledEngines: ['character-arc', 'dialog-scene', 'outline'], engineOrder: [], createdAt: now, updatedAt: now });
  await db.scenes.bulkAdd([scene, otherScene]);
  await db.outlines.add({ id: `${projectId}-outline`, projectId, title: 'Story', createdAt: now, updatedAt: now });
  await db.outlineBeats.add({ id: `${projectId}-outline-beat`, outlineId: `${projectId}-outline`, projectId, title: 'Midpoint', description: '', status: 'outlined', level: 'beat', order: 0, createdAt: now, updatedAt: now });
  await db.characterArcs.bulkAdd([arc, otherArc]);
  await db.arcBeats.bulkAdd([crossing, doubt, reaches, elsewhere, ivan]);

  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string | (() => string)) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await act(async () => { await pause(); }); assert(condition(), typeof message === 'string' ? message : message()); };
  const button = (label: string, scope: ParentNode = host) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label || element.title === label);
  let path = '';
  installNavigator((next) => { path = next; });
  try {
    // --- Pure resolution ---------------------------------------------------
    const catalog = { scenes: [scene], outlineBeats: [{ id: `${projectId}-outline-beat`, title: 'Midpoint', outlineId: `${projectId}-outline` }], enabledEngines: ['dialog-scene', 'outline'] };
    const links = arcBeatLinks(crossing, catalog);
    assert(links.length === 2, 'both live targets should resolve');
    assert(links[0].path === `/project/${projectId}/dialog-scene?entity=${scene.id}` && links[0].title === '#3 The bridge', 'scene link path/title');
    assert(links[1].path === `/project/${projectId}/outline?outline=${projectId}-outline&beat=${projectId}-outline-beat`, 'outline link path');
    assert(arcBeatLinks(crossing, { ...catalog, enabledEngines: ['outline'] }).every((link) => link.kind === 'outline'), 'link offered a disabled scene engine');
    assert(arcBeatLinks(crossing, { ...catalog, enabledEngines: [] }).length === 0, 'link offered disabled engines');
    assert(arcBeatLinks(crossing, { ...catalog, scenes: [], outlineBeats: [] }).length === 0, 'link offered deleted targets');
    assert(arcBeatLinks(doubt, catalog).length === 0, 'an unlinked beat produced links');
    const forScene = await getArcBeatsForScene(projectId, scene.id);
    assert(forScene.map((entry) => entry.beat.id).join() === [crossing.id, reaches.id, ivan.id].join(), `scene query picked the wrong beats: ${forScene.map((entry) => entry.beat.title).join()}`);
    passed.push('Arc beat links resolve scene and outline paths and hide disabled engines and deleted targets');

    // --- Scene editor strip ------------------------------------------------
    const openLabel = (arcTitle: string, beatTitle: string) => `Open “${beatTitle}” in the arc ${arcTitle}`;
    await act(async () => root.render(<MemoryRouter><SceneEditor scene={scene} scenes={[scene, otherScene]} onUpdateScene={async () => {}} onBack={() => {}}/></MemoryRouter>));
    await waitFor(() => Boolean(button(openLabel(arc.title, crossing.title)) && button(openLabel(arc.title, reaches.title)) && button(openLabel(otherArc.title, ivan.title))), 'scene strip did not list the linked arc beats');
    assert(!button(openLabel(arc.title, elsewhere.title)) && !button(openLabel(arc.title, doubt.title)), 'scene strip listed beats from other scenes');
    // Live: a relink elsewhere reaches the open scene without a remount.
    await db.arcBeats.update(reaches.id, { linkedSceneId: otherScene.id });
    await waitFor(() => !button(openLabel(arc.title, reaches.title)), 'scene strip kept a beat that was relinked away');
    await db.characterArcs.delete(otherArc.id);
    await waitFor(() => !button(openLabel(otherArc.title, ivan.title)), 'scene strip kept a beat whose arc was deleted');
    await act(async () => button(openLabel(arc.title, crossing.title))!.click());
    await waitFor(() => path === arcBeatPath(projectId, arc.id, crossing.id), `strip opened the wrong path: ${path}`);
    await act(async () => { await updateProject(projectId, { enabledEngines: ['dialog-scene', 'outline'] }); });
    await waitFor(() => !host.querySelector('[role="group"][aria-label="Character arcs"]'), 'scene strip stayed with character-arc disabled');
    await act(async () => { await updateProject(projectId, { enabledEngines: ['character-arc', 'dialog-scene', 'outline'] }); });
    passed.push('Scene editor lists the arc beats placed in it, follows relinks and deletions live, opens the beat, and hides with the engine off');

    // --- Arc editor: ?beat= deep link and outgoing chips --------------------
    await act(async () => root.render(<MemoryRouter key="arc" initialEntries={[arcBeatPath(projectId, arc.id, crossing.id)]}><CharacterArcEngine projectId={projectId}/></MemoryRouter>));
    await waitFor(() => Boolean(host.querySelector('[aria-current="true"] textarea')), 'deep-linked beat was not unfolded');
    const focusedRow = host.querySelector<HTMLElement>('[aria-current="true"]')!;
    assert(focusedRow.querySelector<HTMLInputElement>('input')?.value === crossing.title, 'deep link unfolded the wrong beat');
    await waitFor(() => Boolean(button('Open scene: #3 The bridge', focusedRow) && button('Open outline beat: Midpoint', focusedRow)), 'beat row did not offer its scene and outline links');
    await act(async () => button('Open scene: #3 The bridge', focusedRow)!.click());
    await waitFor(() => path === `/project/${projectId}/dialog-scene?entity=${scene.id}`, `scene chip opened the wrong path: ${path}`);
    await act(async () => button('Open outline beat: Midpoint', focusedRow)!.click());
    await waitFor(() => path.includes(`/outline?outline=${projectId}-outline&beat=${projectId}-outline-beat`), 'outline chip lost outline or beat identity');
    await act(async () => { await updateProject(projectId, { enabledEngines: ['character-arc', 'outline'] }); });
    await waitFor(() => !button('Open scene: #3 The bridge') && Boolean(button('Open outline beat: Midpoint')), 'scene chip stayed with dialog-scene disabled');
    passed.push('Arc editor deep link unfolds the named beat, whose chips open its scene and outline beat and hide with the engine off');

    // --- Reorder by keyboard through the grip -----------------------------
    const grips = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label="Drag to reorder within this stage"]'));
    const flawTitles = () => Array.from(host.querySelectorAll<HTMLInputElement>('.divide-y input:not([type])')).map((input) => input.value).filter((title) => title === crossing.title || title === doubt.title);
    assert(flawTitles().join('|') === `${crossing.title}|${doubt.title}`, `unexpected initial order: ${flawTitles().join('|')}`);
    // Fold the deep-linked beat first: a keyboard drag steps by row height,
    // and an unfolded editor row is taller than the viewport of this window.
    await act(async () => button('Collapse', focusedRow)!.click());
    const grip = grips()[0];
    const key = (target: Element, code: string, keyName: string) => target.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName, bubbles: true, cancelable: true }));
    await act(async () => { grip.focus(); key(grip, 'Space', ' '); await pause(100); });
    await act(async () => { key(document.activeElement ?? grip, 'ArrowDown', 'ArrowDown'); await pause(100); });
    await act(async () => { key(document.activeElement ?? grip, 'Space', ' '); await pause(50); });
    await waitFor(() => flawTitles().join('|') === `${doubt.title}|${crossing.title}`, `keyboard reorder did not move the beat: ${flawTitles().join('|')}`);
    const stored = (await db.arcBeats.where('arcId').equals(arc.id).toArray()).sort((a, b) => a.order - b.order).map((row) => row.id);
    assert(stored.indexOf(doubt.id) < stored.indexOf(crossing.id), 'reorder was not persisted');
    assert((await db.arcBeats.get(crossing.id))?.stage === 'flaw', 'reorder changed the beat stage');
    passed.push('The beat grip reorders within its stage by keyboard and persists the order');
  } finally {
    await act(async () => root.unmount()); host.remove();
    useLocaleStore.setState({ locale: priorLocale });
    installNavigator((next) => { window.history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); });
    for (const table of [db.arcBeats, db.characterArcs, db.outlineBeats, db.outlines, db.scenes]) await table.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
  return passed;
}
