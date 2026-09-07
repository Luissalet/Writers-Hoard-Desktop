import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { buildHumanGeography, type HumanGeography, type Settlement } from '@/engines/worldgen/core/settlements';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { planRoute, type Route } from '@/engines/worldgen/core/travel';
import { computeJourneyJob, journeyWorkerPayload, type JourneyJob, type JourneyReply } from '@/engines/worldgen/journeyComputation';
import { startJourneyJob } from '@/engines/worldgen/useJourneyComputation';
import JourneyPanel from '@/engines/worldgen/components/JourneyPanel';
import { t } from '@/i18n/useTranslation';
import { installJourneyWorkerFixture, JourneyWorkerFixture } from './journeyWorkerFixture';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const w: WorldData = { width: 16, height: 8, params: { ...DEFAULT_PARAMS, width: 16 }, revision: 0,
  elevation: new Float32Array(128).fill(0.1), biome: new Uint8Array(128).fill(Biome.Grassland),
  temperature: new Float32Array(128).fill(18), precipitation: new Float32Array(128).fill(500),
  flow: new Float32Array(128), lake: new Uint8Array(128), ice: new Float32Array(128),
  currentU: new Float32Array(128), currentV: new Float32Array(128), currentSpeed: new Float32Array(128), sst: new Float32Array(128),
  plateId: new Uint8Array(128), boundary: new Float32Array(128), rivers: [], landmarks: [], plateInfo: [] };
const geo = { depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(128).fill(-1), features: [], ruins: [], landforms: [], languages: { languages: [] }, languageOf: {} } as unknown as HumanGeography;
const from: Settlement = { id: -1, name: 'Origin', x: 2, y: 3, rank: 'village', culture: 'latin', population: 0, port: false, river: false, realm: -1, score: 0 };
const to = { ...from, id: -2, name: 'Destination', x: 5 };
const via: Settlement[] = [];

export async function testWorldgenJourneyWorker(): Promise<string[]> {
  const realWorld = generateWorld({ ...DEFAULT_PARAMS, width: 64, seed: 'journey-worker-real-geography', erosion: 0 });
  const realGeo = buildHumanGeography(realWorld);
  assert(typeof realGeo.languages.proto.orthography === 'function', 'Real geography fixture no longer exercises non-cloneable language functions');
  const origin = realGeo.settlements[0] ?? { x: 20, y: 16 }, destination = realGeo.settlements[1] ?? { x: 21, y: 16 };
  const realJob: JourneyJob = { type: 'route', world: realWorld, geography: realGeo, from: origin, to: destination,
    options: { mode: 'foot', season: 'summer' }, compare: false, locale: 'en' };
  let rawCloneFailed = false;
  try { structuredClone(realJob); } catch (error) { rawCloneFailed = error instanceof DOMException && error.name === 'DataCloneError'; }
  assert(rawCloneFailed, 'Raw real geography did not reproduce the production DataCloneError');
  const serializable = structuredClone(journeyWorkerPayload(realJob));
  assert(serializable.type === 'route' && Object.keys(serializable.geography).sort().join(',') === 'realmOf,realms,roads,ruins,settlements', 'Worker payload retained executable naming metadata');
  const restoreBoundaryWorker = installJourneyWorkerFixture(false);
  try {
    const output: JourneyReply[] = [];
    startJourneyJob(realJob, reply => output.push(reply));
    // Fixture postMessage performs native structuredClone; it cannot silently accept functions.
    JourneyWorkerFixture.instances.at(-1)!.run();
    const actual = output.find(reply => reply.type === 'route');
    const direct = planRoute(realWorld, realGeo, origin, destination, realJob.options, 'en');
    assert(actual?.type === 'route' && JSON.stringify(actual.route) === JSON.stringify(direct), 'Serializable projection changed route distances, stages, roads or realms');
  } finally { restoreBoundaryWorker(); }

  const replies: JourneyReply[] = [];
  computeJourneyJob({ type: 'route', world: w, geography: geo, from, to, options: { mode: 'foot', season: 'summer', planetRadiusKm: 20 }, compare: true, locale: 'en' }, reply => replies.push(reply));
  const finished = replies.at(-1);
  assert(replies[0].type === 'route' && finished?.type === 'done' && finished.table?.length === 5 && finished.table.every(row => row.seasons.length === 4), 'Primary route did not precede all twenty comparisons');
  assert(replies.filter(reply => reply.type === 'progress').length === 20 && finished.table[0].seasons[1].legs[0]?.terrain === 'grassland', 'Comparison progress or English terrain was lost');
  assert(planRoute(w, geo, from, to, { mode: 'boat', season: 'summer' }, 'en').impossible?.includes('waterway'), 'English impossible route remained Spanish');
  const paleo: JourneyReply[] = [];
  computeJourneyJob({ type: 'paleo', world: w, state: { ice: 0, seaLevelM: 0 }, locale: 'en' }, reply => paleo.push(reply));
  assert(paleo[0]?.type === 'paleo' && paleo[0].description.includes('today'), 'Paleo summary was not computed and translated in the worker');

  const restoreWorker = installJourneyWorkerFixture(false);
  const host = document.getElementById('root')!;
  let root: Root | null = null, drawn: Route | null | undefined;
  const row: GeneratedWorld = { id: 'worker-world', projectId: 'worker-project', title: 'World', params: w.params, createdAt: 1, updatedAt: 1 };
  const render = async (destination: Settlement | null) => { await act(async () => {
    root ??= createRoot(host); root.render(<JourneyPanel world={w} worldRecord={row} geography={geo} from={from} to={destination} via={via} picking={null}
      onPick={() => {}} onClearVia={() => {}} onSwap={() => {}} onClear={() => {}} onRoute={route => { drawn = route; }} paleo={null} onPaleo={() => {}} />); await pause();
  }); };
  const button = (name: string) => [...host.querySelectorAll('button')].find(row => row.textContent?.trim() === name);
  try {
    await render(to);
    const first = JourneyWorkerFixture.instances.at(-1)!;
    assert(host.textContent?.includes(t('worldgen.journey.calculating')), 'Pending route has no loading state');
    await act(async () => { button(t('worldgen.travel.mode.horse'))!.click(); await pause(); });
    const second = JourneyWorkerFixture.instances.at(-1)!;
    assert(first.terminated && second !== first, 'Changing travel options did not cancel work');
    await act(async () => { first.run(); await pause(); });
    assert(drawn === undefined, 'Obsolete route was published after cancellation');
    await act(async () => { second.run(); await pause(); });
    assert(drawn && drawn.cells.length > 0, 'Current route was not published');
    const previous = drawn;
    const develop = button('Desarrollar este viaje') ?? button('Develop this journey');
    assert(develop, 'Current route could not become a creative idea');
    await act(async () => { develop.click(); await pause(); });
    const textarea = host.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this creative draft'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { button(t('worldgen.journey.compareAll'))!.click(); await pause(); });
    assert(host.querySelector('textarea') === textarea && textarea.value === 'Keep this creative draft' && drawn === previous, 'Comparison loading erased creative draft or previous drawn route');
    await render({ ...to, name: 'New destination', x: 8 });
    const current = JourneyWorkerFixture.instances.at(-1)!;
    assert(textarea.value === 'Keep this creative draft' && drawn === previous, 'Changing endpoints lost draft or drawing');
    const captureScope = textarea.closest('section')!.querySelector('select')!;
    assert(captureScope.disabled, 'Pending source change allowed rebuilding a creative draft from stale route data');
    await act(async () => { current.deliver({ type: 'error', message: 'Injected failure' }); await pause(); });
    assert(host.querySelector('[role="alert"]') && drawn === previous, 'Worker error hid recovery or discarded previous drawing');
    await act(async () => { button(t('common.retry'))!.click(); await pause(); });
    const retry = JourneyWorkerFixture.instances.at(-1)!;
    await act(async () => { retry.run(); await pause(); });
    assert(drawn !== previous && textarea.value === 'Keep this creative draft', 'Retry failed to publish fresh route or replaced authored text');
    w.revision = (w.revision ?? 0) + 1; await render(to);
    const revised = JourneyWorkerFixture.instances.at(-1)!;
    assert(revised !== retry, 'In-place world revision did not invalidate route computation');
    await render(null);
    assert(revised.terminated && drawn === null && host.querySelector('textarea') === textarea, 'Clearing endpoints did not cancel/clear drawing or erased creative draft');
    return ['Real language-bearing geography reproduces DataCloneError; production transport projects cloneable route facts without changing results', 'Worker publishes primary route before all twenty comparisons and translates travel/paleo', 'Option, endpoint and world changes cancel stale results; failed jobs retry without clearing the drawing', 'Comparison and source changes preserve creative draft while blocking stale source capture'];
  } finally { await act(async () => { root?.unmount(); await pause(); }); restoreWorker(); }
}
