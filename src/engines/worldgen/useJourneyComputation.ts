import { useEffect, useMemo, useState } from 'react';
import type { WorldData } from './core/types';
import type { HumanGeography, Settlement } from './core/settlements';
import type { Route, TravelOptions } from './core/travel';
import type { PaleoState } from './core/paleo';
import { journeyWorkerPayload, type JourneyComparison, type JourneyJob, type JourneyReply } from './journeyComputation';

/** Cancellation and identity guards both matter: a terminated worker may already have queued a reply. */
export function startJourneyJob(job: JourneyJob, publish: (reply: JourneyReply) => void): () => void {
  let active = true;
  const worker = new Worker(new URL('./journey.worker.ts', import.meta.url), { type: 'module' });
  const stop = () => { active = false; worker.terminate(); };
  worker.onmessage = (event: MessageEvent<JourneyReply>) => {
    if (!active) return;
    publish(event.data);
    if (['done', 'paleo', 'error'].includes(event.data.type)) stop();
  };
  worker.onerror = event => { if (active) publish({ type: 'error', message: event.message || 'Journey calculation failed' }); stop(); };
  try { worker.postMessage(journeyWorkerPayload(job)); } catch (error) { stop(); throw error; }
  return stop;
}

interface JourneyCapture { route: Route; stops: string[]; mode: TravelOptions['mode']; season: TravelOptions['season'] }
interface JourneyState { job: JourneyJob; route: Route | null; table: JourneyComparison | null; completed: number; busy: boolean; error: boolean; capture: JourneyCapture | null }
export function useJourneyComputation(world: WorldData, geography: HumanGeography, from: Settlement | null, to: Settlement | null,
  via: Settlement[], options: Omit<TravelOptions, 'via'>, compare: boolean, locale: 'es' | 'en' = 'es') {
  const [attempt, setAttempt] = useState(0);
  const job = useMemo<JourneyJob | null>(() => from && to ? ({ type: 'route', world, geography, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y },
    options: { ...options, via: via.map(stop => ({ x: stop.x, y: stop.y })) }, stopNames: [from.name, ...via.map(stop => stop.name), to.name], compare, locale }) : null,
  // revision changes in place, so object identity alone is insufficient.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [world, world.revision, geography, from?.x, from?.y, from?.name, to?.x, to?.y, to?.name, via, options.mode, options.season, options.hoursPerDay, options.planetRadiusKm, compare, locale, attempt]);
  const [state, setState] = useState<JourneyState | null>(null);
  useEffect(() => {
    if (!job) return;
    let active = true;
    const receive = (reply: JourneyReply) => {
      if (!active) return;
      setState(previous => {
        const current: JourneyState = previous?.job === job ? previous : { job, route: null, table: null, completed: 0, busy: true, error: false, capture: previous?.capture ?? null };
        if (reply.type === 'route') return { ...current, route: reply.route, capture: !reply.route.impossible && job.type === 'route'
          ? { route: reply.route, stops: job.stopNames ?? [], mode: job.options.mode, season: job.options.season } : current.capture };
        if (reply.type === 'progress') return { ...current, completed: reply.completed };
        if (reply.type === 'done') return { ...current, table: reply.table, busy: false };
        if (reply.type === 'error') return { ...current, busy: false, error: true };
        return current;
      });
    };
    let stop: (() => void) | undefined;
    try { stop = startJourneyJob(job, receive); } catch { receive({ type: 'error', message: 'Worker unavailable' }); }
    return () => { active = false; stop?.(); };
  }, [job]);
  const current = state?.job === job ? state : null;
  return { route: current?.route ?? null, table: current?.table ?? null, completed: current?.completed ?? 0,
    busy: !!job && (current?.busy ?? true), error: current?.error ?? false, hasEndpoints: !!job,
    capture: state?.capture ?? null, retry: () => setAttempt(value => value + 1) };
}

export function useJourneyPaleo(world: WorldData, paleo: PaleoState | null, locale: 'es' | 'en' = 'es') {
  const [attempt, setAttempt] = useState(0);
  const job = useMemo<JourneyJob | null>(() => paleo ? { type: 'paleo', world, state: paleo, locale } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, world.revision, paleo?.ice, paleo?.seaLevelM, locale, attempt]);
  const [result, setResult] = useState<{ job: JourneyJob; description: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!job) return;
    let active = true;
    let stop: (() => void) | undefined;
    try { stop = startJourneyJob(job, reply => {
      if (!active) return;
      if (reply.type === 'paleo') setResult({ job, description: reply.description, error: false });
      if (reply.type === 'error') setResult({ job, description: '', error: true });
    }); } catch { queueMicrotask(() => { if (active) setResult({ job, description: '', error: true }); }); }
    return () => { active = false; stop?.(); };
  }, [job]);
  return { description: result?.job === job ? result.description : '', busy: !!job && result?.job !== job,
    error: result?.job === job && result.error, retry: () => setAttempt(value => value + 1) };
}
