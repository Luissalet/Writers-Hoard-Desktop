import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { saveJourneyCreativeDraft, type JourneyCreativeDraft } from '@/engines/worldgen/journeyCreative';
import JourneyCreativeCapture from '@/engines/worldgen/components/JourneyCreativeCapture';
import type { Route } from '@/engines/worldgen/core/travel';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testWorldgenCreative(): Promise<string[]> {
  const id = `journey-creative-${Date.now()}`;
  const world: GeneratedWorld = { id, projectId: id, title: 'Islands', params: { ...DEFAULT_PARAMS, width: 64, seed: id }, createdAt: 1, updatedAt: 1 };
  const draft: JourneyCreativeDraft = { id: `${id}-idea`, target: 'note', title: 'The crossing', text: 'What must they leave behind?', location: 'Port → Island', context: { stops: ['Port', 'Island'], night: 2, u: 0.4, v: 0.5, mode: 'ship', season: 'winter', km: 80, hours: 12 } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const oldLocale = useLocaleStore.getState().locale;
  const fail = () => { throw new Error('disk full'); };
  try {
    await db.projects.put({ id, title: id, mode: 'custom', type: 'idea', color: '#fff', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
    await db.generatedWorlds.put(world);
    const [first, second] = await Promise.all([saveJourneyCreativeDraft(world, draft), saveJourneyCreativeDraft(world, draft)]);
    assert(first.id === second.id && await db.notes.where('projectId').equals(id).count() === 1, 'Repeated capture duplicated idea');
    const link = await db.entityLinks.get(`journey-source:${draft.id}`);
    assert(link?.sourceEntityId === world.id && JSON.parse(link.notes!).night === 2 && JSON.parse(link.notes!).recipeKey, 'Capture lost geographic source/recipe/stage');
    assert((await db.projects.get(id))?.enabledEngines.includes('notes'), 'Idea engine was not made reachable');

    db.entityLinks.hook('creating', fail);
    let rejected = false;
    try { await saveJourneyCreativeDraft(world, { ...draft, id: `${id}-scene`, target: 'scene' }); } catch { rejected = true; }
    assert(rejected && !await db.scenes.get(`${id}-scene`) && !(await db.projects.get(id))?.enabledEngines.includes('dialog-scene'), 'Link failure left a partial scene or project activation');
    db.entityLinks.hook('creating').unsubscribe(fail);
    await saveJourneyCreativeDraft(world, { ...draft, id: `${id}-scene`, target: 'scene' });
    assert((await db.scenes.get(`${id}-scene`))?.setting === draft.location && (await db.projects.get(id))?.enabledEngines.includes('dialog-scene'), 'Scene lost setting or remains unreachable');
    let foreign = false;
    try { await saveJourneyCreativeDraft({ ...world, projectId: 'foreign' }, { ...draft, id: `${id}-foreign` }); } catch { foreign = true; }
    assert(foreign && !await db.notes.get(`${id}-foreign`), 'Cross-project source accepted');
    await db.generatedWorlds.update(id, { edits: 'changed' });
    let stale = false;
    try { await saveJourneyCreativeDraft(world, { ...draft, id: `${id}-stale` }); } catch { stale = true; }
    assert(stale && !await db.notes.get(`${id}-stale`), 'Stale route was attributed to new terrain');
    await db.generatedWorlds.put(world);

    useLocaleStore.getState().setLocale('en');
    const route: Route = { cells: [], km: 80, hours: 12, days: 2, directKm: 60, legs: [], crossings: [], roadFraction: 0, stages: [{ night: 1, x: 20, y: 16, km: 50, hours: 8, rough: true, terrain: 'coast' }], realms: [], highestM: 100, lowestM: 0, climbM: 100 };
    await act(async () => root.render(<JourneyCreativeCapture world={world} route={route} stops={draft.context.stops} mode="ship" season="winter" width={64} height={32} />));
    const click = async (text: string, twice = false) => { await act(async () => {
      const button = [...host.querySelectorAll('button')].find(row => row.textContent === text)!; assert(button, `Missing ${text}`); button.click(); if (twice) button.click(); await new Promise(resolve => setTimeout(resolve, 50));
    }); };
    await click('Develop this journey');
    await act(async () => { const select = host.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const content = host.querySelector('textarea')!.value;
    db.notes.hook('creating', fail);
    await click('Save as idea');
    assert(host.querySelector('[role="alert"]') && host.querySelector('textarea')!.value === content, 'Failed capture discarded author draft');
    db.notes.hook('creating').unsubscribe(fail);
    await click('Save as idea', true);
    assert(host.querySelector('[role="status"]') && await db.notes.where('projectId').equals(id).count() === 2, 'UI retry duplicated or failed to confirm capture');
    assert(host.querySelector('a')?.getAttribute('href') === `/project/${id}/notes`, 'Saved idea has no usable destination');
    return ['Journey development creates ideas/scenes with geographic provenance and enables their engines atomically', 'Journey development retries without duplicates and rejects foreign or stale worlds', 'Journey development UI selects a night, preserves text on failure and confirms one saved idea'];
  } finally {
    db.entityLinks.hook('creating').unsubscribe(fail); db.notes.hook('creating').unsubscribe(fail);
    await act(async () => root.unmount()); host.remove(); useLocaleStore.getState().setLocale(oldLocale);
    await db.transaction('rw', [db.projects, db.generatedWorlds, db.notes, db.scenes, db.entityLinks], async () => {
      await db.notes.where('projectId').equals(id).delete(); await db.scenes.where('projectId').equals(id).delete(); await db.entityLinks.where('projectId').equals(id).delete(); await db.generatedWorlds.delete(id); await db.projects.delete(id);
    });
  }
}
