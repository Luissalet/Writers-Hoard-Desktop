import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { commitRegeneration, createWorldAlternative, freshWorldEdits, prepareRegeneration, WorldRecipeConflict } from '@/engines/worldgen/recipe';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import ParamsPanel from '@/engines/worldgen/components/ParamsPanel';
import RegenerateWorldDialog from '@/engines/worldgen/components/RegenerateWorldDialog';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testWorldgenRecipes(): Promise<string[]> {
  const passed: string[] = [];
  const id = `recipe-${Date.now()}`;
  const fixture: GeneratedWorld = {
    id, projectId: id, title: 'Islas', params: { ...DEFAULT_PARAMS, width: 1024, seed: 'old' },
    edits: '[{"kind":"placesEverywhere","enabled":true}]', thumbnail: 'old-preview', createdAt: 1, updatedAt: 1,
    regions: [{ id: `${id}-region`, title: 'Valle', x: 768, y: 128, spanKm: 80, params: { res: 640, aspect: 1.55, detail: 0.8, settled: 0.6, habitation: 1, streamDensity: 0.7 }, createdAt: 1, updatedAt: 1 }],
  };
  const pin = { id: `${id}-pin`, projectId: id, worldId: id, name: 'Puerto', color: '#c4973b', u: 0.75, v: 0.25, createdAt: 1, updatedAt: 1 };
  const params = { ...fixture.params, width: 2048, seed: 'new' };
  const reset = async () => { await db.generatedWorlds.put(structuredClone(fixture)); await db.worldWaypoints.put(pin); };
  try {
    await reset();
    const plan = await prepareRegeneration(id, params, 'keep');
    assert((await db.generatedWorlds.get(id))?.params.seed === 'old', 'preparing must not change the saved recipe');
    const saved = await commitRegeneration(plan);
    assert(saved.params.seed === 'new' && saved.edits === freshWorldEdits() && !saved.thumbnail, 'publish full new recipe together');
    assert(saved.regions?.[0].x === 1536 && saved.regions[0].y === 256, 'resolution change must preserve bookmark coordinates');
    assert((await db.worldWaypoints.get(pin.id))?.u === 0.75, 'normalized pins must remain at the same longitude');
    passed.push('World recipes: preparation leaves original intact; one commit updates terrain and edits while rescaling geographic bookmarks');

    await reset();
    const clear = await prepareRegeneration(id, params, 'clear');
    const fail = () => { throw new Error('disk full'); };
    db.generatedWorlds.hook('updating', fail);
    let rejected = false;
    try { await commitRegeneration(clear); } catch { rejected = true; }
    finally { db.generatedWorlds.hook('updating').unsubscribe(fail); }
    assert(rejected && await db.worldWaypoints.get(pin.id), 'failed world save must roll back pin deletion');
    assert(JSON.stringify(await db.generatedWorlds.get(id)) === JSON.stringify(fixture), 'failed commit must preserve complete original world');
    const clean = await commitRegeneration(clear);
    assert(!clean.regions?.length && !await db.worldWaypoints.get(pin.id), 'explicit clear applies to regions and pins');
    passed.push('World recipes: failed replacement rolls back all fields and deleted pins; retry applies the chosen location policy');

    await reset();
    const stale = await prepareRegeneration(id, params, 'keep');
    await db.generatedWorlds.update(id, { edits: 'external edits' });
    let conflict = false;
    try { await commitRegeneration(stale); } catch (error) { conflict = error instanceof WorldRecipeConflict; }
    assert(conflict && (await db.generatedWorlds.get(id))?.edits === 'external edits', 'external edits during generation must survive');
    await reset();
    const pinsChanged = await prepareRegeneration(id, params, 'clear');
    await db.worldWaypoints.update(pin.id, { name: 'Puerto nuevo' });
    conflict = false;
    try { await commitRegeneration(pinsChanged); } catch (error) { conflict = error instanceof WorldRecipeConflict; }
    assert(conflict && (await db.worldWaypoints.get(pin.id))?.name === 'Puerto nuevo', 'must not delete a pin edited during generation');
    passed.push('World recipes: concurrent strokes or waypoint edits reject stale replacement without overwriting authored work');

    await reset();
    const alternative = await createWorldAlternative(id, params, 'Otra dirección');
    assert(alternative.id !== id && alternative.originWorldId === id && alternative.projectId === id, 'alternative has independent identity and origin');
    assert(alternative.params.seed === 'new' && !alternative.regions?.length && alternative.edits === freshWorldEdits(), 'alternative uses the proposed terrain without misplaced inherited edits');
    assert(JSON.stringify(await db.generatedWorlds.get(id)) === JSON.stringify(fixture) && await db.worldWaypoints.get(pin.id), 'alternative must keep original and pins untouched');
    passed.push('World recipes: alternatives preserve the original world and own their proposed recipe and provenance');
  } finally {
    await db.worldWaypoints.where('projectId').equals(id).delete();
    await db.generatedWorlds.where('projectId').equals(id).delete();
  }

  const previousLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let chosen = '', alternatives = 0, resets = 0;
  try {
    await act(async () => root.render(<ParamsPanel params={DEFAULT_PARAMS} onChange={() => {}} onGenerate={() => {}} onRandomSeed={() => {}} generating={false} hasWorld onCreateAlternative={() => alternatives++} onReset={() => resets++} />));
    const buttons = [...host.querySelectorAll('button')];
    await act(async () => buttons.find(button => button.textContent === 'Create alternative')!.click());
    await act(async () => buttons.find(button => button.textContent === 'Reset settings')!.click());
    assert(alternatives === 1 && resets === 1, 'settings expose alternative and reset actions');
    await act(async () => root.render(<RegenerateWorldDialog open hasLocations onClose={() => {}} onConfirm={policy => { chosen = policy; }} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    assert(dialog.textContent?.includes('only after generation and saving succeed'), 'replacement explains the commit boundary');
    await act(async () => (dialog.querySelector('input[value="clear"]') as HTMLInputElement).click());
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Replace terrain')!.click());
    assert(chosen === 'clear', 'confirmation must honor the explicit location policy');
    passed.push('World workspace: alternatives and reset are actionable; replacement explicitly selects saved-location policy');
  } finally { await act(async () => root.unmount()); host.remove(); useLocaleStore.setState({ locale: previousLocale }); }
  return passed;
}
