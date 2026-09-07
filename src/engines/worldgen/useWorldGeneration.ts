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
import { captureEnvironment, restoreEnvironment, type EnvironmentFields } from './core/recalculate';
import { loadSnapshot, saveSnapshot } from './snapshots';
import { bindCanonWorld } from './canonSnapshots';
import type { WorkerReply } from './worldgen.worker';

interface Entry {
  key: string;
  data: WorldData;
  byteLength: number;
  /** The generated world, before any brush touched it. */
  pristine: EnvironmentFields & { elevation: Float32Array };
}

/** Session-lifetime cache: worldId → entry. */
const cache = new Map<string, Entry>();
const CACHE_BYTES = 256 * 1024 * 1024;

function touchEntry(worldId: string, entry: Entry): void {
  cache.delete(worldId);
  cache.set(worldId, entry);
}

export function paramsKey(params: WorldParams): string {
  return JSON.stringify(params);
}

function remember(worldId: string, key: string, data: WorldData): Entry {
  const entry: Entry = {
    key,
    data,
    byteLength: 0,
    pristine: {
      ...captureEnvironment(data),
      elevation: Float32Array.from(data.elevation),
    },
  };
  // Count actual owned buffers rather than assuming the default resolution.
  // A 3072-wide world is several times larger than the old three-world budget
  // implied. Count aliases once and include the pristine paint recovery copy.
  const buffers = new Set<ArrayBufferLike>();
  for (const value of [...Object.values(data), ...Object.values(entry.pristine), ...data.rivers.map((river) => river.cells), ...entry.pristine.rivers.map(river => river.cells)]) {
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
  }
  for (const buffer of buffers) entry.byteLength += buffer.byteLength;
  // Every world object that reaches a view passes through here, so this is
  // the one place the canon persistence learns which Dexie row a live world
  // belongs to. A world that never passes (benches, transient previews)
  // simply never persists canon.
  bindCanonWorld(data, worldId);
  touchEntry(worldId, entry);
  let bytes = 0;
  for (const cached of cache.values()) bytes += cached.byteLength;
  // Retain the just-adopted world even if it alone exceeds the budget.
  while (cache.size > 1 && (cache.size > 3 || bytes > CACHE_BYTES)) {
    const oldest = cache.keys().next().value;
    if (!oldest || oldest === worldId) break;
    bytes -= cache.get(oldest)!.byteLength;
    cache.delete(oldest);
  }
  return entry;
}

export function getCachedWorld(worldId: string, params: WorldParams): WorldData | null {
  const hit = cache.get(worldId);
  if (hit && hit.key === paramsKey(params)) {
    touchEntry(worldId, hit);
    return hit.data;
  }
  return null;
}

export interface GenerationState {
  running: boolean;
  /** The caller is committing the recipe; cancellation must not interrupt it. */
  committing?: boolean;
  stage: string;
  progress: number; // 0..1
  error: string | null;
}

const IDLE: GenerationState = { running: false, stage: '', progress: 0, error: null };
const LOADING: GenerationState = { running: true, stage: 'loading', progress: 0.5, error: null };

export function useWorldGeneration(
  worldId: string,
  onDone?: (world: WorldData) => void | Promise<void>,
): {
  world: WorldData | null;
  gen: GenerationState;
  generate: (params: WorldParams, options?: { fresh?: boolean }) => void;
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
  const committingRef = useRef(false);
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
    committingRef.current = false;
  }, []);
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      invalidateRun();
    };
  }, [worldId, invalidateRun]);

  const cancel = useCallback(() => {
    if (committingRef.current) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    invalidateRun();
    setGen(IDLE);
  }, [invalidateRun]);

  const restorePristine = useCallback((w: WorldData) => {
    const entry = cache.get(worldId);
    if (!entry || entry.data !== w) return;
    w.elevation.set(entry.pristine.elevation);
    restoreEnvironment(w, entry.pristine);
    w.painted = undefined;
    w.revision = (w.revision ?? 0) + 1;
  }, [worldId]);

  const adopt = useCallback(async (data: WorldData, key: string, run: number, persist: boolean, cached?: Entry) => {
    if (run !== runRef.current) return;
    committingRef.current = true;
    setGen({ running: true, committing: true, stage: 'finish', progress: 1, error: null });
    try {
      // Persist the caller's recipe/edit reset before exposing new terrain.
      // Failed commits keep the old live world and both caches untouched.
      await onDoneRef.current?.(data);
      if (run !== runRef.current) return;
      const entry = cached ?? remember(worldId, key, data);
      setWorld(data);
      setGen(IDLE);
      if (persist) {
        const snapshot = { ...data, ...entry.pristine, painted: undefined };
        window.setTimeout(() => { void saveSnapshot(worldId, key, snapshot); }, 2500);
      }
    } catch (error) {
      if (run === runRef.current) setGen({ running: false, stage: '', progress: 0, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (run === runRef.current) committingRef.current = false;
    }
  }, [worldId]);

  const forge = useCallback((params: WorldParams, key: string, run: number) => {
    workerRef.current?.terminate();
    // World generation leaves the renderer entirely when the Forge is up: a
    // dedicated OS process does the heavy months, and this window only
    // receives the finished world. Web Worker fallback everywhere else —
    // including the degraded mode the bridge declares when a forge child
    // dies without ever answering (see FORGE_FIRST_REPLY_MS).
    let worker: Worker;
    try {
      worker = forgeAvailable() && !forgeDegraded()
        ? spawnForgeWorker('worldgen') as unknown as Worker
        : new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      setGen({ running: false, stage: '', progress: 0, error: error instanceof Error ? error.message : String(error) });
      return;
    }
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
        try {
          void adopt(unpackWorld(msg.world), key, run, true);
        } catch (error) {
          setGen({ running: false, stage: '', progress: 0, error: error instanceof Error ? error.message : String(error) });
        }
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

    try {
      worker.postMessage({ type: 'generate', params });
    } catch (error) {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setGen({ running: false, stage: '', progress: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }, [adopt]);

  const generate = useCallback((params: WorldParams, options?: { fresh?: boolean }) => {
    if (committingRef.current) return;
    const key = paramsKey(params);
    const run = ++runRef.current;
    workerRef.current?.terminate();
    workerRef.current = null;

    if (options?.fresh) {
      forge(params, key, run);
      return;
    }

    // 1. Session cache → instant.
    const hit = cache.get(worldId);
    if (hit && hit.key === key) {
      touchEntry(worldId, hit);
      void adopt(hit.data, key, run, false, hit);
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
      void adopt(stored, key, run, false);
    }).catch(() => {
      if (run !== runRef.current) return;
      forge(params, key, run);
    });
  }, [worldId, forge, adopt]);

  return { world, gen, generate, cancel, restorePristine };
}
