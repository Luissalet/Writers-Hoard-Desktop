import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { journeyNormalizedStops, journeyRecipeKey, journeyStopsForWorld, type WorldJourney } from '@/engines/worldgen/journeyTypes';
import { deleteWorldJourney, saveWorldJourney } from '@/engines/worldgen/journeyOperations';
import JourneyPanel from '@/engines/worldgen/components/JourneyPanel';
import { t } from '@/i18n/useTranslation';
import { installJourneyWorkerFixture } from './journeyWorkerFixture';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const record: GeneratedWorld = { id: 'journey-test-world', projectId: 'journey-test-project', title: 'Journey fixture', params: { ...DEFAULT_PARAMS, width: 16 }, createdAt: 1, updatedAt: 1 };
const world: WorldData = {
  width: 16, height: 8, params: record.params, revision: 0,
  elevation: new Float32Array(128).fill(0.1), biome: new Uint8Array(128).fill(Biome.Grassland),
  temperature: new Float32Array(128).fill(18), precipitation: new Float32Array(128).fill(500),
  flow: new Float32Array(128), lake: new Uint8Array(128), ice: new Float32Array(128),
  currentU: new Float32Array(128), currentV: new Float32Array(128), currentSpeed: new Float32Array(128), sst: new Float32Array(128),
  plateId: new Uint8Array(128), boundary: new Float32Array(128), rivers: [], landmarks: [], plateInfo: [],
};
const geography = { depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(128).fill(-1), features: [], ruins: [], landforms: [], languages: { languages: [] }, languageOf: {} } as unknown as HumanGeography;
const fixture: WorldJourney = { id: 'saved-journey', name: 'The long return', stops: journeyNormalizedStops([{ name: 'Harbour', x: 1, y: 3 }, { name: 'Pass', x: 3, y: 3 }, { name: 'Home', x: 5, y: 4 }], world), options: { mode: 'horse', season: 'winter', hoursPerDay: 4, planetRadiusKm: 20 }, recipeKey: journeyRecipeKey(record), createdAt: 2, updatedAt: 2 };

export async function testWorldgenJourneys(): Promise<string[]> {
  const restoreWorker = installJourneyWorkerFixture();
  let root: Root | null = null;
  const reject = () => { throw new Error('Injected itinerary failure'); };
  const host = document.getElementById('root')!;
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  let opened: WorldJourney | undefined;
  function Harness({ row, samePlace = false }: { row: GeneratedWorld; samePlace?: boolean }) {
    const [stops, setStops] = useState(journeyStopsForWorld(fixture, world));
    return <JourneyPanel world={world} geography={geography} worldRecord={row} from={stops[0]} to={samePlace ? stops[0] : stops.at(-1)!} via={stops.slice(1, -1)} picking={null}
      onPick={() => {}} onClearVia={() => {}} onSwap={() => {}} onClear={() => {}} onRoute={() => {}} paleo={null} onPaleo={() => {}}
      onOpenJourney={journey => { opened = journey; setStops(journeyStopsForWorld(journey, world)); }} />;
  }
  const render = async (row: GeneratedWorld, samePlace = false) => { await act(async () => { root ??= createRoot(host); root.render(<Harness row={row} samePlace={samePlace} />); await pause(); }); };
  const setName = async (value: string) => { await act(async () => { const input = document.querySelector('input[type="text"], input:not([type])') as HTMLInputElement; assert(input, 'Missing itinerary name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
  const submit = async () => { await act(async () => { const form = document.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); }); };
  try {
    await db.generatedWorlds.put(record);
    await Promise.all([saveWorldJourney(record.id, record.projectId, fixture), saveWorldJourney(record.id, record.projectId, { ...fixture, id: 'second-plan', name: 'Alternate' })]);
    await saveWorldJourney(record.id, record.projectId, fixture);
    let saved = (await db.generatedWorlds.get(record.id))!;
    assert(saved.journeys?.length === 2, 'Concurrent append or retry lost/duplicated plans');
    await db.generatedWorlds.update(record.id, { title: 'Remote title', edits: '[{"kind":"test"}]' });
    await saveWorldJourney(record.id, record.projectId, { ...fixture, id: 'third-plan' });
    saved = (await db.generatedWorlds.get(record.id))!;
    assert(saved.title === 'Remote title' && saved.edits && saved.journeys?.length === 3, 'Save overwrote concurrently updated world recipe');
    let scopeFailed = false;
    try { await saveWorldJourney(record.id, 'foreign-project', { ...fixture, id: 'foreign' }); } catch { scopeFailed = true; }
    assert(scopeFailed && (await db.generatedWorlds.get(record.id))?.journeys?.length === 3, 'Foreign owner could write an itinerary');
    const enlarged = journeyStopsForWorld(fixture, { width: 64, height: 32 });
    const normalizedAgain = journeyNormalizedStops(enlarged, { width: 64, height: 32 });
    assert(normalizedAgain.every((stop, index) => Math.abs(stop.u - fixture.stops[index].u) < 1e-10 && Math.abs(stop.v - fixture.stops[index].v) < 1e-10), 'Grid resizing moved the geographic stops');
    assert(journeyRecipeKey(record) !== journeyRecipeKey(saved), 'Recipe edits did not invalidate itinerary reference');

    await render(saved);
    db.generatedWorlds.hook('updating', reject);
    await setName('Draft survives failure'); await submit();
    assert(document.querySelector('[role="alert"]') && (document.querySelector('input:not([type])') as HTMLInputElement).value === 'Draft survives failure', 'Failed save lost draft or hid the error');
    assert((await db.generatedWorlds.get(record.id))?.journeys?.length === 3, 'Failed save left a partial plan');
    db.generatedWorlds.hook('updating').unsubscribe(reject);
    await submit();
    saved = (await db.generatedWorlds.get(record.id))!;
    assert(saved.journeys?.length === 4 && saved.journeys.filter(row => row.name === 'Draft survives failure').length === 1, 'Double submit duplicated the itinerary');
    await unmount(); await render(saved);
    await act(async () => { const select = document.querySelector('select')!; select.value = fixture.id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    assert(opened?.id === fixture.id && document.querySelector('[role="status"]')?.textContent === t('worldgen.journey.recipeChanged'), 'Reload did not restore itinerary or expose changed recipe');
    await setName('Reopened options'); await submit();
    saved = (await db.generatedWorlds.get(record.id))!;
    const reopened = saved.journeys!.find(row => row.name === 'Reopened options')!;
    assert(JSON.stringify(reopened.options) === JSON.stringify({ hoursPerDay: 4, planetRadiusKm: 20, mode: 'horse', season: 'winter' }) && reopened.stops.every((stop, i) => stop.name === fixture.stops[i].name), 'Reopened itinerary lost options or ordered stops');
    const clickButton = async (name: string, inDialog = false, twice = false) => {
      await act(async () => {
        const scope = inDialog ? document.querySelector('[role="dialog"]')! : document;
        const button = [...scope.querySelectorAll('button')].find(button => button.textContent?.trim() === name);
        assert(button, `Missing button ${name}`); button.click(); if (twice) button.click(); await pause();
      });
    };
    await clickButton(t('worldgen.journey.delete'));
    await clickButton(t('common.cancel'), true);
    assert((await db.generatedWorlds.get(record.id))?.journeys?.some(journey => journey.id === reopened.id), 'Cancelling deleted the itinerary');
    await unmount(); await render(saved);
    await act(async () => { const select = document.querySelector('select')!; select.value = reopened.id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    await clickButton(t('worldgen.journey.delete'));
    db.generatedWorlds.hook('updating', reject);
    await clickButton(t('common.delete'), true);
    assert(document.querySelector('[role="dialog"]')?.textContent?.includes(t('worldgen.journey.deleteError')) && (await db.generatedWorlds.get(record.id))?.journeys?.some(journey => journey.id === reopened.id), 'Failed deletion closed the dialog or discarded the saved plan');
    db.generatedWorlds.hook('updating').unsubscribe(reject);
    await clickButton(t('common.delete'), true, true);
    assert(!(await db.generatedWorlds.get(record.id))?.journeys?.some(journey => journey.id === reopened.id), 'Confirmed deletion did not persist');
    assert(![...document.querySelectorAll('select option')].some(option => (option as HTMLOptionElement).value === reopened.id), 'Stale parent row resurrected the removed itinerary in the selector');
    const remoteJourney = { ...fixture, name: 'Edited elsewhere', updatedAt: 999 };
    saved = (await db.generatedWorlds.get(record.id))!;
    await db.generatedWorlds.update(record.id, { journeys: saved.journeys!.map(journey => journey.id === fixture.id ? remoteJourney : journey) });
    let staleDeleteRejected = false, foreignDeleteRejected = false;
    try { await deleteWorldJourney(record.id, record.projectId, fixture); } catch { staleDeleteRejected = true; }
    try { await deleteWorldJourney(record.id, 'foreign-project', remoteJourney); } catch { foreignDeleteRejected = true; }
    assert(staleDeleteRejected && foreignDeleteRejected && (await db.generatedWorlds.get(record.id))?.journeys?.some(journey => journey.name === remoteJourney.name), 'Deletion erased an external version or allowed a foreign owner');
    await unmount();
    // A zero-length journey has zero daily distance; no NaN appears in the summary.
    const originalStops = fixture.stops; fixture.stops = [originalStops[0], originalStops[0]];
    await render(saved, true);
    assert(!host.textContent?.includes('NaN'), 'Zero-length journey displayed NaN');
    fixture.stops = originalStops;
    await db.generatedWorlds.delete(record.id);
    let deletionFailed = false;
    try { await saveWorldJourney(record.id, record.projectId, fixture); } catch { deletionFailed = true; }
    assert(deletionFailed && !await db.generatedWorlds.get(record.id), 'Saving resurrected a deleted world');
    return ['Itineraries append atomically, retry once, enforce owner and preserve recipes', 'Normalized stops survive grid resize; recipe changes remain visible', 'Failed save retains draft; duplicate submission creates one plan', 'Reload restores ordered stops and all travel options; zero distance is finite', 'Deletion confirms, cancels, recovers failure and hides stale rows without erasing external edits'];
  } finally {
    db.generatedWorlds.hook('updating').unsubscribe(reject);
    await unmount(); restoreWorker(); await db.generatedWorlds.delete(record.id);
  }
}
