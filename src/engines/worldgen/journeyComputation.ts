import type { WorldData } from './core/types';
import { planRoute, type Route, type Season, type TravelMode, type TravelOptions, type TravelGeography } from './core/travel';
import { describePaleo, paleoMap, type PaleoState } from './core/paleo';

export const JOURNEY_MODES: TravelMode[] = ['foot', 'horse', 'cart', 'boat', 'ship'];
export const JOURNEY_SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export type JourneyComparison = { mode: TravelMode; seasons: Route[] }[];
export type JourneyJob = { type: 'route'; world: WorldData; geography: TravelGeography; from: { x: number; y: number }; to: { x: number; y: number }; options: TravelOptions; compare: boolean; locale?: 'en' | 'es'; stopNames?: string[] }
  | { type: 'paleo'; world: WorldData; state: PaleoState; locale?: 'en' | 'es' };
export type JourneyReply = { type: 'route'; route: Route } | { type: 'progress'; completed: number }
  | { type: 'done'; table: JourneyComparison | null } | { type: 'paleo'; description: string } | { type: 'error'; message: string };

/** Project at the transport boundary, including when callers supply full HumanGeography objects. */
export function journeyWorkerPayload(job: JourneyJob): JourneyJob {
  if (job.type === 'paleo') return job;
  const source = job.geography;
  return { ...job, geography: {
    roads: source.roads.map(road => ({ cells: road.cells, major: road.major })),
    settlements: source.settlements.map(({ x, y, name, rank }) => ({ x, y, name, rank })),
    ruins: source.ruins.map(({ x, y, name }) => ({ x, y, name })),
    realms: source.realms.map(({ id, name }) => ({ id, name })),
    realmOf: source.realmOf,
  } };
}

/** Runs only in the worker. Primary route is published before optional comparisons. */
export function computeJourneyJob(job: JourneyJob, publish: (reply: JourneyReply) => void): void {
  if (job.type === 'paleo') { publish({ type: 'paleo', description: describePaleo(job.world, paleoMap(job.world, job.state), job.locale) }); return; }
  const route = planRoute(job.world, job.geography, job.from, job.to, job.options, job.locale);
  publish({ type: 'route', route });
  let completed = 0;
  const table = job.compare ? JOURNEY_MODES.map(mode => ({ mode, seasons: JOURNEY_SEASONS.map(season => {
    const result = mode === job.options.mode && season === job.options.season ? route : planRoute(job.world, job.geography, job.from, job.to, { ...job.options, mode, season }, job.locale);
    publish({ type: 'progress', completed: ++completed }); return result;
  }) })) : null;
  publish({ type: 'done', table });
}
