import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { getGeography } from '@/engines/worldgen/cartography/texture';
import { startJourneyJob } from '@/engines/worldgen/useJourneyComputation';
import type { JourneyJob, JourneyReply } from '@/engines/worldgen/journeyComputation';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// Loaded through Vite, so new URL(..., import.meta.url) launches the actual
// module worker. A mock accepting functions would miss the production failure.
export async function testWorldgenLiveJourney(): Promise<string[]> {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'live-journey-boundary', width: 128 });
  const geography = getGeography(world, 'full');
  let rejectedFunctions = false;
  try { structuredClone(geography); } catch (error) { rejectedFunctions = error instanceof DOMException && error.name === 'DataCloneError'; }
  assert(rejectedFunctions, 'Fixture lost the generated language functions that exposed the worker transport failure');
  let cell = -1;
  for (let i = world.width; i < world.elevation.length - world.width; i++) {
    if (i % world.width < world.width - 1 && world.elevation[i] > 0 && world.elevation[i + 1] > 0
      && !world.lake[i] && !world.lake[i + 1]) { cell = i; break; }
  }
  assert(cell >= 0, 'Generated world has no adjacent land cells for a real route');
  const collect = (job: JourneyJob) => new Promise<JourneyReply[]>((resolve, reject) => {
    const replies: JourneyReply[] = [];
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => { stop?.(); reject(new Error('Real journey worker timed out')); }, 15_000);
    try {
      stop = startJourneyJob(job, reply => {
        replies.push(reply);
        if (reply.type === 'error') { clearTimeout(timer); reject(new Error(reply.message)); }
        else if (reply.type === 'done' || reply.type === 'paleo') { clearTimeout(timer); resolve(replies); }
      });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
  const replies = await collect({ type: 'route', world, geography,
    from: { x: cell % world.width, y: Math.floor(cell / world.width) },
    to: { x: cell % world.width + 1, y: Math.floor(cell / world.width) },
    options: { mode: 'foot', season: 'summer' }, compare: true, locale: 'en' });
  const primary = replies[0], done = replies.at(-1);
  assert(primary.type === 'route' && !primary.route.impossible && primary.route.cells.length >= 2, 'Real worker did not publish a traversable route first');
  assert(done?.type === 'done' && done.table?.length === 5 && done.table.every(row => row.seasons.length === 4), 'Real worker lost the twenty comparisons');
  const paleo = await collect({ type: 'paleo', world, state: { ice: 0, seaLevelM: 0 }, locale: 'en' });
  assert(paleo[0].type === 'paleo' && paleo[0].description.includes('today'), 'Real paleogeography worker did not complete');
  return ['Real Vite journey worker accepts generated geography with language functions and publishes route before twenty comparisons', 'Real Vite paleogeography worker returns its translated description'];
}
