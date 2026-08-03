// ============================================
// World Generator — generation lifecycle hook
// ============================================
// Owns the worker, the progress state, and the two caches a world lives in.
//
// Worlds are (seed, params, edits) and the pipeline is deterministic, so the
// terrain can always be rebuilt. It just must not have to be: rebuilding is
// twenty-six seconds on the default grid, and before the snapshot below existed
// that bill was paid on every application start, for every world, for ever.
//
// So there are two caches in front of one generator:
//
//   1. THE SESSION CACHE, in this module. Instant, holds the live objects, dies
//      with the tab.
//   2. THE SNAPSHOT, in IndexedDB. About a second, survives everything, and is
//      discarded whenever its parameters or its format no longer match.
//
// And one rule that is easy to miss and expensive to get wrong: PAINTING
// MUTATES THE WORLD IN PLACE. The cached object is therefore the EDITED world,
// not the generated one, so the session cache also keeps a pristine copy of the
// three fields an edit can touch. Handing a caller the edited arrays and then
// letting `PaintSession` snapshot them as "pristine" would bake the strokes in
// permanently and replay the saved list on top of itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { forgeAvailable, forgeDegraded, spawnForgeWorker } from './forge/bridge';
import type { WorldData, WorldParams } from './core/types';
import { unpackWorld } from './core/types';
import { loadSnapshot, saveSnapshot } from './snapshots';
import type { WorkerReply } from './worldgen.worker';

interface Entry {
  key: string;
  data: WorldData;
  /** The generated world, before any brush touched it. */
  pristine: { elevation: Float32Array; biome: Uint8Array; lake: Uint8Array };
}

/** Session-lifetime cache: worldId → entry. */
const cache = new Map<string, Entry>();

export function paramsKey(params: WorldParams): string {
  return JSON.stringify(params);
}

function remember(worldId: string, key: string, data: WorldData): Entry {
  const entry: Entry = {
    key,
    data,
    pristine: {
      elevation: Float32Array.from(data.elevation),
      biome: Uint8Array.from(data.biome),
      lake: Uint8Array.from(data.lake),
    },
  };
  cache.delete(worldId);
  cache.set(worldId, entry);
  // Three worlds of pristine copies is about thirty-six megabytes; a reader who
  // browses ten in one sitting should not be carrying all ten. Map iteration is
  // insertion-ordered, so the first key is the least recently remembered.
  while (cache.size > 3) {
    const oldest = cache.keys().next().value;
    if (!oldest || oldest === worldId) break;
    cache.delete(oldest);
  }
  return entry;
}

export function getCachedWorld(worldId: string, params: WorldParams): WorldData | null {
  const hit = cache.get(worldId);
  if (hit && hit.key === paramsKey(params)) return hit.data;
  return null;
}

export interface GenerationState {
  running: boolean;
  stage: string;
  progress: number; // 0..1
  error: string | null;
}

const IDLE: GenerationState = { running: false, stage: '', progress: 0, error: null };
const LOADING: GenerationState = { running: true, stage: 'loading', progress: 0.5, error: null };

export function useWorldGeneration(
  worldId: string,
  onDone?: (world: WorldData) => void,
): {
  world: WorldData | null;
  gen: GenerationState;
  generate: (params: WorldParams) => void;
  cancel: () => void;
  /**
   * Put the world's editable fields back the way the generator left them.
   *
   * Called immediately before a `PaintSession` is built over the world, so the
   * session's own pristine snapshot is genuinely pristine and the saved edit
   * list replays exactly once instead of on top of itself.
   */
  restorePristine: (world: WorldData) => void;
} {
  const [world, setWorld] = useState<WorldData | null>(() => cache.get(worldId)?.data ?? null);
  const [gen, setGen] = useState<GenerationState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  /** Monotonic token: a load or a generation that finishes late is discarded. */
  const runRef = useRef(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // World switch → reset synchronously during render (React's documented
  // "adjust state when props change" pattern; no effect, no extra paint).
  const [lastWorldId, setLastWorldId] = useState(worldId);
  if (worldId !== lastWorldId) {
    setLastWorldId(worldId);
    const hit = cache.get(worldId);
    setWorld(hit ? hit.data : null);
    setGen(IDLE);
  }

  // Kill any in-flight worker when the world changes or on unmount.
  const invalidateRun = useCallback(() => {
    runRef.current++;
  }, []);
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      invalidateRun();
    };
  }, [worldId, invalidateRun]);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    invalidateRun();
    setGen(IDLE);
  }, [invalidateRun]);

  const restorePristine = useCallback((w: WorldData) => {
    const entry = cache.get(worldId);
    if (!entry || entry.data !== w) return;
    w.elevation.set(entry.pristine.elevation);
    w.biome.set(entry.pristine.biome);
    w.lake.set(entry.pristine.lake);
    w.painted = undefined;
    w.revision = (w.revision ?? 0) + 1;
  }, [worldId]);

  const forge = useCallback((params: WorldParams, key: string, run: number) => {
    workerRef.current?.terminate();
    // World generation leaves the renderer entirely when the Forge is up: a
    // dedicated OS process does the heavy months, and this window only
    // receives the finished world. Web Worker fallback everywhere else —
    // including the degraded mode the bridge declares when a forge child
    // dies without ever answering (see FORGE_FIRST_REPLY_MS).
    const worker = forgeAvailable() && !forgeDegraded()
      ? spawnForgeWorker('worldgen') as unknown as Worker
      : new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setGen({ running: true, stage: 'plates', progress: 0, error: null });

    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        if (run !== runRef.current) return;
        setGen({ running: true, stage: msg.stage, progress: msg.overall, error: null });
      } else if (msg.type === 'done') {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        if (run !== runRef.current) return;
        const data = unpackWorld(msg.world);
        remember(worldId, key, data);
        setWorld(data);
        setGen(IDLE);
        // Kept for next time. Deferred rather than immediate: quantising
        // thirty-eight megabytes is about half a second of main thread, and the
        // moment the world arrives is precisely when the reader is watching it
        // draw. Nothing waits on it and nothing breaks if it fails — the worst
        // case is that the world gets forged again one day.
        window.setTimeout(() => { void saveSnapshot(worldId, key, data); }, 2500);
        onDoneRef.current?.(data);
      } else {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        if (run !== runRef.current) return;
        setGen({ running: false, stage: '', progress: 0, error: msg.message });
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (run !== runRef.current) return;
      setGen({ running: false, stage: '', progress: 0, error: err.message || 'Worker error' });
    };

    worker.postMessage({ type: 'generate', params });
  }, [worldId]);

  const generate = useCallback((params: WorldParams) => {
    const key = paramsKey(params);
    const run = ++runRef.current;

    // 1. Session cache → instant.
    const hit = cache.get(worldId);
    if (hit && hit.key === key) {
      setWorld(hit.data);
      setGen(IDLE);
      return;
    }

    // 2. Snapshot → about a second. The overlay says "loading" rather than
    //    naming a pipeline stage, because no pipeline stage is running.
    setGen(LOADING);
    void loadSnapshot(worldId, key).then((stored) => {
      if (run !== runRef.current) return;
      if (!stored) {
        forge(params, key, run);
        return;
      }
      remember(worldId, key, stored);
      setWorld(stored);
      setGen(IDLE);
      onDoneRef.current?.(stored);
    }).catch(() => {
      if (run !== runRef.current) return;
      forge(params, key, run);
    });
  }, [worldId, forge]);

  return { world, gen, generate, cancel, restorePristine };
}
